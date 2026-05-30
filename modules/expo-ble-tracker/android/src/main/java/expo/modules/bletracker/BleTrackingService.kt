package expo.modules.bletracker

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

class BleTrackingService : Service() {

    companion object {
        private const val TAG = "BleTracker"
        private const val CHANNEL_ID = "ble_tracker_channel"
        private const val NOTIFICATION_ID = 9001
        private const val MIN_DISTANCE_M = 15.0
        private const val STOP_TIMEOUT_MS = 4 * 60 * 1000L
        private const val THROTTLE_MS = 110_000L
        private const val HTTP_CONNECT_TIMEOUT_MS = 10_000
        private const val HTTP_READ_TIMEOUT_MS = 15_000
        private const val OFFLINE_QUEUE_MAX = 200

        @Volatile var lastScanTimestamp = 0L
        @Volatile var instance: BleTrackingService? = null

        // Atomic pause counter — supports nested pauses from foreground scan + ring + pair
        private val pauseCounter = AtomicInteger(0)

        val pauseScanning: Boolean
            get() = pauseCounter.get() > 0

        fun acquirePause() = pauseCounter.incrementAndGet()
        fun releasePause(): Int {
            val v = pauseCounter.decrementAndGet()
            return if (v < 0) {
                pauseCounter.set(0); 0
            } else v
        }
    }

    private val trackedTags = ConcurrentHashMap<String, TrackedTag>()
    private val lastPositions = ConcurrentHashMap<String, Position>()
    private var supabaseUrl = ""
    private var supabaseKey = ""

    @Volatile private var scanning = false
    @Volatile private var hasLocationPermission = false

    private val serviceScope: CoroutineScope =
        CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var pendingLocationCts: CancellationTokenSource? = null

