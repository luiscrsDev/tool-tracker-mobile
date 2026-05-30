package expo.modules.bletracker

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.json.JSONObject

class ExpoBleTrackerModule : Module() {

    companion object {
        private const val TAG = "BleTracker"

        // Static reference for event emission from service
        @Volatile var instance: ExpoBleTrackerModule? = null
    }

    private var foregroundScanner: BleForegroundScanner? = null
    private val notifyHandler = Handler(Looper.getMainLooper())
    private var notifyRunnable: Runnable? = null

    override fun definition() = ModuleDefinition {
        Name("ExpoBleTracker")

        // ─── Events ─────────────────────────────────────────────────────
        Events(
            "onDeviceFound",      // Foreground scan result: {id, name, rssi, manufacturerData}
            "onTagDetected",      // Background detection: {tagId, toolId, toolName, rssi, timestamp}
            "onScanStateChange",  // Scan started/stopped: {scanning: boolean}
            "onPairResult",       // Pair attempt result: {success, deviceId, message}
            "onRingResult",       // Ring attempt result: {success, deviceId, message}
        )

        OnCreate {
            instance = this@ExpoBleTrackerModule
        }

        OnDestroy {
            try { foregroundScanner?.stop() } catch (_: Exception) {}
            foregroundScanner = null
            notifyRunnable?.let { notifyHandler.removeCallbacks(it) }
            notifyRunnable = null
            instance = null
        }

        // ─── Supabase Config ────────────────────────────────────────────
        Function("configure") { url: String, key: String ->
            val ctx = appContext.reactContext ?: return@Function
            PrefsStore.secure(ctx).edit()
                .putString(PrefsStore.KEY_SUPABASE_URL, url)
                .putString(PrefsStore.KEY_SUPABASE_KEY, key)
                .apply()
            BleTrackingService.instance?.loadConfig()
        }

        // ─── Tag Management ─────────────────────────────────────────────
        Function("addTag") { tagId: String, toolId: String, toolName: String, contractorId: String ->
            val ctx = appContext.reactContext ?: return@Function
            val prefs = PrefsStore.regular(ctx)
            val json = prefs.getString(PrefsStore.KEY_TRACKED_TAGS, "{}") ?: "{}"
            val obj = JSONObject(json)
            obj.put(tagId.uppercase(), JSONObject().apply {
                put("toolId", toolId)
                put("toolName", toolName)
                put("contractorId", contractorId)
            })
            prefs.edit().putString(PrefsStore.KEY_TRACKED_TAGS, obj.toString()).apply()
            notifyService()
            Log.i(TAG, "Tag added: $tagId -> $toolName")
        }

        Function("removeTag") { tagId: String ->
            val ctx = appContext.reactContext ?: return@Function
            val prefs = PrefsStore.regular(ctx)
            val json = prefs.getString(PrefsStore.KEY_TRACKED_TAGS, "{}") ?: "{}"
            val obj = JSONObject(json)
            obj.remove(tagId.uppercase())
            prefs.edit().putString(PrefsStore.KEY_TRACKED_TAGS, obj.toString()).apply()
            notifyService()
        }

        Function("clearTags") {
            val ctx = appContext.reactContext
            if (ctx != null) {
                PrefsStore.regular(ctx).edit().putString(PrefsStore.KEY_TRACKED_TAGS, "{}").apply()
                notifyService()
            }
        }

        // ─── Background Service ─────────────────────────────────────────
        Function("startService") {
            val ctx = appContext.reactContext ?: return@Function false
            notifyRunnable?.let { notifyHandler.removeCallbacks(it) }
            notifyRunnable = null
            val intent = Intent(ctx, BleTrackingService::class.java)
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    ctx.startForegroundService(intent)
                } else {
                    ctx.startService(intent)
                }
                Log.i(TAG, "Service start requested")
                true
            } catch (e: Exception) {
                Log.e(TAG, "startService failed: ${e.message}")
                false
            }
        }

        Function("stopService") {
            val ctx = appContext.reactContext ?: return@Function false
            ctx.stopService(Intent(ctx, BleTrackingService::class.java))
            true
        }

        Function("isRunning") {
            BleTrackingService.instance != null
        }

        Function("getTagCount") {
            val ctx = appContext.reactContext ?: return@Function 0
            val json = PrefsStore.regular(ctx).getString(PrefsStore.KEY_TRACKED_TAGS, "{}") ?: "{}"
            try { JSONObject(json).length() } catch (e: Exception) { 0 }
        }

        // ─── Foreground Scan (for pairing screen) ───────────────────────
        Function("startForegroundScan") {
            val ctx = appContext.reactContext ?: return@Function false

            // Stop background BLE scan entirely — Samsung does not support
            // two concurrent scans.
            BleTrackingService.acquirePause()
            BleTrackingService.instance?.stopScan()

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
                    try { sendEvent("onScanStateChange", mapOf("scanning" to false)) } catch (_: Exception) {}
                    if (BleTrackingService.releasePause() == 0) {
                        BleTrackingService.instance?.startScan()
                    }
                }

                override fun onScanError(message: String) {
                    Log.e(TAG, "Foreground scan error: $message")
                    if (BleTrackingService.releasePause() == 0) {
                        BleTrackingService.instance?.startScan()
                    }
                }
            }, timeoutMs = 600_000) // 10 minute timeout

            try { sendEvent("onScanStateChange", mapOf("scanning" to true)) } catch (_: Exception) {}
            Log.i(TAG, "Foreground scan started")
            true
        }

        Function("stopForegroundScan") {
            foregroundScanner?.stop()
            foregroundScanner = null
            Log.i(TAG, "Foreground scan stopped")
            true
        }

        // ─── Ring (LED/Buzzer) ──────────────────────────────────────────
        AsyncFunction("ringTag") { deviceId: String, command: String ->
            val ctx = appContext.reactContext ?: return@AsyncFunction false

            // Don't stop foreground scanner — Android supports simultaneous scan + GATT
            BleTrackingService.acquirePause()

            var success = false
            try {
                val client = MokoGattClient(ctx)
                success = try {
                    runBlocking {
                        withContext(Dispatchers.IO) { client.connectAndRing(deviceId, command) }
                    }
                    true
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
                } catch (_: Exception) {}

                Log.i(TAG, "Ring $command -> $deviceId: ${if (success) "OK" else "FAILED"}")
            } finally {
                if (BleTrackingService.releasePause() == 0) {
                    BleTrackingService.instance?.startScan()
                }
            }
            success
        }

        // ─── Pair (connect + authenticate) ──────────────────────────────
        AsyncFunction("pairTag") { deviceId: String, tagName: String ->
            val ctx = appContext.reactContext ?: return@AsyncFunction false

            foregroundScanner?.stop()
            BleTrackingService.acquirePause()

            var success = false
            try {
                val client = MokoGattClient(ctx)
                success = try {
                    runBlocking {
                        withContext(Dispatchers.IO) { client.connectAndAuth(deviceId) }
                    }
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
                } catch (_: Exception) {}

                Log.i(TAG, "Pair $deviceId ($tagName): ${if (success) "OK" else "FAILED"}")
            } finally {
                if (BleTrackingService.releasePause() == 0) {
                    BleTrackingService.instance?.startScan()
                }
            }
            success
        }

        // ─── Service Status ─────────────────────────────────────────────
        Function("getServiceStatus") {
            val ctx = appContext.reactContext
            val running = BleTrackingService.instance != null
            val tagCount = if (ctx != null) {
                try {
                    JSONObject(
                        PrefsStore.regular(ctx).getString(PrefsStore.KEY_TRACKED_TAGS, "{}") ?: "{}"
                    ).length()
                } catch (e: Exception) { 0 }
            } else 0

            mapOf(
                "isRunning" to running,
                "tagCount" to tagCount,
                "lastScanTime" to BleTrackingService.lastScanTimestamp,
            )
        }
    }

    // ─── Helpers ─────────────────────────────────────────────────────────

    private fun notifyService() {
        val serviceInstance = BleTrackingService.instance ?: return  // service will load config on start
        serviceInstance.loadConfig()
        if (BleTrackingService.pauseScanning) return
        notifyRunnable?.let { notifyHandler.removeCallbacks(it) }
        notifyRunnable = Runnable {
            if (!BleTrackingService.pauseScanning) {
                serviceInstance.restartScan()
            }
        }
        notifyHandler.postDelayed(notifyRunnable!!, 2000L)
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
