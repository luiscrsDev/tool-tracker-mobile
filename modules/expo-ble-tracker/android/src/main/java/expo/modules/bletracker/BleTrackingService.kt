package expo.modules.bletracker

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.bluetooth.BluetoothManager
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class BleTrackingService : Service() {

    companion object {
        private const val TAG = "BleTracker"
        private const val CHANNEL_ID = "ble_tracker_channel"
        private const val NOTIFICATION_ID = 9001
        private const val PREFS_NAME = "ble_tracker_prefs"
        private const val KEY_TRACKED_TAGS = "tracked_tags"
        private const val KEY_SUPABASE_URL = "supabase_url"
        private const val KEY_SUPABASE_KEY = "supabase_key"
        private const val KEY_LAST_POSITIONS = "last_positions"
        private const val MIN_DISTANCE_M = 15.0
        private const val STOP_TIMEOUT_MS = 4 * 60 * 1000L
        private const val THROTTLE_MS = 110_000L

        @Volatile var pauseScanning = false
        @Volatile var lastScanTimestamp = 0L
        @Volatile var instance: BleTrackingService? = null
    }

    private val trackedTags = mutableMapOf<String, Triple<String, String, String>>() // MAC → (toolId, toolName, contractorId)
    private val lastPositions = mutableMapOf<String, DoubleArray>() // toolId → [lat, lng, eventCode, timestamp]
    private var supabaseUrl = ""
    private var supabaseKey = ""
    private var scanning = false

    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            if (pauseScanning) return

            val mac = try { result.device.address } catch (e: SecurityException) { return }
            val tool = trackedTags[mac.uppercase()] ?: return

            lastScanTimestamp = System.currentTimeMillis()

            val (toolId, toolName, contractorId) = tool
            val last = lastPositions[toolId]
            val lastTime = last?.get(3)?.toLong() ?: 0L

            if (System.currentTimeMillis() - lastTime < THROTTLE_MS) return

            // Mark timestamp immediately to prevent concurrent GPS fetches for same tool
            lastPositions[toolId] = if (last != null)
                doubleArrayOf(last[0], last[1], last[2], System.currentTimeMillis().toDouble())
            else
                doubleArrayOf(0.0, 0.0, 0.0, System.currentTimeMillis().toDouble())

            Log.d(TAG, "📡 Detected: $toolName ($mac) rssi=${result.rssi}")
            fetchGpsAndSave(toolId, toolName, contractorId, last)
        }

        override fun onScanFailed(errorCode: Int) {
            Log.e(TAG, "BLE scan failed: $errorCode")
            scanning = false
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        Log.i(TAG, "Service created")

        createNotificationChannel()
        val notification = buildNotification("Iniciando rastreamento...")

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
        startScan()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        loadConfig()
        Log.i(TAG, "Service started with ${trackedTags.size} tags")
        restartScan()
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        instance = null
        stopScan()
        saveLastPositions()
        Log.i(TAG, "Service destroyed")

        try {
            val intent = Intent(this, BleTrackingService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(intent)
            else startService(intent)
        } catch (e: Exception) { /* ignore */ }
    }

    // ─── BLE Scanner ───────────────────────────────────────────────────

    private fun startScan() {
        if (scanning) return
        if (trackedTags.isEmpty()) {
            Log.w(TAG, "No tags to track")
            updateNotification("Sem ferramentas configuradas")
            return
        }

        val adapter = (getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
        if (adapter == null || !adapter.isEnabled) {
            Log.w(TAG, "Bluetooth not available")
            return
        }

        val scanner = adapter.bluetoothLeScanner ?: run {
            Log.w(TAG, "BLE scanner not available")
            return
        }

        val filters = trackedTags.keys.map { mac ->
            ScanFilter.Builder().setDeviceAddress(mac).build()
        }

        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_BALANCED)
            .setReportDelay(0)
            .build()

        try {
            scanner.startScan(filters, settings, scanCallback)
            scanning = true
            Log.i(TAG, "BLE scan started for ${trackedTags.size} tag(s)")
            updateNotification("Rastreando ${trackedTags.size} ferramenta(s)")
        } catch (e: SecurityException) {
            Log.e(TAG, "BLE scan permission denied: ${e.message}")
        }
    }

    private fun stopScan() {
        if (!scanning) return
        try {
            val adapter = (getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
            adapter?.bluetoothLeScanner?.stopScan(scanCallback)
        } catch (e: Exception) { /* ignore */ }
        scanning = false
        Log.i(TAG, "BLE scan stopped")
    }

    internal fun restartScan() {
        stopScan()
        startScan()
    }

    // ─── GPS + Save ────────────────────────────────────────────────────

    private fun fetchGpsAndSave(toolId: String, toolName: String, contractorId: String, last: DoubleArray?) {
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

                    if (last == null) {
                        lastPositions[toolId] = doubleArrayOf(lat, lng, 0.0, now.toDouble())
                        Log.d(TAG, "First detection: $toolName")
                        saveLastPositions()
                        return@addOnSuccessListener
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
                            saveLastPositions()
                            return@addOnSuccessListener
                        }
                    }

                    saveMovement(toolId, contractorId, event, lat, lng, speed)
                    lastPositions[toolId] = doubleArrayOf(lat, lng, eventCode, now.toDouble())
                    Log.i(TAG, "✅ $event → $toolName (${"%.0f".format(speed)}km/h)")
                    updateNotification("$toolName • $event")
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

    internal fun loadConfig() {
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
