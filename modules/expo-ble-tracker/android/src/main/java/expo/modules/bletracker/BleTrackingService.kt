package expo.modules.bletracker

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.bluetooth.BluetoothManager
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * BLE Tracking Foreground Service using duty-cycle scanning.
 *
 * Strategy (from AltBeacon library best practices):
 * - Scan for 3 seconds every 2 minutes (duty cycle ~2.5%)
 * - Uses AlarmManager for precise timing even in doze
 * - Processes results immediately in ScanCallback (no PendingIntent/Receiver)
 * - One save per tool per scan cycle (natural throttle)
 * - GPS + Supabase save done directly in service
 *
 * This avoids: reportDelay hardware bugs, BroadcastReceiver race conditions,
 * SharedPreferences cooldown failures, and Samsung batching issues.
 */
class BleTrackingService : Service() {

    companion object {
        private const val TAG = "BleTracker"
        private const val CHANNEL_ID = "ble_tracker_channel"
        private const val NOTIFICATION_ID = 9001
        private const val ACTION_SCAN_TICK = "expo.modules.bletracker.SCAN_TICK"

        private const val SCAN_DURATION_MS = 3000L        // 3 sec scan window
        private const val SCAN_INTERVAL_MS = 2 * 60 * 1000L // 2 min between scans
        private const val MIN_DISTANCE_M = 15.0
        private const val STOP_TIMEOUT_MS = 4 * 60 * 1000L

        private const val PREFS_NAME = "ble_tracker_prefs"
        private const val KEY_TRACKED_TAGS = "tracked_tags"
        private const val KEY_SUPABASE_URL = "supabase_url"
        private const val KEY_SUPABASE_KEY = "supabase_key"
        private const val KEY_LAST_POSITIONS = "last_positions"

        @Volatile var pauseScanning = false
        @Volatile var lastScanTimestamp = 0L
    }

    private var scanner: BluetoothLeScanner? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private val handler = Handler(Looper.getMainLooper())
    private val trackedTags = mutableMapOf<String, Triple<String, String, String>>() // MAC → (toolId, toolName, contractorId)
    private val lastPositions = mutableMapOf<String, DoubleArray>() // toolId → [lat, lng, eventCode, timestamp]
    private var supabaseUrl = ""
    private var supabaseKey = ""

    // Detections collected during current 3-sec scan window
    private val currentDetections = mutableSetOf<String>() // MACs detected this cycle

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

        loadConfig()
        loadLastPositions()
        initScanner()

