package expo.modules.bletracker

import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanResult
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Static BroadcastReceiver for PendingIntent BLE scan results.
 *
 * Called every ~2 minutes (controlled by reportDelay=120000 in BleTrackingService).
 * Each call = one batch of detected devices. Simple logic:
 *   1. Match MACs against tracked tags
 *   2. Get GPS
 *   3. Determine event type (speed/movement/stop/heartbeat)
 *   4. Save ONE record per tool per batch
 *
 * No cooldown logic needed — the 2-min reportDelay handles throttling at system level.
 */
class BleScanReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "BleTracker"
        private const val PREFS_NAME = "ble_tracker_prefs"
        private const val KEY_TRACKED_TAGS = "tracked_tags"
        private const val KEY_SUPABASE_URL = "supabase_url"
        private const val KEY_SUPABASE_KEY = "supabase_key"
        private const val KEY_LAST_POSITIONS = "last_positions"
        private const val MIN_DISTANCE_M = 15.0
        private const val STOP_TIMEOUT_MS = 4 * 60 * 1000L
    }

    override fun onReceive(context: Context, intent: Intent) {
        val results = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableArrayListExtra(BluetoothLeScanner.EXTRA_LIST_SCAN_RESULT, ScanResult::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableArrayListExtra(BluetoothLeScanner.EXTRA_LIST_SCAN_RESULT)
        }

        if (results.isNullOrEmpty()) return

        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

        // Load tracked tags
        val trackedTags = mutableMapOf<String, Triple<String, String, String>>()
        try {
            val obj = JSONObject(prefs.getString(KEY_TRACKED_TAGS, "{}") ?: "{}")
            val keys = obj.keys()
            while (keys.hasNext()) {
                val tagId = keys.next()
                val t = obj.getJSONObject(tagId)
                trackedTags[tagId] = Triple(t.getString("toolId"), t.getString("toolName"), t.getString("contractorId"))
            }
        } catch (e: Exception) { return }

        if (trackedTags.isEmpty()) return

        // Match detected MACs — deduplicate to one per tool
        val detectedTools = mutableMapOf<String, Triple<String, String, String>>() // toolId → (toolId, toolName, contractorId)
        for (result in results) {
            val mac = try { result.device.address } catch (e: SecurityException) { continue }
            val tool = trackedTags[mac] ?: continue
            detectedTools[tool.first] = tool // dedupe by toolId
        }

        if (detectedTools.isEmpty()) return
        Log.d(TAG, "📡 Batch: ${detectedTools.size} tool(s)")

        // Get GPS
        try {
            val fusedLocation = LocationServices.getFusedLocationProviderClient(context)
            val cts = CancellationTokenSource()
            fusedLocation.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, cts.token)
                .addOnSuccessListener { location ->
                    if (location == null) return@addOnSuccessListener

                    val lat = location.latitude
                    val lng = location.longitude
                    val accuracy = location.accuracy.toDouble()
                    val speed = location.speed.toDouble() * 3.6

                    if (accuracy > 50) {
                        Log.d(TAG, "GPS accuracy too low (${accuracy.toInt()}m)")
                        return@addOnSuccessListener
                    }

                    val supabaseUrl = prefs.getString(KEY_SUPABASE_URL, "") ?: ""
                    val supabaseKey = prefs.getString(KEY_SUPABASE_KEY, "") ?: ""
                    if (supabaseUrl.isEmpty() || supabaseKey.isEmpty()) return@addOnSuccessListener

                    val lastPositions = loadLastPositions(prefs)
                    val now = System.currentTimeMillis()

                    for ((toolId, toolName, contractorId) in detectedTools.values) {
                        val last = lastPositions[toolId]

                        // First detection
                        if (last == null) {
                            lastPositions[toolId] = doubleArrayOf(lat, lng, 0.0, now.toDouble())
                            Log.d(TAG, "First: $toolName")
                            continue
                        }

                        val lastLat = last[0]
                        val lastLng = last[1]
                        val lastEventCode = last[2].toInt() // 0=detected, 1=speed, 2=movement, 3=stop
                        val lastTime = last[3].toLong()
                        val dist = haversine(lat, lng, lastLat, lastLng)
                        val timeSince = now - lastTime
                        val threshold = maxOf(MIN_DISTANCE_M, accuracy * 2)

                        val event: String
                        val eventCode: Double

                        when {
                            // Speed: >10 km/h
                            speed >= 10 -> {
                                event = "speed"; eventCode = 1.0
                            }
                            // Movement: position changed significantly
                            dist > threshold -> {
                                event = "movement"; eventCode = 2.0
                            }
                            // Stop: stationary >4 min, was moving
                            timeSince > STOP_TIMEOUT_MS && lastEventCode != 3 -> {
                                event = "stop"; eventCode = 3.0
                            }
                            // Heartbeat: >1h stationary
                            timeSince > 60 * 60 * 1000 -> {
                                event = "stop"; eventCode = 3.0
                            }
                            // No significant change — skip
                            else -> {
                                lastPositions[toolId] = doubleArrayOf(lat, lng, lastEventCode.toDouble(), now.toDouble())
                                continue
                            }
                        }

                        saveMovement(supabaseUrl, supabaseKey, toolId, contractorId, event, lat, lng, speed)
                        lastPositions[toolId] = doubleArrayOf(lat, lng, eventCode, now.toDouble())
                        Log.d(TAG, "✅ $event → $toolName (${"%.0f".format(speed)}km/h, ${"%.0f".format(dist)}m)")
                    }

                    persistLastPositions(prefs, lastPositions)
                }
        } catch (e: SecurityException) {
            Log.e(TAG, "Location permission denied")
        }

        // Ensure service is running
        try {
            val svcIntent = Intent(context, BleTrackingService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(svcIntent)
            } else {
                context.startService(svcIntent)
            }
        } catch (e: Exception) { /* ignore */ }
    }

    // ─── Supabase ──────────────────────────────────────────────────────

    private fun saveMovement(url: String, key: String, toolId: String, contractorId: String, event: String, lat: Double, lng: Double, speed: Double) {
        Thread {
            try {
                val body = JSONObject().apply {
                    put("tool_id", toolId); put("contractor_id", contractorId)
                    put("event", event); put("latitude", lat); put("longitude", lng); put("speed_kmh", speed)
                }
                val conn = URL("$url/rest/v1/tool_movements").openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("apikey", key); conn.setRequestProperty("Authorization", "Bearer $key")
                conn.setRequestProperty("Content-Type", "application/json"); conn.setRequestProperty("Prefer", "return=minimal")
                conn.doOutput = true; conn.outputStream.write(body.toString().toByteArray())
                conn.responseCode; conn.disconnect()

                // Update last_seen_location
                val locBody = JSONObject().apply {
                    put("last_seen_location", JSONObject().apply {
                        put("latitude", lat); put("longitude", lng)
                        put("timestamp", java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US).apply {
                            timeZone = java.util.TimeZone.getTimeZone("UTC")
                        }.format(java.util.Date()))
                    })
                }
                val conn2 = URL("$url/rest/v1/tools?id=eq.$toolId").openConnection() as HttpURLConnection
                conn2.requestMethod = "PATCH"; conn2.setRequestProperty("apikey", key); conn2.setRequestProperty("Authorization", "Bearer $key")
                conn2.setRequestProperty("Content-Type", "application/json"); conn2.setRequestProperty("Prefer", "return=minimal")
                conn2.doOutput = true; conn2.outputStream.write(locBody.toString().toByteArray()); conn2.responseCode; conn2.disconnect()
            } catch (e: Exception) { Log.e(TAG, "Save error: ${e.message}") }
        }.start()
    }

    // ─── State Persistence ─────────────────────────────────────────────

    private fun loadLastPositions(prefs: android.content.SharedPreferences): MutableMap<String, DoubleArray> {
        val map = mutableMapOf<String, DoubleArray>()
        try {
            val obj = JSONObject(prefs.getString(KEY_LAST_POSITIONS, "{}") ?: "{}")
            val keys = obj.keys()
            while (keys.hasNext()) {
                val toolId = keys.next()
                val p = obj.getJSONObject(toolId)
                map[toolId] = doubleArrayOf(p.getDouble("lat"), p.getDouble("lng"), p.optDouble("event", 0.0), p.getDouble("timestamp"))
            }
        } catch (e: Exception) { /* ignore */ }
        return map
    }

    private fun persistLastPositions(prefs: android.content.SharedPreferences, map: Map<String, DoubleArray>) {
        val obj = JSONObject()
        for ((toolId, arr) in map) {
            obj.put(toolId, JSONObject().apply {
                put("lat", arr[0]); put("lng", arr[1]); put("event", arr[2]); put("timestamp", arr[3])
            })
        }
        prefs.edit().putString(KEY_LAST_POSITIONS, obj.toString()).commit()
    }

    // ─── Utils ─────────────────────────────────────────────────────────

    private fun haversine(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val R = 6371000.0
        val dLat = Math.toRadians(lat2 - lat1); val dLon = Math.toRadians(lon2 - lon1)
        val a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    }
}
