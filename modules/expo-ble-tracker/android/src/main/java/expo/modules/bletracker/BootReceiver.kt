package expo.modules.bletracker

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log

/**
 * Restarts BleTrackingService after device reboot.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
            Log.i("BleTracker", "Boot completed — restarting tracking service")
            val prefs = context.getSharedPreferences("ble_tracker_prefs", Context.MODE_PRIVATE)
            val tagsJson = prefs.getString("tracked_tags", "{}") ?: "{}"
            // Only start if there are tracked tags
            if (tagsJson != "{}" && tagsJson.isNotEmpty()) {
                val svcIntent = Intent(context, BleTrackingService::class.java)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(svcIntent)
                } else {
                    context.startService(svcIntent)
                }
            }
        }
    }
}
