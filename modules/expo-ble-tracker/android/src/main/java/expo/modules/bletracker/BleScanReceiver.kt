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
 * Registered in AndroidManifest — receives scan results even when the
 * service is dead. Processes detections directly and restarts the service.
 */
class BleScanReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "BleTracker"
        private const val PREFS_NAME = "ble_tracker_prefs"
        private const val KEY_TRACKED_TAGS = "tracked_tags"
        private const val KEY_SUPABASE_URL = "supabase_url"
        private const val KEY_SUPABASE_KEY = "supabase_key"
        private const val KEY_LAST_POSITIONS = "last_positions"
        private const val KEY_LAST_SAVE_TIMES = "last_save_times"
        private const val MIN_DISTANCE_M = 15.0
        private const val STOP_TIMEOUT_MS = 4 * 60 * 1000L
        private const val COOLDOWN_MS = 2 * 60 * 1000L
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
        val tagsJson = prefs.getString(KEY_TRACKED_TAGS, "{}") ?: "{}"
        val trackedTags = mutableMapOf<String, Triple<String, String, String>>() // MAC → (toolId, toolName, contractorId)

        try {
            val obj = JSONObject(tagsJson)
            val keys = obj.keys()
            while (keys.hasNext()) {
                val tagId = keys.next()
                val t = obj.getJSONObject(tagId)
                trackedTags[tagId] = Triple(t.getString("toolId"), t.getString("toolName"), t.getString("contractorId"))
            }
        } catch (e: Exception) { return }

        if (trackedTags.isEmpty()) return

        // Match detected MACs
        val detectedTools = mutableSetOf<Triple<String, String, String>>()
        for (result in results) {
            val mac = try { result.device.address } catch (e: SecurityException) { continue }
            trackedTags[mac]?.let { detectedTools.add(it) }
        }

        if (detectedTools.isEmpty()) return

        Log.d(TAG, "📡 Receiver: ${detectedTools.size} tag(s) detected")

        // Get GPS and save
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
                        Log.d(TAG, "Receiver: GPS accuracy too low (${accuracy.toInt()}m)")
                        return@addOnSuccessListener
                    }

                    val supabaseUrl = prefs.getString(KEY_SUPABASE_URL, "") ?: ""
                    val supabaseKey = prefs.getString(KEY_SUPABASE_KEY, "") ?: ""
                    if (supabaseUrl.isEmpty() || supabaseKey.isEmpty()) return@addOnSuccessListener

                    // Load persisted state
                    val lastPositions = loadLastPositions(prefs)
                    val lastSaveTimes = loadLastSaveTimes(prefs)
                    val now = System.currentTimeMillis()

                    for ((toolId, toolName, contractorId) in detectedTools) {
                        val last = lastPositions[toolId]
                        val lastSave = lastSaveTimes[toolId] ?: 0L
                        val sinceLastSave = now - lastSave

                        // First detection
                        if (last == null) {
                            lastPositions[toolId] = arrayOf(lat, lng, "detected", now.toDouble())
                            Log.d(TAG, "Receiver: First detection $toolName")
                            continue
                        }

                        val lastLat = last[0]
                        val lastLng = last[1]
                        val lastEvent = if (last[2] is String) last[2] as String else "unknown"
                        val lastTime = (last[3] as Double).toLong()
                        val dist = haversine(lat, lng, lastLat as Double, lastLng as Double)
                        val timeSince = now - lastTime
                        val threshold = maxOf(MIN_DISTANCE_M, accuracy * 2)

                        // Cooldown check
                        if (sinceLastSave < COOLDOWN_MS) {
                            // Update position without saving
                            val event = if (speed >= 10) "speed" else if (dist > threshold) "movement" else lastEvent
                            lastPositions[toolId] = arrayOf(lat, lng, event, now.toDouble())
                            continue
                        }

                        // Speed
                        if (speed >= 10) {
                            saveMovement(supabaseUrl, supabaseKey, toolId, contractorId, "speed", lat, lng, speed)
                            lastPositions[toolId] = arrayOf(lat, lng, "speed", now.toDouble())
                            lastSaveTimes[toolId] = now
                            Log.d(TAG, "Receiver: SPEED $toolName")
                            continue
                        }

                        // Movement
                        if (dist > threshold) {
                            saveMovement(supabaseUrl, supabaseKey, toolId, contractorId, "movement", lat, lng, speed)
                            lastPositions[toolId] = arrayOf(lat, lng, "movement", now.toDouble())
                            lastSaveTimes[toolId] = now
                            Log.d(TAG, "Receiver: MOVEMENT $toolName")
                            continue
                        }

                        // Stop
                        if (timeSince > STOP_TIMEOUT_MS && lastEvent != "stop") {
                            saveMovement(supabaseUrl, supabaseKey, toolId, contractorId, "stop", lat, lng, 0.0)
                            lastPositions[toolId] = arrayOf(lat, lng, "stop", now.toDouble())
                            lastSaveTimes[toolId] = now
                            Log.d(TAG, "Receiver: STOP $toolName")
                            continue
                        }

                        // Heartbeat
                        if (timeSince > 60 * 60 * 1000) {
                            saveMovement(supabaseUrl, supabaseKey, toolId, contractorId, "stop", lat, lng, 0.0)
                            lastPositions[toolId] = arrayOf(lat, lng, "stop", now.toDouble())
                            lastSaveTimes[toolId] = now
                        }
                    }

                    // Persist state
                    persistLastPositions(prefs, lastPositions)
                    persistLastSaveTimes(prefs, lastSaveTimes)
                }
        } catch (e: SecurityException) {
            Log.e(TAG, "Receiver: Location permission denied")
        }

        // Ensure service is running
        try {
            val svcIntent = Intent(context, BleTrackingService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(svcIntent)
            } else {
                context.startService(svcIntent)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Receiver: Could not restart service: ${e.message}")
        }
    }

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
                val code = conn.responseCode; conn.disconnect()
                if (code in 200..299) Log.i(TAG, "✅ Receiver: $event → $toolId")

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
            } catch (e: Exception) { Log.e(TAG, "Receiver save error: ${e.message}") }
        }.start()
    }

    private fun loadLastPositions(prefs: android.content.SharedPreferences): MutableMap<String, Array<Any>> {
        val map = mutableMapOf<String, Array<Any>>()
        try {
            val json = prefs.getString(KEY_LAST_POSITIONS, "{}") ?: "{}"
            val obj = JSONObject(json)
            val keys = obj.keys()
            while (keys.hasNext()) {
                val toolId = keys.next()
                val p = obj.getJSONObject(toolId)
                map[toolId] = arrayOf(p.getDouble("lat"), p.getDouble("lng"), p.getString("event"), p.getDouble("timestamp"))
            }
        } catch (e: Exception) { /* ignore */ }
        return map
    }

    private fun persistLastPositions(prefs: android.content.SharedPreferences, map: Map<String, Array<Any>>) {
        val obj = JSONObject()
        for ((toolId, arr) in map) {
            obj.put(toolId, JSONObject().apply {
                put("lat", arr[0]); put("lng", arr[1]); put("event", arr[2]); put("timestamp", arr[3])
            })
        }
        prefs.edit().putString(KEY_LAST_POSITIONS, obj.toString()).apply()
    }

    private fun loadLastSaveTimes(prefs: android.content.SharedPreferences): MutableMap<String, Long> {
        val map = mutableMapOf<String, Long>()
        try {
            val json = prefs.getString(KEY_LAST_SAVE_TIMES, "{}") ?: "{}"
            val obj = JSONObject(json)
            val keys = obj.keys()
            while (keys.hasNext()) {
                val k = keys.next()
                map[k] = obj.getLong(k)
            }
        } catch (e: Exception) { /* ignore */ }
        return map
    }

    private fun persistLastSaveTimes(prefs: android.content.SharedPreferences, map: Map<String, Long>) {
        val obj = JSONObject()
        for ((k, v) in map) obj.put(k, v)
        prefs.edit().putString(KEY_LAST_SAVE_TIMES, obj.toString()).apply()
    }

    private fun haversine(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val R = 6371000.0
        val dLat = Math.toRadians(lat2 - lat1); val dLon = Math.toRadians(lon2 - lon1)
        val a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    }
}
