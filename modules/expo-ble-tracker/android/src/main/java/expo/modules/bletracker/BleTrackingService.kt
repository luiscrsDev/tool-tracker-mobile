package expo.modules.bletracker

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONObject

/**
 * Native Android BLE Tracking Service using PendingIntent-based scanning.
 *
 * Instead of periodic scan loops (which Android kills), this uses the system-level
 * BLE scanner via PendingIntent. The Android BLE stack runs the scan even when our
 * process is dead, and wakes us up via BroadcastReceiver when a matching device is found.
 *
 * Flow:
 *   1. Register PendingIntent scan with ScanFilters for each tracked MAC
 *   2. System detects device → sends Intent to our BroadcastReceiver
 *   3. Receiver gets GPS, applies movement engine, saves to Supabase
 *   4. Scan persists until explicitly stopped — survives doze, background, app kill
 */
class BleTrackingService : Service() {

    companion object {
        private const val TAG = "BleTracker"
        private const val CHANNEL_ID = "ble_tracker_channel"
        private const val NOTIFICATION_ID = 9001
        private const val MIN_DISTANCE_M = 15.0
        private const val STOP_TIMEOUT_MS = 4 * 60 * 1000L
        private const val ACTION_BLE_SCAN_RESULT = "expo.modules.bletracker.BLE_SCAN_RESULT"

        private const val PREFS_NAME = "ble_tracker_prefs"
        private const val KEY_TRACKED_TAGS = "tracked_tags"
        private const val KEY_SUPABASE_URL = "supabase_url"
        private const val KEY_SUPABASE_KEY = "supabase_key"
        private const val KEY_LAST_POSITIONS = "last_positions"

        @Volatile var pauseScanning = false
        @Volatile var lastScanTimestamp = 0L
    }

    private var scanner: BluetoothLeScanner? = null
    private var fusedLocation: FusedLocationProviderClient? = null
    private var scanPendingIntent: PendingIntent? = null
    private var wakeLock: PowerManager.WakeLock? = null

    data class TrackedTag(val toolId: String, val toolName: String, val contractorId: String)
    private val trackedTags = mutableMapOf<String, TrackedTag>()

    data class LastPosition(val lat: Double, val lng: Double, val event: String, val timestamp: Long)
    private val lastPositions = mutableMapOf<String, LastPosition>()

    // Track last SAVED position (for movement engine) vs last DETECTED position (for GPS averaging)
    data class DetectionHistory(val lat: Double, val lng: Double, val timestamp: Long, val speed: Double)
    private val recentDetections = mutableMapOf<String, MutableList<DetectionHistory>>() // toolId → last N detections

    // Cooldown: minimum time between saves per tool (prevents flooding during driving)
    private val lastSaveTime = mutableMapOf<String, Long>() // toolId → timestamp of last save
    private val SPEED_COOLDOWN_MS = 2 * 60 * 1000L  // 2 min between speed saves
    private val MOVEMENT_COOLDOWN_MS = 30 * 1000L     // 30s between movement saves

    private var supabaseUrl: String = ""
    private var supabaseKey: String = ""

