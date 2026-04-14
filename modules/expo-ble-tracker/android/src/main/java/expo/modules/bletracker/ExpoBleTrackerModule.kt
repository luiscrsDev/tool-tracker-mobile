package expo.modules.bletracker

import android.content.Context
import android.content.Intent
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject

class ExpoBleTrackerModule : Module() {

    companion object {
        private const val PREFS_NAME = "ble_tracker_prefs"
        private const val KEY_TRACKED_TAGS = "tracked_tags"
        private const val KEY_SUPABASE_URL = "supabase_url"
        private const val KEY_SUPABASE_KEY = "supabase_key"
    }

    override fun definition() = ModuleDefinition {
        Name("ExpoBleTracker")

        // Configure Supabase credentials
        Function("configure") { url: String, key: String ->
            getPrefs().edit()
                .putString(KEY_SUPABASE_URL, url)
                .putString(KEY_SUPABASE_KEY, key)
                .apply()
        }

        // Register a BLE tag to track
        // tagId = BLE MAC or manufacturer data identifier
        Function("addTag") { tagId: String, toolId: String, toolName: String, contractorId: String ->
            val prefs = getPrefs()
            val json = prefs.getString(KEY_TRACKED_TAGS, "{}") ?: "{}"
            val obj = JSONObject(json)
            obj.put(tagId, JSONObject().apply {
                put("toolId", toolId)
                put("toolName", toolName)
                put("contractorId", contractorId)
            })
            prefs.edit().putString(KEY_TRACKED_TAGS, obj.toString()).apply()

            // Notify running service to reload config
            notifyService()
        }

        // Remove a tracked tag
        Function("removeTag") { tagId: String ->
            val prefs = getPrefs()
            val json = prefs.getString(KEY_TRACKED_TAGS, "{}") ?: "{}"
            val obj = JSONObject(json)
            obj.remove(tagId)
            prefs.edit().putString(KEY_TRACKED_TAGS, obj.toString()).apply()
            notifyService()
        }

        // Clear all tracked tags
        Function("clearTags") {
            getPrefs().edit().putString(KEY_TRACKED_TAGS, "{}").apply()
            notifyService()
        }

        // Start the background tracking service
        Function("startService") {
            val ctx = appContext.reactContext ?: return@Function false
            val intent = Intent(ctx, BleTrackingService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(intent)
            } else {
                ctx.startService(intent)
            }
            true
        }

        // Stop the background tracking service
        Function("stopService") {
            val ctx = appContext.reactContext ?: return@Function false
            ctx.stopService(Intent(ctx, BleTrackingService::class.java))
            true
        }

        // Check if service is running
        Function("isRunning") {
            val ctx = appContext.reactContext ?: return@Function false
            isServiceRunning(ctx)
        }

        // Get number of tracked tags
        Function("getTagCount") {
            val json = getPrefs().getString(KEY_TRACKED_TAGS, "{}") ?: "{}"
            try { JSONObject(json).length() } catch (e: Exception) { 0 }
        }
    }

    private fun getPrefs() =
        appContext.reactContext!!.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    private fun notifyService() {
        val ctx = appContext.reactContext ?: return
        if (isServiceRunning(ctx)) {
            val intent = Intent(ctx, BleTrackingService::class.java)
            ctx.startService(intent) // onStartCommand reloads config
        }
    }

    private fun isServiceRunning(ctx: Context): Boolean {
        val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as android.app.ActivityManager
        @Suppress("DEPRECATION")
        return am.getRunningServices(Int.MAX_VALUE).any {
            it.service.className == BleTrackingService::class.java.name
        }
    }
}
