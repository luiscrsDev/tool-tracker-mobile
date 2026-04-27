package expo.modules.bletracker

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.bluetooth.BluetoothManager
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import org.json.JSONObject

/**
 * Foreground service that manages the PendingIntent BLE scan.
 *
 * Does NOT process detections — that's handled by BleScanReceiver (static).
 * This service only:
 * 1. Registers/unregisters the PendingIntent scan with MAC filters
 * 2. Shows the foreground notification
 * 3. Keeps the process alive with WakeLock
 */
class BleTrackingService : Service() {

    companion object {
        private const val TAG = "BleTracker"
        private const val CHANNEL_ID = "ble_tracker_channel"
        private const val NOTIFICATION_ID = 9001
        private const val PREFS_NAME = "ble_tracker_prefs"
        private const val KEY_TRACKED_TAGS = "tracked_tags"

        @Volatile var pauseScanning = false
        @Volatile var lastScanTimestamp = 0L
    }

    private var scanner: BluetoothLeScanner? = null
    private var scanPendingIntent: PendingIntent? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var tagCount = 0

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "Service created")

        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "BleTracker::ScanWakeLock").apply {
            setReferenceCounted(false)
            acquire()
        }

        createNotificationChannel()
        val notification = buildNotification("Rastreando ferramentas...")

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

        startPendingIntentScan()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startPendingIntentScan()
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        stopPendingIntentScan()
        wakeLock?.release()
        Log.i(TAG, "Service destroyed")

        // Self-restart
        try {
            val restartIntent = Intent(this, BleTrackingService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(restartIntent)
            } else {
                startService(restartIntent)
            }
        } catch (e: Exception) { /* ignore */ }
    }

    // ─── PendingIntent BLE Scan ────────────────────────────────────────

    private fun startPendingIntentScan() {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val tagsJson = prefs.getString(KEY_TRACKED_TAGS, "{}") ?: "{}"
        val trackedMacs = mutableListOf<String>()

        try {
            val obj = JSONObject(tagsJson)
            val keys = obj.keys()
            while (keys.hasNext()) {
                trackedMacs.add(keys.next())
            }
        } catch (e: Exception) { /* ignore */ }

        tagCount = trackedMacs.size
        if (tagCount == 0) {
            Log.w(TAG, "No tags to track")
            updateNotification("Sem ferramentas configuradas")
            return
        }

        try {
            val btManager = getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
            scanner = btManager?.adapter?.bluetoothLeScanner
            if (scanner == null) {
                Log.w(TAG, "Bluetooth not available")
                return
            }

            stopPendingIntentScan()

            // PendingIntent → BleScanReceiver (static, survives service death)
            val intent = Intent(this, BleScanReceiver::class.java).apply {
                action = "expo.modules.bletracker.BLE_SCAN_RESULT"
            }
            scanPendingIntent = PendingIntent.getBroadcast(this, 1, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE)

            val filters = trackedMacs.map { mac ->
                ScanFilter.Builder().setDeviceAddress(mac).build()
            }

            val settings = ScanSettings.Builder()
                .setScanMode(ScanSettings.SCAN_MODE_LOW_POWER)
                .setReportDelay(5000)
                .build()

            scanner?.startScan(filters, settings, scanPendingIntent!!)
            Log.i(TAG, "✅ PendingIntent scan started for $tagCount MAC(s)")
            updateNotification("Rastreando $tagCount ferramenta(s)")
        } catch (e: SecurityException) {
            Log.e(TAG, "BLE scan permission denied: ${e.message}")
        } catch (e: Exception) {
            Log.e(TAG, "Scan start failed: ${e.message}")
        }
    }

    private fun stopPendingIntentScan() {
        scanPendingIntent?.let { pi ->
            try { scanner?.stopScan(pi) } catch (e: Exception) { /* ignore */ }
        }
    }

    // ─── Notification ──────────────────────────────────────────────────

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(CHANNEL_ID, "Tool Tracking", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "Rastreamento de ferramentas em segundo plano"
                setShowBadge(false); setSound(null, null)
            }
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(channel)
        }
    }

    private fun buildNotification(text: String): Notification {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
                .setContentTitle("Locate Tool").setContentText(text)
                .setSmallIcon(android.R.drawable.ic_menu_mylocation).setOngoing(true).build()
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
                .setContentTitle("Locate Tool").setContentText(text)
                .setSmallIcon(android.R.drawable.ic_menu_mylocation).setOngoing(true).build()
        }
    }

    private fun updateNotification(text: String) {
        (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
            .notify(NOTIFICATION_ID, buildNotification(text))
    }
}
