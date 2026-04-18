package expo.modules.bletracker

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import android.os.PowerManager
import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONObject

/**
 * Native Android Foreground Service for persistent BLE tracking.
 *
 * Runs a BLE scan every SCAN_INTERVAL_MS (2 min), each scan lasting SCAN_DURATION_MS (8s).
 * When a known tracker tag is detected, fetches GPS and saves to Supabase via HTTP.
 * Survives app backgrounding, screen off, and doze mode (foreground service exempt).
 */
class BleTrackingService : Service() {

    companion object {
        private const val TAG = "BleTracker"
        private const val CHANNEL_ID = "ble_tracker_channel"
        private const val NOTIFICATION_ID = 9001
        private const val SCAN_INTERVAL_MS = 2 * 60 * 1000L  // 2 min between scans
        private const val SCAN_DURATION_MS = 8 * 1000L        // 8 sec scan window
        private const val MIN_DISTANCE_M = 15.0               // movement threshold
        private const val STOP_TIMEOUT_MS = 4 * 60 * 1000L    // 4 min stop detection

        // Controlled by ExpoBleTrackerModule to pause scans during GATT operations
        @Volatile var pauseScanning = false
        @Volatile var lastScanTimestamp = 0L

        // Shared prefs keys
        private const val PREFS_NAME = "ble_tracker_prefs"
        private const val KEY_TRACKED_TAGS = "tracked_tags"      // JSON: {tagId: {toolId, toolName, contractorId}}
        private const val KEY_SUPABASE_URL = "supabase_url"
        private const val KEY_SUPABASE_KEY = "supabase_key"
        private const val KEY_LAST_POSITIONS = "last_positions"  // JSON: {toolId: {lat, lng, event, timestamp}}
    }

    private var scanner: BluetoothLeScanner? = null
    private var fusedLocation: FusedLocationProviderClient? = null
    private val handler = Handler(Looper.getMainLooper())
    private var isScanning = false
    private var wakeLock: PowerManager.WakeLock? = null

    // Tag registry: BLE MAC/ID → tool info
    data class TrackedTag(val toolId: String, val toolName: String, val contractorId: String)
    private val trackedTags = mutableMapOf<String, TrackedTag>()

    // Last known position per tool (for movement engine)
    data class LastPosition(val lat: Double, val lng: Double, val event: String, val timestamp: Long)
    private val lastPositions = mutableMapOf<String, LastPosition>()

    // Supabase config
    private var supabaseUrl: String = ""
    private var supabaseKey: String = ""

