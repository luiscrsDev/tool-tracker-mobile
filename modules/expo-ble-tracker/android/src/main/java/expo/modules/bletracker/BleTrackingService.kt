package expo.modules.bletracker

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import org.altbeacon.beacon.*
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * BLE Tracking Service using Android Beacon Library (AltBeacon).
 *
 * The library manages ALL BLE scanning internally:
 * - Foreground: 1.1s scan, continuous
 * - Background: 3s scan every 2 min (duty cycle ~2.5%)
 * - Handles Samsung quirks, Android version differences, battery optimization
 * - Survives background, doze, screen off
 *
 * We only:
 * 1. Configure the library with scan periods and MAC filters
 * 2. Listen for ranging callbacks (1x per scan cycle)
 * 3. Get GPS and save to Supabase when tools are detected
 */
class BleTrackingService : Service(), RangeNotifier {

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

        @Volatile var pauseScanning = false
        @Volatile var lastScanTimestamp = 0L
    }

    private var beaconManager: BeaconManager? = null
    private val trackedTags = mutableMapOf<String, Triple<String, String, String>>() // MAC → (toolId, toolName, contractorId)
    private val lastPositions = mutableMapOf<String, DoubleArray>() // toolId → [lat, lng, eventCode, timestamp]
    private val regions = mutableListOf<Region>()
    private var supabaseUrl = ""
    private var supabaseKey = ""
    private var lastRangeTimestamp = 0L

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
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
        setupBeaconManager()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        loadConfig()
        Log.i(TAG, "Service started with ${trackedTags.size} tags")
        restartRanging()
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        stopRanging()
        saveLastPositions()
        Log.i(TAG, "Service destroyed")

        // Self-restart
        try {
            val intent = Intent(this, BleTrackingService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(intent)
            else startService(intent)
        } catch (e: Exception) { /* ignore */ }
    }

    // ─── AltBeacon Setup ───────────────────────────────────────────────

    private fun setupBeaconManager() {
        beaconManager = BeaconManager.getInstanceForApplication(this)

        // Add parsers for Eddystone (MokoSmart M1P uses Eddystone UID)
        beaconManager?.beaconParsers?.add(BeaconParser().setBeaconLayout(BeaconParser.EDDYSTONE_UID_LAYOUT))
        beaconManager?.beaconParsers?.add(BeaconParser().setBeaconLayout(BeaconParser.EDDYSTONE_TLM_LAYOUT))
        // Also add iBeacon parser (M1P can broadcast as iBeacon)
        beaconManager?.beaconParsers?.add(BeaconParser().setBeaconLayout("m:2-3=0215,i:4-19,i:20-21,i:22-23,p:24-24"))
        // AltBeacon format
        beaconManager?.beaconParsers?.add(AltBeaconParser())

        // Configure scan periods
        beaconManager?.foregroundScanPeriod = 1100       // 1.1s scan in foreground
        beaconManager?.foregroundBetweenScanPeriod = 0   // continuous in foreground
        beaconManager?.backgroundScanPeriod = 3000       // 3s scan in background
        beaconManager?.backgroundBetweenScanPeriod = 117000 // 117s pause = 2 min cycle

        // Enable foreground service so scanning persists in background
        beaconManager?.enableForegroundServiceScanning(buildNotification("Rastreando ferramentas..."), NOTIFICATION_ID)
        beaconManager?.setEnableScheduledScanJobs(false) // Disable JobScheduler, use foreground service only

        // Add range notifier
        beaconManager?.addRangeNotifier(this)

        Log.i(TAG, "AltBeacon manager configured")
        startRanging()
    }

    // ─── Ranging ───────────────────────────────────────────────────────

    private fun startRanging() {
        if (trackedTags.isEmpty()) {
            Log.w(TAG, "No tags to track")
            updateNotification("Sem ferramentas configuradas")
            return
        }

        // Create a Region for each tracked MAC
        regions.clear()
        for ((mac, tool) in trackedTags) {
            val region = Region("tool-${tool.first}", mac)
            regions.add(region)
            beaconManager?.startRangingBeacons(region)
            Log.d(TAG, "Ranging started for ${tool.second} ($mac)")
        }

        updateNotification("Rastreando ${trackedTags.size} ferramenta(s)")
    }

    private fun stopRanging() {
        for (region in regions) {
            try { beaconManager?.stopRangingBeacons(region) } catch (e: Exception) { /* ignore */ }
        }
        regions.clear()
    }

    private fun restartRanging() {
        stopRanging()
        startRanging()
    }

    // ─── RangeNotifier Callback ────────────────────────────────────────

    override fun didRangeBeaconsInRegion(beacons: Collection<Beacon>, region: Region) {
        if (beacons.isEmpty() || pauseScanning) return

        lastScanTimestamp = System.currentTimeMillis()

        // Find which tool this region belongs to
        val mac = region.bluetoothAddress ?: return
        val tool = trackedTags[mac] ?: return
        val (toolId, toolName, contractorId) = tool

        // Throttle: max 1 save per tool per 2 min
        val now = System.currentTimeMillis()
        val last = lastPositions[toolId]
        val lastTime = last?.get(3)?.toLong() ?: 0L
        if (now - lastTime < 110000) return // < 1 min 50s since last save (buffer for 2 min cycle)

        Log.d(TAG, "📡 Ranged: $toolName ($mac) ${beacons.size} beacon(s)")

        // Get GPS and process
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

                    val gpsNow = System.currentTimeMillis()

                    if (last == null) {
                        lastPositions[toolId] = doubleArrayOf(lat, lng, 0.0, gpsNow.toDouble())
                        Log.d(TAG, "First: $toolName")
                        saveLastPositions()
                        return@addOnSuccessListener
                    }

                    val lastLat = last[0]; val lastLng = last[1]
                    val lastEventCode = last[2].toInt()
                    val dist = haversine(lat, lng, lastLat, lastLng)
                    val timeSince = gpsNow - lastTime
                    val threshold = maxOf(MIN_DISTANCE_M, accuracy * 2)

                    val event: String; val eventCode: Double

                    when {
                        speed >= 10 -> { event = "speed"; eventCode = 1.0 }
                        dist > threshold -> { event = "movement"; eventCode = 2.0 }
                        timeSince > STOP_TIMEOUT_MS && lastEventCode != 3 -> { event = "stop"; eventCode = 3.0 }
                        timeSince > 60 * 60 * 1000 -> { event = "stop"; eventCode = 3.0 }
                        else -> {
                            // No significant change — update position without saving
                            lastPositions[toolId] = doubleArrayOf(lat, lng, last[2], gpsNow.toDouble())
                            saveLastPositions()
                            return@addOnSuccessListener
                        }
                    }

                    saveMovement(toolId, contractorId, event, lat, lng, speed)
                    lastPositions[toolId] = doubleArrayOf(lat, lng, eventCode, gpsNow.toDouble())
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
