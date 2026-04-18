package expo.modules.bletracker

import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.runBlocking
import org.json.JSONObject

class ExpoBleTrackerModule : Module() {

    companion object {
        private const val TAG = "BleTracker"
        private const val PREFS_NAME = "ble_tracker_prefs"
        private const val KEY_TRACKED_TAGS = "tracked_tags"
        private const val KEY_SUPABASE_URL = "supabase_url"
        private const val KEY_SUPABASE_KEY = "supabase_key"

        // Static reference for event emission from service
        var instance: ExpoBleTrackerModule? = null
    }

    private var foregroundScanner: BleForegroundScanner? = null

    override fun definition() = ModuleDefinition {
        Name("ExpoBleTracker")

        // ─── Events ─────────────────────────────────────────────────────
        Events(
            "onDeviceFound",      // Foreground scan result: {id, name, rssi, manufacturerData}
            "onTagDetected",      // Background detection: {tagId, toolId, toolName, lat, lng, event}
            "onScanStateChange",  // Scan started/stopped: {scanning: boolean}
            "onPairResult",       // Pair attempt result: {success, deviceId, message}
            "onRingResult",       // Ring attempt result: {success, deviceId, message}
        )

        OnCreate {
            instance = this@ExpoBleTrackerModule
        }

        OnDestroy {
            foregroundScanner?.stop()
            instance = null
        }

        // ─── Supabase Config ────────────────────────────────────────────
        Function("configure") { url: String, key: String ->
            getPrefs().edit()
                .putString(KEY_SUPABASE_URL, url)
                .putString(KEY_SUPABASE_KEY, key)
                .apply()
        }

        // ─── Tag Management ─────────────────────────────────────────────
        Function("addTag") { tagId: String, toolId: String, toolName: String, contractorId: String ->
            val prefs = getPrefs()
            val json = prefs.getString(KEY_TRACKED_TAGS, "{}") ?: "{}"
            val obj = JSONObject(json)
            obj.put(tagId.uppercase(), JSONObject().apply {
                put("toolId", toolId)
                put("toolName", toolName)
                put("contractorId", contractorId)
            })
            prefs.edit().putString(KEY_TRACKED_TAGS, obj.toString()).apply()
            notifyService()
            Log.i(TAG, "Tag added: $tagId → $toolName")
        }

        Function("removeTag") { tagId: String ->
            val prefs = getPrefs()
            val json = prefs.getString(KEY_TRACKED_TAGS, "{}") ?: "{}"
            val obj = JSONObject(json)
            obj.remove(tagId.uppercase())
            prefs.edit().putString(KEY_TRACKED_TAGS, obj.toString()).apply()
            notifyService()
        }

        Function("clearTags") {
            getPrefs().edit().putString(KEY_TRACKED_TAGS, "{}").apply()
            notifyService()
        }

        // ─── Background Service ─────────────────────────────────────────
        Function("startService") {
            val ctx = appContext.reactContext ?: return@Function false
            val intent = Intent(ctx, BleTrackingService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(intent)
            } else {
                ctx.startService(intent)
            }
            Log.i(TAG, "Service start requested")
            true
        }

        Function("stopService") {
            val ctx = appContext.reactContext ?: return@Function false
            ctx.stopService(Intent(ctx, BleTrackingService::class.java))
            true
        }

        Function("isRunning") {
            val ctx = appContext.reactContext ?: return@Function false
            isServiceRunning(ctx)
        }

        Function("getTagCount") {
            val json = getPrefs().getString(KEY_TRACKED_TAGS, "{}") ?: "{}"
            try { JSONObject(json).length() } catch (e: Exception) { 0 }
        }

        // ─── Foreground Scan (for pairing screen) ───────────────────────
        Function("startForegroundScan") {
            val ctx = appContext.reactContext ?: return@Function false

            // Pause background service scan to avoid conflicts
            BleTrackingService.pauseScanning = true

            foregroundScanner?.stop()
            foregroundScanner = BleForegroundScanner(ctx)
            foregroundScanner?.start(object : ScanListener {
                override fun onDeviceFound(deviceId: String, name: String?, rssi: Int, manufacturerData: String?) {
                    try {
                        sendEvent("onDeviceFound", mapOf(
                            "id" to deviceId,
                            "name" to (name ?: "Unknown"),
                            "rssi" to rssi,
                            "manufacturerData" to (manufacturerData ?: ""),
                        ))
                    } catch (e: Exception) {
                        Log.w(TAG, "Failed to send onDeviceFound event: ${e.message}")
                    }
                }

                override fun onScanStopped() {
                    try {
                        sendEvent("onScanStateChange", mapOf("scanning" to false))
                    } catch (e: Exception) { /* ignore */ }
                    // Resume background service scan
                    BleTrackingService.pauseScanning = false
                }

                override fun onScanError(message: String) {
                    Log.e(TAG, "Foreground scan error: $message")
                    BleTrackingService.pauseScanning = false
                }
            }, timeoutMs = 60000) // 60 second timeout

            try {
                sendEvent("onScanStateChange", mapOf("scanning" to true))
            } catch (e: Exception) { /* ignore */ }
            Log.i(TAG, "Foreground scan started")
            true
        }

        Function("stopForegroundScan") {
            foregroundScanner?.stop()
            foregroundScanner = null
            BleTrackingService.pauseScanning = false
            Log.i(TAG, "Foreground scan stopped")
            true
        }

        // ─── Ring (LED/Buzzer) ──────────────────────────────────────────
        AsyncFunction("ringTag") { deviceId: String, command: String ->
            val ctx = appContext.reactContext ?: return@AsyncFunction false

            foregroundScanner?.stop()
            BleTrackingService.pauseScanning = true

            var success = false
            try {
                Thread.sleep(1000) // Wait for scans to stop

                val client = MokoGattClient(ctx)
                success = try {
                    runBlocking {
                        client.connectAndAuth(deviceId)
                        when (command) {
                            "led" -> { client.blinkLed(); true }
                            "buzzer" -> { client.buzz(); true }
                            "both" -> { client.blinkLed(); client.buzz(); true }
                            else -> false
                        }
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "Ring failed: ${e.message}")
                    false
                }

                try {
                    sendEvent("onRingResult", mapOf(
                        "success" to success,
                        "deviceId" to deviceId,
                        "message" to if (success) "Ring sent" else "Ring failed",
                    ))
                } catch (e: Exception) { /* ignore */ }

                Log.i(TAG, "Ring $command → $deviceId: ${if (success) "OK" else "FAILED"}")
            } finally {
                BleTrackingService.pauseScanning = false
            }
            success
        }

        // ─── Pair (connect + authenticate) ──────────────────────────────
        AsyncFunction("pairTag") { deviceId: String, tagName: String ->
            val ctx = appContext.reactContext ?: return@AsyncFunction false

            foregroundScanner?.stop()
            BleTrackingService.pauseScanning = true

            var success = false
            try {
                Thread.sleep(1000)

                val client = MokoGattClient(ctx)
                success = try {
                    runBlocking { client.connectAndAuth(deviceId) }
                    true
                } catch (e: Exception) {
                    Log.w(TAG, "Pair failed: ${e.message}")
                    false
                }

                try {
                    sendEvent("onPairResult", mapOf(
                        "success" to success,
                        "deviceId" to deviceId,
                        "message" to if (success) "Paired" else "Failed to pair",
                    ))
                } catch (e: Exception) { /* ignore */ }

                Log.i(TAG, "Pair $deviceId ($tagName): ${if (success) "OK" else "FAILED"}")
            } finally {
                BleTrackingService.pauseScanning = false
            }
            success
        }

        // ─── Service Status ─────────────────────────────────────────────
        Function("getServiceStatus") {
            val running = appContext.reactContext?.let { isServiceRunning(it) } ?: false
            val tagCount = try {
                JSONObject(getPrefs().getString(KEY_TRACKED_TAGS, "{}") ?: "{}").length()
            } catch (e: Exception) { 0 }

            mapOf(
                "isRunning" to running,
                "tagCount" to tagCount,
                "lastScanTime" to BleTrackingService.lastScanTimestamp,
            )
        }
    }

    // ─── Helpers ─────────────────────────────────────────────────────────

    private fun getPrefs() =
        appContext.reactContext!!.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    private fun notifyService() {
        val ctx = appContext.reactContext ?: return
        if (isServiceRunning(ctx)) {
            val intent = Intent(ctx, BleTrackingService::class.java)
            ctx.startService(intent)
        }
    }

    private fun isServiceRunning(ctx: Context): Boolean {
        val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as android.app.ActivityManager
        @Suppress("DEPRECATION")
        return am.getRunningServices(Int.MAX_VALUE).any {
            it.service.className == BleTrackingService::class.java.name
        }
    }

    // Called by BleTrackingService to emit detection events to JS
    fun emitTagDetected(data: Map<String, Any?>) {
        try {
            sendEvent("onTagDetected", data)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to emit onTagDetected: ${e.message}")
        }
    }
}
