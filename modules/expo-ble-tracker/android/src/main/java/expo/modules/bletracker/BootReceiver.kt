package expo.modules.bletracker

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat
import org.json.JSONObject

/**
 * Restarts BleTrackingService after device reboot, but only if:
 *   1. There is at least one tracked tag.
 *   2. ACCESS_FINE_LOCATION is granted (otherwise starting a FOREGROUND_SERVICE_TYPE_LOCATION
 *      will crash on Android 14+).
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return

        val tagCount = try {
            val raw = PrefsStore.regular(context)
                .getString(PrefsStore.KEY_TRACKED_TAGS, "{}") ?: "{}"
            JSONObject(raw).length()
        } catch (e: Exception) { 0 }

        if (tagCount == 0) {
            Log.i("BleTracker", "Boot: no tags tracked, not starting service")
            return
        }

        val hasLocation = ContextCompat.checkSelfPermission(
            context, Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED

        if (!hasLocation) {
            Log.w("BleTracker", "Boot: ACCESS_FINE_LOCATION denied, deferring service start")
            return
        }

        Log.i("BleTracker", "Boot completed — restarting tracking service ($tagCount tags)")
        val svcIntent = Intent(context, BleTrackingService::class.java)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(svcIntent)
            } else {
                context.startService(svcIntent)
            }
        } catch (e: Exception) {
            Log.e("BleTracker", "Boot service start failed: ${e.message}")
        }
    }
}