    // BroadcastReceiver for PendingIntent scan results
    private val scanResultReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action != ACTION_BLE_SCAN_RESULT) return

            val results = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                intent.getParcelableArrayListExtra(BluetoothLeScanner.EXTRA_LIST_SCAN_RESULT, ScanResult::class.java)
            } else {
                @Suppress("DEPRECATION")
                intent.getParcelableArrayListExtra(BluetoothLeScanner.EXTRA_LIST_SCAN_RESULT)
            }

            if (results.isNullOrEmpty()) return

            lastScanTimestamp = System.currentTimeMillis()

            val detectedTags = mutableSetOf<String>()
            for (result in results) {
                val mac = try { result.device.address } catch (e: SecurityException) { continue }
                if (trackedTags.containsKey(mac)) {
                    detectedTags.add(mac)
                    Log.d(TAG, "📡 PendingIntent detected: $mac (${trackedTags[mac]?.toolName}) rssi=${result.rssi}")
                }
            }

            if (detectedTags.isNotEmpty()) {
                processDetections(detectedTags)
            }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "Service created")

        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "BleTracker::ScanWakeLock").apply {
            setReferenceCounted(false)
            acquire()
        }

        createNotificationChannel()
        val notification = buildNotification("Rastreando ferramentas...")

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            try {
                startForeground(NOTIFICATION_ID, notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION or 0x00000010)
            } catch (e: Exception) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
            }
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }

        // Register BroadcastReceiver for scan results
        val filter = IntentFilter(ACTION_BLE_SCAN_RESULT)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(scanResultReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(scanResultReceiver, filter)
        }

        fusedLocation = LocationServices.getFusedLocationProviderClient(this)
        loadConfig()
        loadLastPositions()
        startPendingIntentScan()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        loadConfig()
        Log.i(TAG, "Service started with ${trackedTags.size} tracked tags")
        // Restart scan with updated filters
        startPendingIntentScan()
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        stopPendingIntentScan()
        try { unregisterReceiver(scanResultReceiver) } catch (e: Exception) { /* ignore */ }
        saveLastPositions()
        wakeLock?.release()
        Log.i(TAG, "Service destroyed")

        // Self-restart
        val restartIntent = Intent(this, BleTrackingService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(restartIntent)
        } else {
            startService(restartIntent)
        }
    }

    // ─── PendingIntent BLE Scan ────────────────────────────────────────────

    private fun startPendingIntentScan() {
        if (trackedTags.isEmpty()) {
            Log.w(TAG, "No tags to track — scan not started")
            updateNotification("Sem ferramentas configuradas")
            return
        }

        try {
            val btManager = getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
            scanner = btManager?.adapter?.bluetoothLeScanner
            if (scanner == null) {
                Log.w(TAG, "Bluetooth not available")
                return
            }

            // Stop any existing scan first
            stopPendingIntentScan()

            // Create PendingIntent
            val intent = Intent(ACTION_BLE_SCAN_RESULT).apply {
                setPackage(packageName)
            }
            scanPendingIntent = PendingIntent.getBroadcast(this, 1, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE)

            // Create ScanFilters for each tracked MAC
            val filters = trackedTags.keys.map { mac ->
                ScanFilter.Builder()
                    .setDeviceAddress(mac)
                    .build()
            }

            val settings = ScanSettings.Builder()
                .setScanMode(ScanSettings.SCAN_MODE_LOW_POWER) // Battery efficient, system manages
                .setReportDelay(5000) // Batch results every 5 seconds
                .build()

            scanner?.startScan(filters, settings, scanPendingIntent!!)
            Log.i(TAG, "✅ PendingIntent scan started for ${filters.size} MAC filter(s)")
            updateNotification("Rastreando ${trackedTags.size} ferramenta(s)")

        } catch (e: SecurityException) {
            Log.e(TAG, "BLE scan permission denied: ${e.message}")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start PendingIntent scan: ${e.message}")
        }
    }

    private fun stopPendingIntentScan() {
        scanPendingIntent?.let { pi ->
            try {
                scanner?.stopScan(pi)
                Log.d(TAG, "PendingIntent scan stopped")
            } catch (e: SecurityException) { /* ignore */ }
            catch (e: Exception) { /* ignore */ }
        }
    }

    // ─── Detection Processing ──────────────────────────────────────────────

    private fun processDetections(detectedMacs: Set<String>) {
        if (pauseScanning) return

        try {
            val cts = CancellationTokenSource()
            fusedLocation?.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, cts.token)
                ?.addOnSuccessListener { location ->
                    if (location == null) {
                        Log.w(TAG, "GPS null")
                        return@addOnSuccessListener
                    }

                    val lat = location.latitude
                    val lng = location.longitude
                    val accuracy = location.accuracy.toDouble()
                    val speed = location.speed.toDouble() * 3.6

                    Log.d(TAG, "GPS: (${"%.5f".format(lat)}, ${"%.5f".format(lng)}) acc=${accuracy.toInt()}m spd=${"%.0f".format(speed)}km/h")

                    if (accuracy > 50) {
                        Log.d(TAG, "GPS accuracy too low (${accuracy.toInt()}m) — skipping")
                        return@addOnSuccessListener
                    }

                    for (mac in detectedMacs) {
                        val tag = trackedTags[mac] ?: continue
                        val last = lastPositions[tag.toolId]
                        val now = System.currentTimeMillis()

                        // Add to detection history (keep last 5)
                        val history = recentDetections.getOrPut(tag.toolId) { mutableListOf() }
                        history.add(DetectionHistory(lat, lng, now, speed))
                        if (history.size > 5) history.removeAt(0)

                        // First detection — save position, no record
                        if (last == null) {
                            lastPositions[tag.toolId] = LastPosition(lat, lng, "detected", now)
                            Log.i(TAG, "First detection: ${tag.toolName}")
                            continue
                        }

                        // Calculate average position from recent detections (reduces GPS drift)
                        val avgLat = history.map { it.lat }.average()
                        val avgLng = history.map { it.lng }.average()
                        val maxSpeed = history.maxOf { it.speed }

                        val distFromLast = haversine(avgLat, avgLng, last.lat, last.lng)
                        val timeSinceLast = now - last.timestamp
                        val effectiveThreshold = maxOf(MIN_DISTANCE_M, accuracy * 2)

                        // Need at least 2 detections before making decisions (avoids single GPS spike)
                        if (history.size < 2) continue

                        val lastSave = lastSaveTime[tag.toolId] ?: 0L
                        val sinceLastSave = now - lastSave

                        // SPEED: >10km/h, cooldown 2min between saves
                        if (maxSpeed >= 10) {
                            if (sinceLastSave > SPEED_COOLDOWN_MS) {
                                saveMovement(tag, "speed", lat, lng, maxSpeed)
                                lastPositions[tag.toolId] = LastPosition(lat, lng, "speed", now)
                                lastSaveTime[tag.toolId] = now
                                history.clear()
                                Log.d(TAG, "SPEED saved for ${tag.toolName} (${sinceLastSave/1000}s since last)")
                            } else {
                                // Update position without saving (for accurate stop detection later)
                                lastPositions[tag.toolId] = LastPosition(lat, lng, "speed", now)
                                Log.d(TAG, "SPEED skipped for ${tag.toolName} (${sinceLastSave/1000}s < ${SPEED_COOLDOWN_MS/1000}s cooldown)")
                            }
                            continue
                        }

                        // MOVEMENT: average position moved >threshold, speed <10, cooldown 30s
                        if (distFromLast > effectiveThreshold && maxSpeed < 10 && sinceLastSave > MOVEMENT_COOLDOWN_MS) {
                            // Confirm movement is consistent — check spread of recent detections
                            val spread = if (history.size >= 2) {
                                val first = history.first()
                                val last2 = history.last()
                                haversine(first.lat, first.lng, last2.lat, last2.lng)
                            } else 0.0

                            // If detections are clustered (spread < threshold) but far from last saved = real movement
                            // If detections are scattered (spread > threshold) = GPS noise, skip
                            if (spread < effectiveThreshold * 3) {
                                saveMovement(tag, "movement", avgLat, avgLng, speed)
                                lastPositions[tag.toolId] = LastPosition(avgLat, avgLng, "movement", now)
                                lastSaveTime[tag.toolId] = now
                                history.clear()
                            }
                            continue
                        }

                        // STOP: >4min stationary within threshold, last event != stop
                        if (timeSinceLast > STOP_TIMEOUT_MS && distFromLast < effectiveThreshold && last.event != "stop") {
                            saveMovement(tag, "stop", avgLat, avgLng, 0.0)
                            lastPositions[tag.toolId] = LastPosition(avgLat, avgLng, "stop", now)
                            history.clear()
                            continue
                        }

                        // STOP: >4min, was moving, now stationary = register stop
                        if (timeSinceLast > STOP_TIMEOUT_MS && last.event == "movement" || last.event == "speed") {
                            saveMovement(tag, "stop", avgLat, avgLng, 0.0)
                            lastPositions[tag.toolId] = LastPosition(avgLat, avgLng, "stop", now)
                            history.clear()
                            continue
                        }

                        // HEARTBEAT: >1h since last save
                        if (timeSinceLast > 60 * 60 * 1000) {
                            saveMovement(tag, "stop", avgLat, avgLng, 0.0)
                            lastPositions[tag.toolId] = LastPosition(avgLat, avgLng, "stop", now)
                            history.clear()
                        }
                    }

                    val names = detectedMacs.mapNotNull { trackedTags[it]?.toolName }
                    updateNotification("${names.joinToString(", ")} • ${names.size} detectada(s)")
                    saveLastPositions()
                }
                ?.addOnFailureListener { e ->
                    Log.e(TAG, "GPS failed: ${e.message}")
                }
        } catch (e: SecurityException) {
            Log.e(TAG, "Location permission denied: ${e.message}")
        }
    }

    // ─── Notification ──────────────────────────────────────────────────────

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(CHANNEL_ID, "Tool Tracking", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "Rastreamento de ferramentas em segundo plano"
                setShowBadge(false)
                setSound(null, null)
            }
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(channel)
        }
    }

    private fun buildNotification(text: String): Notification {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
                .setContentTitle("Locate Tool")
                .setContentText(text)
                .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .setOngoing(true)
                .build()
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
                .setContentTitle("Locate Tool")
                .setContentText(text)
                .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .setOngoing(true)
                .build()
        }
    }

    private fun updateNotification(text: String) {
        (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
            .notify(NOTIFICATION_ID, buildNotification(text))
    }

    // ─── Config ────────────────────────────────────────────────────────────

    private fun loadConfig() {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        supabaseUrl = prefs.getString(KEY_SUPABASE_URL, "") ?: ""
        supabaseKey = prefs.getString(KEY_SUPABASE_KEY, "") ?: ""

        val tagsJson = prefs.getString(KEY_TRACKED_TAGS, "{}") ?: "{}"
        trackedTags.clear()
        try {
            val obj = JSONObject(tagsJson)
            val keys = obj.keys()
            while (keys.hasNext()) {
                val tagId = keys.next()
                val t = obj.getJSONObject(tagId)
                trackedTags[tagId] = TrackedTag(
                    toolId = t.getString("toolId"),
                    toolName = t.getString("toolName"),
                    contractorId = t.getString("contractorId"),
                )
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse tracked tags: ${e.message}")
        }
        Log.i(TAG, "Config: ${trackedTags.size} tags, url=${supabaseUrl.take(30)}...")
    }

    private fun loadLastPositions() {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val json = prefs.getString(KEY_LAST_POSITIONS, "{}") ?: "{}"
        lastPositions.clear()
        try {
            val obj = JSONObject(json)
            val keys = obj.keys()
            while (keys.hasNext()) {
                val toolId = keys.next()
                val p = obj.getJSONObject(toolId)
                lastPositions[toolId] = LastPosition(p.getDouble("lat"), p.getDouble("lng"), p.getString("event"), p.getLong("timestamp"))
            }
        } catch (e: Exception) { /* ignore */ }
    }

    private fun saveLastPositions() {
        val obj = JSONObject()
        for ((toolId, pos) in lastPositions) {
            obj.put(toolId, JSONObject().apply { put("lat", pos.lat); put("lng", pos.lng); put("event", pos.event); put("timestamp", pos.timestamp) })
        }
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit().putString(KEY_LAST_POSITIONS, obj.toString()).apply()
    }

    // ─── Supabase ──────────────────────────────────────────────────────────

    private fun saveMovement(tag: TrackedTag, event: String, lat: Double, lng: Double, speedKmh: Double) {
        if (supabaseUrl.isEmpty() || supabaseKey.isEmpty()) return

        Thread {
            try {
                val body = JSONObject().apply {
                    put("tool_id", tag.toolId); put("contractor_id", tag.contractorId)
                    put("event", event); put("latitude", lat); put("longitude", lng); put("speed_kmh", speedKmh)
                }
                val conn = URL("$supabaseUrl/rest/v1/tool_movements").openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("apikey", supabaseKey)
                conn.setRequestProperty("Authorization", "Bearer $supabaseKey")
                conn.setRequestProperty("Content-Type", "application/json")
                conn.setRequestProperty("Prefer", "return=minimal")
                conn.doOutput = true
                conn.outputStream.write(body.toString().toByteArray())
                val code = conn.responseCode
                conn.disconnect()

                if (code in 200..299) {
                    Log.i(TAG, "✅ $event → ${tag.toolName} (${"%.4f".format(lat)}, ${"%.4f".format(lng)}) ${if (speedKmh > 0) "${speedKmh.toInt()}km/h" else ""}")
                } else {
                    Log.w(TAG, "❌ Save failed: HTTP $code")
                }

                // Update last_seen_location
                val locBody = JSONObject().apply {
                    put("last_seen_location", JSONObject().apply {
                        put("latitude", lat); put("longitude", lng)
                        put("timestamp", java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US).apply {
                            timeZone = java.util.TimeZone.getTimeZone("UTC")
                        }.format(java.util.Date()))
                    })
                }
                val conn2 = URL("$supabaseUrl/rest/v1/tools?id=eq.${tag.toolId}").openConnection() as HttpURLConnection
                conn2.requestMethod = "PATCH"
                conn2.setRequestProperty("apikey", supabaseKey); conn2.setRequestProperty("Authorization", "Bearer $supabaseKey")
                conn2.setRequestProperty("Content-Type", "application/json"); conn2.setRequestProperty("Prefer", "return=minimal")
                conn2.doOutput = true; conn2.outputStream.write(locBody.toString().toByteArray()); conn2.responseCode; conn2.disconnect()
            } catch (e: Exception) {
                Log.e(TAG, "Save error: ${e.message}")
            }
        }.start()
    }

    // ─── Utils ─────────────────────────────────────────────────────────────

    private fun haversine(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val R = 6371000.0
        val dLat = Math.toRadians(lat2 - lat1); val dLon = Math.toRadians(lon2 - lon1)
        val a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    }
}