    // Tags detected in current scan cycle
    private val currentScanDetections = mutableSetOf<String>()

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "Service created")

        // Acquire partial wake lock to keep CPU alive for BLE scans
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "BleTracker::ScanWakeLock").apply {
            setReferenceCounted(false)
            acquire()
        }
        Log.i(TAG, "WakeLock acquired")

        createNotificationChannel()
        val notification = buildNotification("Iniciando rastreamento...")

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            try {
                startForeground(NOTIFICATION_ID, notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION or 0x00000010 /* CONNECTED_DEVICE */)
            } catch (e: Exception) {
                // Fallback for older Android
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
            }
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }

        fusedLocation = LocationServices.getFusedLocationProviderClient(this)
        loadConfig()
        loadLastPositions()
        initBleScanner()
        startScanLoop()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Reload config on every start command (allows adding/removing tags at runtime)
        loadConfig()
        Log.i(TAG, "Service started with ${trackedTags.size} tracked tags")
        return START_STICKY // Restart if killed
    }

    override fun onDestroy() {
        super.onDestroy()
        handler.removeCallbacksAndMessages(null)
        stopBleScan()
        saveLastPositions()
        wakeLock?.release()
        Log.i(TAG, "Service destroyed")

        // Self-restart: if service is killed, reschedule via alarm
        val restartIntent = Intent(this, BleTrackingService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(restartIntent)
        } else {
            startService(restartIntent)
        }
    }

    // ─── Notification ──────────────────────────────────────────────────────

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Tool Tracking",
                NotificationManager.IMPORTANCE_DEFAULT
            ).apply {
                description = "Rastreamento de ferramentas em segundo plano"
                setShowBadge(false)
                setSound(null, null)  // No sound but keep importance for survival
            }
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(channel)
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
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(NOTIFICATION_ID, buildNotification(text))
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

        Log.i(TAG, "Config loaded: ${trackedTags.size} tags, url=${supabaseUrl.take(30)}...")
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
                lastPositions[toolId] = LastPosition(
                    lat = p.getDouble("lat"),
                    lng = p.getDouble("lng"),
                    event = p.getString("event"),
                    timestamp = p.getLong("timestamp"),
                )
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to parse last positions: ${e.message}")
        }
    }

    private fun saveLastPositions() {
        val obj = JSONObject()
        for ((toolId, pos) in lastPositions) {
            obj.put(toolId, JSONObject().apply {
                put("lat", pos.lat)
                put("lng", pos.lng)
                put("event", pos.event)
                put("timestamp", pos.timestamp)
            })
        }
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_LAST_POSITIONS, obj.toString())
            .apply()
    }

    // ─── BLE Scanner ───────────────────────────────────────────────────────

    private fun initBleScanner() {
        try {
            val btManager = getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
            val adapter = btManager?.adapter
            if (adapter == null || !adapter.isEnabled) {
                Log.w(TAG, "Bluetooth not available or disabled")
                return
            }
            scanner = adapter.bluetoothLeScanner
            Log.i(TAG, "BLE scanner initialized")
        } catch (e: SecurityException) {
            Log.e(TAG, "BLE permission denied: ${e.message}")
        }
    }

    private fun startScanLoop() {
        handler.post(object : Runnable {
            override fun run() {
                performScanCycle()
                handler.postDelayed(this, SCAN_INTERVAL_MS)
            }
        })
    }

    private fun performScanCycle() {
        if (pauseScanning) {
            Log.d(TAG, "Scan paused (GATT operation in progress)")
            return
        }
        if (scanner == null) {
            initBleScanner()
            if (scanner == null) return
        }
        if (trackedTags.isEmpty()) return
        lastScanTimestamp = System.currentTimeMillis()

        currentScanDetections.clear()

        try {
            val settings = ScanSettings.Builder()
                .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
                .setReportDelay(0)
                .build()

            scanner?.startScan(null, settings, scanCallback)
            isScanning = true
            Log.d(TAG, "BLE scan started (${SCAN_DURATION_MS / 1000}s window)")

            // Stop after SCAN_DURATION_MS
            handler.postDelayed({
                stopBleScan()
                processDetections()
            }, SCAN_DURATION_MS)
        } catch (e: SecurityException) {
            Log.e(TAG, "Scan permission denied: ${e.message}")
        }
    }

    private fun stopBleScan() {
        if (!isScanning) return
        try {
            scanner?.stopScan(scanCallback)
        } catch (e: SecurityException) {
            // ignore
        }
        isScanning = false
    }

    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            val deviceId = try { result.device.address } catch (e: SecurityException) { return }
            val name = try { result.device.name } catch (e: SecurityException) { null }
            // Log all E4:06:BF devices for diagnostics
            if (deviceId.startsWith("E4:06:BF")) {
                Log.d(TAG, "Saw M1P: $deviceId ($name) rssi=${result.rssi}")
            }
            // Direct MAC match
            if (trackedTags.containsKey(deviceId)) {
                currentScanDetections.add(deviceId)
                return
            }
            // Manufacturer data match (for Apple Find My rotating MAC)
            val mfrData = result.scanRecord?.manufacturerSpecificData
            if (mfrData != null) {
                for (i in 0 until mfrData.size()) {
                    val bytes = mfrData.valueAt(i)
                    val hex = bytes?.joinToString("") { "%02X".format(it) } ?: continue
                    if (trackedTags.containsKey(hex)) {
                        currentScanDetections.add(hex)
                    }
                }
            }
        }

        override fun onScanFailed(errorCode: Int) {
            Log.e(TAG, "BLE scan failed: errorCode=$errorCode")
        }
    }

    // ─── Detection Processing ──────────────────────────────────────────────

    private fun processDetections() {
        if (currentScanDetections.isEmpty()) {
            Log.d(TAG, "No tracked tags in range")
            updateNotification("Sem ferramentas no alcance")
            return
        }

        Log.i(TAG, "Detected ${currentScanDetections.size} tag(s): ${currentScanDetections.joinToString()}")

        // Get current GPS
        try {
            val cts = CancellationTokenSource()
            fusedLocation?.getCurrentLocation(Priority.PRIORITY_BALANCED_POWER_ACCURACY, cts.token)
                ?.addOnSuccessListener { location ->
                    if (location == null) {
                        Log.w(TAG, "GPS location null")
                        return@addOnSuccessListener
                    }

                    val lat = location.latitude
                    val lng = location.longitude
                    val accuracy = location.accuracy.toDouble() // meters
                    val speed = location.speed.toDouble() * 3.6 // m/s → km/h
                    val detectedToolIds = mutableListOf<String>()

                    Log.d(TAG, "GPS: (${"%.5f".format(lat)}, ${"%.5f".format(lng)}) acc=${accuracy.toInt()}m spd=${"%.0f".format(speed)}km/h")

                    // Skip unreliable GPS — accuracy worse than 50m means indoor/bad signal
                    if (accuracy > 50) {
                        Log.d(TAG, "GPS accuracy too low (${accuracy.toInt()}m) — skipping")
                        return@addOnSuccessListener
                    }

                    for (tagId in currentScanDetections) {
                        val tag = trackedTags[tagId] ?: continue
                        detectedToolIds.add(tag.toolId)

                        val last = lastPositions[tag.toolId]
                        val now = System.currentTimeMillis()

                        // First detection — save position, no record
                        if (last == null) {
                            lastPositions[tag.toolId] = LastPosition(lat, lng, "detected", now)
                            Log.i(TAG, "First detection: ${tag.toolName}")
                            continue
                        }

                        val dist = haversine(lat, lng, last.lat, last.lng)
                        val timeSince = now - last.timestamp

                        // Movement must exceed GPS accuracy to be real
                        val effectiveThreshold = maxOf(MIN_DISTANCE_M, accuracy * 2)

                        // Movement: distance > threshold, <10km/h
                        if (dist > effectiveThreshold && speed < 10) {
                            saveMovement(tag, "movement", lat, lng, speed)
                            lastPositions[tag.toolId] = LastPosition(lat, lng, "movement", now)
                            continue
                        }

                        // Speed: >10km/h, >2min since last, last != speed
                        if (speed >= 10 && timeSince > 2 * 60 * 1000 && last.event != "speed") {
                            saveMovement(tag, "speed", lat, lng, speed)
                            lastPositions[tag.toolId] = LastPosition(lat, lng, "speed", now)
                            continue
                        }

                        // Stop: >4min stationary within threshold
                        if (timeSince > STOP_TIMEOUT_MS && dist < effectiveThreshold) {
                            if (last.event != "stop") {
                                saveMovement(tag, "stop", lat, lng, 0.0)
                                lastPositions[tag.toolId] = LastPosition(lat, lng, "stop", now)
                            }
                            continue
                        }

                        // Heartbeat: >1h
                        if (timeSince > 60 * 60 * 1000) {
                            saveMovement(tag, "stop", lat, lng, 0.0)
                            lastPositions[tag.toolId] = LastPosition(lat, lng, "stop", now)
                        }
                    }

                    val names = currentScanDetections.mapNotNull { trackedTags[it]?.toolName }
                    updateNotification("${names.joinToString(", ")} • ${names.size} tag(s)")
                    saveLastPositions()
                }
                ?.addOnFailureListener { e ->
                    Log.e(TAG, "GPS failed: ${e.message}")
                }
        } catch (e: SecurityException) {
            Log.e(TAG, "Location permission denied: ${e.message}")
        }
    }

    // ─── Supabase HTTP ─────────────────────────────────────────────────────

    private fun saveMovement(tag: TrackedTag, event: String, lat: Double, lng: Double, speedKmh: Double) {
        if (supabaseUrl.isEmpty() || supabaseKey.isEmpty()) return

        Thread {
            try {
                // Save to tool_movements
                val movementUrl = URL("$supabaseUrl/rest/v1/tool_movements")
                val body = JSONObject().apply {
                    put("tool_id", tag.toolId)
                    put("contractor_id", tag.contractorId)
                    put("event", event)
                    put("latitude", lat)
                    put("longitude", lng)
                    put("speed_kmh", speedKmh)
                }

                val conn = movementUrl.openConnection() as HttpURLConnection
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
                    Log.i(TAG, "✅ $event → ${tag.toolName} (${lat.format(4)}, ${lng.format(4)}) ${if (speedKmh > 0) "${speedKmh.toInt()}km/h" else ""}")
                } else {
                    Log.w(TAG, "❌ Save failed: HTTP $code for ${tag.toolName}")
                }

                // Update last_seen_location
                val toolUrl = URL("$supabaseUrl/rest/v1/tools?id=eq.${tag.toolId}")
                val locBody = JSONObject().apply {
                    put("last_seen_location", JSONObject().apply {
                        put("latitude", lat)
                        put("longitude", lng)
                        put("timestamp", java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US).apply {
                            timeZone = java.util.TimeZone.getTimeZone("UTC")
                        }.format(java.util.Date()))
                    })
                }

                val conn2 = toolUrl.openConnection() as HttpURLConnection
                conn2.requestMethod = "PATCH"
                conn2.setRequestProperty("apikey", supabaseKey)
                conn2.setRequestProperty("Authorization", "Bearer $supabaseKey")
                conn2.setRequestProperty("Content-Type", "application/json")
                conn2.setRequestProperty("Prefer", "return=minimal")
                conn2.doOutput = true
                conn2.outputStream.write(locBody.toString().toByteArray())
                conn2.responseCode // trigger request
                conn2.disconnect()

            } catch (e: Exception) {
                Log.e(TAG, "Save error: ${e.message}")
            }
        }.start()
    }

    // ─── Utils ─────────────────────────────────────────────────────────────

    private fun haversine(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val R = 6371000.0
        val dLat = Math.toRadians(lat2 - lat1)
        val dLon = Math.toRadians(lon2 - lon1)
        val a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) *
                Math.sin(dLon / 2) * Math.sin(dLon / 2)
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    }

    private fun Double.format(digits: Int) = "%.${digits}f".format(this)
}