        // First scan immediately, then schedule
        performScanCycle()
        scheduleNextScan()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_SCAN_TICK) {
            performScanCycle()
            scheduleNextScan()
        } else {
            loadConfig()
            Log.i(TAG, "Service started with ${trackedTags.size} tags")
        }
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        handler.removeCallbacksAndMessages(null)
        try { scanner?.stopScan(scanCallback) } catch (e: Exception) { /* ignore */ }
        saveLastPositions()
        wakeLock?.release()
        cancelAlarm()
        Log.i(TAG, "Service destroyed")

        // Self-restart
        try {
            val intent = Intent(this, BleTrackingService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(intent)
            else startService(intent)
        } catch (e: Exception) { /* ignore */ }
    }

    // ─── Alarm-based scheduling ────────────────────────────────────────

    private fun scheduleNextScan() {
        val am = getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val intent = Intent(this, BleTrackingService::class.java).apply { action = ACTION_SCAN_TICK }
        val pi = PendingIntent.getService(this, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,
            System.currentTimeMillis() + SCAN_INTERVAL_MS, pi)
    }

    private fun cancelAlarm() {
        val am = getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val intent = Intent(this, BleTrackingService::class.java).apply { action = ACTION_SCAN_TICK }
        val pi = PendingIntent.getService(this, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        am.cancel(pi)
    }

    // ─── Scan Cycle ────────────────────────────────────────────────────

    private fun performScanCycle() {
        if (pauseScanning || trackedTags.isEmpty()) return
        if (scanner == null) initScanner()
        if (scanner == null) return

        lastScanTimestamp = System.currentTimeMillis()
        currentDetections.clear()

        try {
            val filters = trackedTags.keys.map { mac ->
                ScanFilter.Builder().setDeviceAddress(mac).build()
            }
            val settings = ScanSettings.Builder()
                .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY) // Full power for 3 sec only
                .build()

            scanner?.startScan(filters, settings, scanCallback)
            Log.d(TAG, "Scan started (${SCAN_DURATION_MS/1000}s)")

            // Stop after SCAN_DURATION_MS and process
            handler.postDelayed({
                try { scanner?.stopScan(scanCallback) } catch (e: Exception) { /* ignore */ }
                processDetections()
            }, SCAN_DURATION_MS)

        } catch (e: SecurityException) {
            Log.e(TAG, "Scan permission denied: ${e.message}")
        }
    }

    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            val mac = try { result.device.address } catch (e: SecurityException) { return }
            if (trackedTags.containsKey(mac)) {
                currentDetections.add(mac)
            }
        }
        override fun onScanFailed(errorCode: Int) {
            Log.e(TAG, "Scan failed: $errorCode")
        }
    }

    // ─── Process Detections ────────────────────────────────────────────

    private fun processDetections() {
        if (currentDetections.isEmpty()) {
            Log.d(TAG, "No tags in range")
            updateNotification("Sem ferramentas no alcance")
            return
        }

        val detectedTools = currentDetections.mapNotNull { mac ->
            trackedTags[mac]?.let { (toolId, toolName, contractorId) ->
                Triple(toolId, toolName, contractorId)
            }
        }.distinctBy { it.first } // One per tool

        Log.d(TAG, "Detected ${detectedTools.size} tool(s): ${detectedTools.map { it.second }.joinToString()}")

        // Get GPS
        try {
            val fusedLocation = LocationServices.getFusedLocationProviderClient(this)
            val cts = CancellationTokenSource()
            fusedLocation.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, cts.token)
                ?.addOnSuccessListener { location ->
                    if (location == null) { Log.w(TAG, "GPS null"); return@addOnSuccessListener }

                    val lat = location.latitude
                    val lng = location.longitude
                    val accuracy = location.accuracy.toDouble()
                    val speed = location.speed.toDouble() * 3.6

                    Log.d(TAG, "GPS: (${"%.5f".format(lat)}, ${"%.5f".format(lng)}) acc=${accuracy.toInt()}m spd=${"%.0f".format(speed)}km/h")

                    if (accuracy > 50) {
                        Log.d(TAG, "GPS accuracy too low — skipping")
                        return@addOnSuccessListener
                    }

                    val now = System.currentTimeMillis()

                    for ((toolId, toolName, contractorId) in detectedTools) {
                        val last = lastPositions[toolId]

                        if (last == null) {
                            lastPositions[toolId] = doubleArrayOf(lat, lng, 0.0, now.toDouble())
                            Log.d(TAG, "First: $toolName")
                            continue
                        }

                        val lastLat = last[0]; val lastLng = last[1]
                        val lastEventCode = last[2].toInt()
                        val lastTime = last[3].toLong()
                        val dist = haversine(lat, lng, lastLat, lastLng)
                        val timeSince = now - lastTime
                        val threshold = maxOf(MIN_DISTANCE_M, accuracy * 2)

                        val event: String; val eventCode: Double

                        when {
                            speed >= 10 -> { event = "speed"; eventCode = 1.0 }
                            dist > threshold -> { event = "movement"; eventCode = 2.0 }
                            timeSince > STOP_TIMEOUT_MS && lastEventCode != 3 -> { event = "stop"; eventCode = 3.0 }
                            timeSince > 60 * 60 * 1000 -> { event = "stop"; eventCode = 3.0 }
                            else -> {
                                lastPositions[toolId] = doubleArrayOf(lat, lng, last[2], now.toDouble())
                                continue
                            }
                        }

                        saveMovement(toolId, contractorId, event, lat, lng, speed)
                        lastPositions[toolId] = doubleArrayOf(lat, lng, eventCode, now.toDouble())
                        Log.i(TAG, "✅ $event → $toolName (${"%.0f".format(speed)}km/h)")
                    }

                    val names = detectedTools.map { it.second }
                    updateNotification("${names.joinToString()} • ${names.size} detectada(s)")
                    saveLastPositions()
                }
        } catch (e: SecurityException) { Log.e(TAG, "Location denied") }
    }

    // ─── Supabase ──────────────────────────────────────────────────────

    private fun saveMovement(toolId: String, contractorId: String, event: String, lat: Double, lng: Double, speed: Double) {
        if (supabaseUrl.isEmpty() || supabaseKey.isEmpty()) return
        Thread {
            try {
                val body = JSONObject().apply {
                    put("tool_id", toolId); put("contractor_id", contractorId)
                    put("event", event); put("latitude", lat); put("longitude", lng); put("speed_kmh", speed)
                }
                val conn = URL("$supabaseUrl/rest/v1/tool_movements").openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("apikey", supabaseKey); conn.setRequestProperty("Authorization", "Bearer $supabaseKey")
                conn.setRequestProperty("Content-Type", "application/json"); conn.setRequestProperty("Prefer", "return=minimal")
                conn.doOutput = true; conn.outputStream.write(body.toString().toByteArray())
                conn.responseCode; conn.disconnect()

                val locBody = JSONObject().apply {
                    put("last_seen_location", JSONObject().apply {
                        put("latitude", lat); put("longitude", lng)
                        put("timestamp", java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US).apply {
                            timeZone = java.util.TimeZone.getTimeZone("UTC")
                        }.format(java.util.Date()))
                    })
                }
                val conn2 = URL("$supabaseUrl/rest/v1/tools?id=eq.$toolId").openConnection() as HttpURLConnection
                conn2.requestMethod = "PATCH"; conn2.setRequestProperty("apikey", supabaseKey); conn2.setRequestProperty("Authorization", "Bearer $supabaseKey")
                conn2.setRequestProperty("Content-Type", "application/json"); conn2.setRequestProperty("Prefer", "return=minimal")
                conn2.doOutput = true; conn2.outputStream.write(locBody.toString().toByteArray()); conn2.responseCode; conn2.disconnect()
            } catch (e: Exception) { Log.e(TAG, "Save error: ${e.message}") }
        }.start()
    }

    // ─── Config & State ────────────────────────────────────────────────

    private fun initScanner() {
        try {
            scanner = (getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter?.bluetoothLeScanner
        } catch (e: SecurityException) { Log.e(TAG, "BLE init denied") }
    }

    private fun loadConfig() {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        supabaseUrl = prefs.getString(KEY_SUPABASE_URL, "") ?: ""
        supabaseKey = prefs.getString(KEY_SUPABASE_KEY, "") ?: ""
        trackedTags.clear()
        try {
            val obj = JSONObject(prefs.getString(KEY_TRACKED_TAGS, "{}") ?: "{}")
            val keys = obj.keys()
            while (keys.hasNext()) {
                val tagId = keys.next()
                val t = obj.getJSONObject(tagId)
                trackedTags[tagId] = Triple(t.getString("toolId"), t.getString("toolName"), t.getString("contractorId"))
            }
        } catch (e: Exception) { /* ignore */ }
        Log.i(TAG, "Config: ${trackedTags.size} tags")
    }

    private fun loadLastPositions() {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        lastPositions.clear()
        try {
            val obj = JSONObject(prefs.getString(KEY_LAST_POSITIONS, "{}") ?: "{}")
            val keys = obj.keys()
            while (keys.hasNext()) {
                val toolId = keys.next()
                val p = obj.getJSONObject(toolId)
                lastPositions[toolId] = doubleArrayOf(p.getDouble("lat"), p.getDouble("lng"), p.optDouble("event", 0.0), p.getDouble("timestamp"))
            }
        } catch (e: Exception) { /* ignore */ }
    }

    private fun saveLastPositions() {
        val obj = JSONObject()
        for ((toolId, arr) in lastPositions) {
            obj.put(toolId, JSONObject().apply { put("lat", arr[0]); put("lng", arr[1]); put("event", arr[2]); put("timestamp", arr[3]) })
        }
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit().putString(KEY_LAST_POSITIONS, obj.toString()).commit()
    }

    // ─── Notification ──────────────────────────────────────────────────

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(CHANNEL_ID, "Tool Tracking", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "Rastreamento de ferramentas"; setShowBadge(false); setSound(null, null)
            }
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(channel)
        }
    }

    private fun buildNotification(text: String): Notification =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID).setContentTitle("Locate Tool").setContentText(text)
                .setSmallIcon(android.R.drawable.ic_menu_mylocation).setOngoing(true).build()
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this).setContentTitle("Locate Tool").setContentText(text)
                .setSmallIcon(android.R.drawable.ic_menu_mylocation).setOngoing(true).build()
        }

    private fun updateNotification(text: String) {
        (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(NOTIFICATION_ID, buildNotification(text))
    }

    // ─── Utils ─────────────────────────────────────────────────────────

    private fun haversine(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val R = 6371000.0
        val dLat = Math.toRadians(lat2 - lat1); val dLon = Math.toRadians(lon2 - lon1)
        val a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    }
}