    private val bluetoothStateReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action != BluetoothAdapter.ACTION_STATE_CHANGED) return
            when (intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR)) {
                BluetoothAdapter.STATE_OFF -> {
                    Log.w(TAG, "Bluetooth turned OFF")
                    stopScan()
                    updateNotification("Bluetooth desligado")
                }
                BluetoothAdapter.STATE_ON -> {
                    Log.i(TAG, "Bluetooth turned ON")
                    if (!pauseScanning) startScan()
                }
            }
        }
    }

    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            if (pauseScanning) return

            val mac = try {
                result.device.address?.uppercase() ?: return
            } catch (e: SecurityException) {
                return
            }

            val tracked = trackedTags[mac] ?: return
            lastScanTimestamp = System.currentTimeMillis()

            // Atomic compute: only proceed if not throttled, mark timestamp immediately to
            // dedupe concurrent fetches for the same tool
            val now = System.currentTimeMillis()
            var shouldFetch = false
            lastPositions.compute(tracked.toolId) { _, existing ->
                if (existing == null) {
                    shouldFetch = true
                    Position(0.0, 0.0, 0, now)
                } else if (now - existing.timestamp >= THROTTLE_MS) {
                    shouldFetch = true
                    existing.copy(timestamp = now)
                } else {
                    existing
                }
            }
            if (!shouldFetch) return

            Log.d(TAG, "Detected: ${tracked.toolName} ($mac) rssi=${result.rssi}")
            // Emit to JS regardless of GPS outcome
            ExpoBleTrackerModule.instance?.emitTagDetected(
                mapOf(
                    "tagId" to mac,
                    "toolId" to tracked.toolId,
                    "toolName" to tracked.toolName,
                    "rssi" to result.rssi,
                    "timestamp" to now,
                )
            )
            fetchGpsAndSave(tracked)
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

        hasLocationPermission = ContextCompat.checkSelfPermission(
            this, Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED

        createNotificationChannel()
        val notification = buildNotification("Iniciando rastreamento...")

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val fgsType = if (hasLocationPermission) {
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION or
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
                } else {
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
                }
                startForeground(NOTIFICATION_ID, notification, fgsType)
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
        } catch (e: Exception) {
            Log.e(TAG, "startForeground failed: ${e.message}")
            stopSelf()
            return
        }

        // Register BT state receiver
        try {
            registerReceiver(
                bluetoothStateReceiver,
                IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED)
            )
        } catch (e: Exception) {
            Log.w(TAG, "Could not register BT state receiver: ${e.message}")
        }

        loadConfig()
        loadLastPositions()
        drainOfflineQueue()
        startScan()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        loadConfig()
        Log.i(TAG, "Service started with ${trackedTags.size} tags")
        if (!pauseScanning) restartScan()
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        instance = null
        stopScan()
        saveLastPositions()
        pendingLocationCts?.cancel()
        try { unregisterReceiver(bluetoothStateReceiver) } catch (_: Exception) {}
        serviceScope.cancel()
        Log.i(TAG, "Service destroyed")
        // NOTE: Do not self-restart here — Android 12+ disallows starting FGS
        // from background. Rely on START_STICKY and BootReceiver instead.
    }

    // ─── BLE Scanner ───────────────────────────────────────────────────

    internal fun startScan() {
        if (scanning) return
        if (trackedTags.isEmpty()) {
            Log.w(TAG, "No tags to track")
            updateNotification("Sem ferramentas configuradas")
            return
        }

        val adapter = (getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
        if (adapter == null || !adapter.isEnabled) {
            Log.w(TAG, "Bluetooth not available")
            updateNotification("Bluetooth desligado")
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
        } catch (e: IllegalStateException) {
            Log.e(TAG, "BLE scan illegal state: ${e.message}")
        }
    }

    internal fun stopScan() {
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

    private fun fetchGpsAndSave(tracked: TrackedTag) {
        if (!hasLocationPermission) {
            Log.w(TAG, "Skipping GPS — no location permission")
            return
        }
        try {
            val fusedLocation = LocationServices.getFusedLocationProviderClient(this)
            val cts = CancellationTokenSource()
            pendingLocationCts = cts
            fusedLocation.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, cts.token)
                ?.addOnSuccessListener { location ->
                    pendingLocationCts = null
                    if (location == null) { Log.w(TAG, "GPS null"); return@addOnSuccessListener }

                    val lat = location.latitude
                    val lng = location.longitude
                    val accuracy = location.accuracy.toDouble()
                    val speed = location.speed.toDouble() * 3.6

                    Log.d(TAG, "GPS: (${"%.5f".format(lat)}, ${"%.5f".format(lng)}) acc=${accuracy.toInt()}m spd=${"%.0f".format(speed)}km/h")

                    if (accuracy > 150) {
                        Log.d(TAG, "GPS accuracy too low — skipping")
                        return@addOnSuccessListener
                    }

                    handleGpsResult(tracked, lat, lng, accuracy, speed)
                }
                ?.addOnFailureListener { e ->
                    pendingLocationCts = null
                    Log.w(TAG, "GPS request failed: ${e.message}")
                }
        } catch (e: SecurityException) {
            Log.e(TAG, "Location denied")
        }
    }

    private fun handleGpsResult(
        tracked: TrackedTag,
        lat: Double,
        lng: Double,
        accuracy: Double,
        speed: Double,
    ) {
        val now = System.currentTimeMillis()
        val threshold = maxOf(MIN_DISTANCE_M, accuracy * 2)

        // Atomic state transition — decide event under the same lock-equivalent
        // (compute is atomic per key in ConcurrentHashMap)
        var decision: GpsDecision = GpsDecision.None
        lastPositions.compute(tracked.toolId) { _, existing ->
            if (existing == null || (existing.lat == 0.0 && existing.lng == 0.0)) {
                decision = GpsDecision.FirstFix
                Position(lat, lng, 0, now)
            } else {
                val dist = haversine(lat, lng, existing.lat, existing.lng)
                val timeSince = now - existing.timestamp

                when {
                    speed >= 10 -> {
                        decision = GpsDecision.Event("speed", 1)
                        Position(lat, lng, 1, now)
                    }
                    dist > threshold -> {
                        decision = GpsDecision.Event("movement", 2)
                        Position(lat, lng, 2, now)
                    }
                    timeSince > STOP_TIMEOUT_MS && existing.eventCode != 3 -> {
                        decision = GpsDecision.Event("stop", 3)
                        Position(lat, lng, 3, now)
                    }
                    timeSince > 60 * 60 * 1000 -> {
                        decision = GpsDecision.Event("stop", 3)
                        Position(lat, lng, 3, now)
                    }
                    else -> {
                        // NO event — keep baseline (lat/lng) fixed to prevent
                        // GPS-jitter drift from masking real movement
                        decision = GpsDecision.NoEvent
                        existing.copy(timestamp = now)
                    }
                }
            }
        }

        when (val d = decision) {
            GpsDecision.FirstFix -> {
                Log.d(TAG, "First detection: ${tracked.toolName}")
                saveLastPositions()
            }
            is GpsDecision.Event -> {
                saveMovement(tracked, d.event, lat, lng, speed)
                Log.i(TAG, "${d.event} -> ${tracked.toolName} (${"%.0f".format(speed)}km/h)")
                updateNotification("${tracked.toolName} • ${d.event}")
                saveLastPositions()
            }
            GpsDecision.NoEvent -> saveLastPositions()
            GpsDecision.None -> {}
        }
    }

    private sealed class GpsDecision {
        data object None : GpsDecision()
        data object FirstFix : GpsDecision()
        data object NoEvent : GpsDecision()
        data class Event(val event: String, val code: Int) : GpsDecision()
    }

    // ─── Supabase ──────────────────────────────────────────────────────

    private fun saveMovement(tracked: TrackedTag, event: String, lat: Double, lng: Double, speed: Double) {
        val body = JSONObject().apply {
            put("tool_id", tracked.toolId)
            put("contractor_id", tracked.contractorId)
            put("event", event)
            put("latitude", lat)
            put("longitude", lng)
            put("speed_kmh", speed)
            put("platform", "android")
        }
        serviceScope.launch {
            val ok = postMovement(body)
            if (!ok) {
                enqueueOffline(body)
            } else {
                drainOfflineQueue()
            }
            patchToolLocation(tracked.toolId, lat, lng)
        }
    }

    /** Returns true on 2xx, false on any failure. Does not throw. */
    private fun postMovement(body: JSONObject): Boolean {
        if (supabaseUrl.isEmpty() || supabaseKey.isEmpty()) return false
        if (!supabaseUrl.startsWith("https://")) {
            Log.e(TAG, "Refusing to POST over non-HTTPS")
            return false
        }
        var conn: HttpURLConnection? = null
        return try {
            conn = (URL("$supabaseUrl/rest/v1/tool_movements").openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = HTTP_CONNECT_TIMEOUT_MS
                readTimeout = HTTP_READ_TIMEOUT_MS
                setRequestProperty("apikey", supabaseKey)
                setRequestProperty("Authorization", "Bearer $supabaseKey")
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("Prefer", "return=minimal")
                doOutput = true
            }
            conn.outputStream.use { it.write(body.toString().toByteArray()) }
            val status = conn.responseCode
            if (status >= 300) {
                Log.w(TAG, "POST tool_movements -> $status")
                false
            } else true
        } catch (e: Exception) {
            Log.e(TAG, "POST tool_movements error: ${e.message}")
            false
        } finally {
            try { conn?.disconnect() } catch (_: Exception) {}
        }
    }

    private fun patchToolLocation(toolId: String, lat: Double, lng: Double) {
        if (supabaseUrl.isEmpty() || supabaseKey.isEmpty()) return
        if (!supabaseUrl.startsWith("https://")) return
        var conn: HttpURLConnection? = null
        try {
            val timestamp = java.text.SimpleDateFormat(
                "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US
            ).apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }.format(java.util.Date())
            val locBody = JSONObject().apply {
                put("last_seen_location", JSONObject().apply {
                    put("latitude", lat); put("longitude", lng); put("timestamp", timestamp)
                })
            }
            conn = (URL("$supabaseUrl/rest/v1/tools?id=eq.$toolId").openConnection() as HttpURLConnection).apply {
                requestMethod = "PATCH"
                connectTimeout = HTTP_CONNECT_TIMEOUT_MS
                readTimeout = HTTP_READ_TIMEOUT_MS
                setRequestProperty("apikey", supabaseKey)
                setRequestProperty("Authorization", "Bearer $supabaseKey")
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("Prefer", "return=minimal")
                doOutput = true
            }
            conn.outputStream.use { it.write(locBody.toString().toByteArray()) }
            val status = conn.responseCode
            if (status >= 300) Log.w(TAG, "PATCH tools -> $status")
        } catch (e: Exception) {
            Log.e(TAG, "PATCH tools error: ${e.message}")
        } finally {
            try { conn?.disconnect() } catch (_: Exception) {}
        }
    }

    // ─── Offline queue ────────────────────────────────────────────────

    private fun enqueueOffline(body: JSONObject) {
        try {
            val prefs = PrefsStore.regular(this)
            val arr = JSONArray(prefs.getString(PrefsStore.KEY_PENDING_MOVEMENTS, "[]") ?: "[]")
            arr.put(body)
            // Trim oldest if over cap (JSONArray.remove available since API 19)
            while (arr.length() > OFFLINE_QUEUE_MAX) {
                arr.remove(0)
            }
            prefs.edit().putString(PrefsStore.KEY_PENDING_MOVEMENTS, arr.toString()).apply()
            Log.i(TAG, "Enqueued offline movement (queue size=${arr.length()})")
        } catch (e: Exception) {
            Log.e(TAG, "enqueueOffline failed: ${e.message}")
        }
    }

    private fun drainOfflineQueue() {
        if (supabaseUrl.isEmpty() || supabaseKey.isEmpty()) return
        serviceScope.launch {
            try {
                val prefs = PrefsStore.regular(this@BleTrackingService)
                val arr = JSONArray(prefs.getString(PrefsStore.KEY_PENDING_MOVEMENTS, "[]") ?: "[]")
                if (arr.length() == 0) return@launch
                val remaining = JSONArray()
                var sent = 0
                for (i in 0 until arr.length()) {
                    val item = arr.getJSONObject(i)
                    if (postMovement(item)) sent++ else remaining.put(item)
                }
                prefs.edit().putString(PrefsStore.KEY_PENDING_MOVEMENTS, remaining.toString()).apply()
                if (sent > 0) Log.i(TAG, "Drained $sent offline movements (${remaining.length()} remain)")
            } catch (e: Exception) {
                Log.e(TAG, "drainOfflineQueue failed: ${e.message}")
            }
        }
    }

    // ─── Config & State ────────────────────────────────────────────────

    internal fun loadConfig() {
        val secure = PrefsStore.secure(this)
        supabaseUrl = secure.getString(PrefsStore.KEY_SUPABASE_URL, "") ?: ""
        supabaseKey = secure.getString(PrefsStore.KEY_SUPABASE_KEY, "") ?: ""

        val regular = PrefsStore.regular(this)
        trackedTags.clear()
        try {
            val obj = JSONObject(regular.getString(PrefsStore.KEY_TRACKED_TAGS, "{}") ?: "{}")
            val keys = obj.keys()
            while (keys.hasNext()) {
                val tagId = keys.next()
                val t = obj.getJSONObject(tagId)
                trackedTags[tagId.uppercase()] = TrackedTag(
                    toolId = t.getString("toolId"),
                    toolName = t.getString("toolName"),
                    contractorId = t.getString("contractorId"),
                )
            }
        } catch (e: Exception) { /* ignore */ }
        Log.i(TAG, "Config: ${trackedTags.size} tags")
    }

    private fun loadLastPositions() {
        val prefs = PrefsStore.regular(this)
        lastPositions.clear()
        try {
            val obj = JSONObject(prefs.getString(PrefsStore.KEY_LAST_POSITIONS, "{}") ?: "{}")
            val keys = obj.keys()
            while (keys.hasNext()) {
                val toolId = keys.next()
                val p = obj.getJSONObject(toolId)
                lastPositions[toolId] = Position(
                    lat = p.getDouble("lat"),
                    lng = p.getDouble("lng"),
                    eventCode = p.optInt("event", 0),
                    timestamp = p.getLong("timestamp"),
                )
            }
        } catch (e: Exception) { /* ignore */ }
    }

    private fun saveLastPositions() {
        val obj = JSONObject()
        for ((toolId, pos) in lastPositions) {
            obj.put(toolId, JSONObject().apply {
                put("lat", pos.lat); put("lng", pos.lng)
                put("event", pos.eventCode); put("timestamp", pos.timestamp)
            })
        }
        // .apply() is async and safe to call from any thread
        PrefsStore.regular(this).edit()
            .putString(PrefsStore.KEY_LAST_POSITIONS, obj.toString())
            .apply()
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
        try {
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
                .notify(NOTIFICATION_ID, buildNotification(text))
        } catch (e: Exception) { /* ignore — POST_NOTIFICATIONS may be denied */ }
    }

    // ─── Utils ─────────────────────────────────────────────────────────

    private fun haversine(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val R = 6371000.0
        val dLat = Math.toRadians(lat2 - lat1); val dLon = Math.toRadians(lon2 - lon1)
        val a = kotlin.math.sin(dLat / 2) * kotlin.math.sin(dLat / 2) +
            kotlin.math.cos(Math.toRadians(lat1)) * kotlin.math.cos(Math.toRadians(lat2)) *
            kotlin.math.sin(dLon / 2) * kotlin.math.sin(dLon / 2)
        return R * 2 * kotlin.math.atan2(kotlin.math.sqrt(a), kotlin.math.sqrt(1 - a))
    }

    // ─── Data classes ──────────────────────────────────────────────────

    private data class TrackedTag(
        val toolId: String,
        val toolName: String,
        val contractorId: String,
    )

    private data class Position(
        val lat: Double,
        val lng: Double,
        val eventCode: Int,
        val timestamp: Long,
    )
}
