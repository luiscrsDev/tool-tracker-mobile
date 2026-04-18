package expo.modules.bletracker

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log

interface ScanListener {
    fun onDeviceFound(deviceId: String, name: String?, rssi: Int, manufacturerData: String?)
    fun onScanStopped()
    fun onScanError(message: String)
}

class BleForegroundScanner(context: Context) {

    companion object {
        private const val TAG = "BleTracker"
        private const val RSSI_CHANGE_THRESHOLD = 5
        private const val DEDUP_INTERVAL_MS = 2000L
    }

    private val bluetoothAdapter: BluetoothAdapter? =
        (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
    private val handler = Handler(Looper.getMainLooper())

    private var scanner: BluetoothLeScanner? = null
    private var listener: ScanListener? = null
    private var scanning = false

    private val seenDevices = mutableMapOf<String, DeviceRecord>()
    private var timeoutRunnable: Runnable? = null

    private data class DeviceRecord(
        val rssi: Int,
        val lastReportedMs: Long
    )

    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            handleResult(result)
        }

        override fun onScanFailed(errorCode: Int) {
            Log.e(TAG, "BLE scan failed with error code: $errorCode")
            scanning = false
            listener?.onScanError("BLE scan failed with error code: $errorCode")
        }
    }

    fun start(listener: ScanListener, timeoutMs: Long = 30000L) {
        if (scanning) {
            Log.w(TAG, "Scan already in progress, ignoring start()")
            return
        }

        val adapter = bluetoothAdapter
        if (adapter == null || !adapter.isEnabled) {
            listener.onScanError("Bluetooth is not available or not enabled")
            return
        }

        val leScanner = adapter.bluetoothLeScanner
        if (leScanner == null) {
            listener.onScanError("BluetoothLeScanner is not available")
            return
        }

        this.scanner = leScanner
        this.listener = listener
        seenDevices.clear()

        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build()

        try {
            leScanner.startScan(null, settings, scanCallback)
            scanning = true
            Log.i(TAG, "Foreground BLE scan started (timeout=${timeoutMs}ms)")

            timeoutRunnable = Runnable {
                Log.i(TAG, "Scan timeout reached (${timeoutMs}ms), stopping")
                stop()
            }
            handler.postDelayed(timeoutRunnable!!, timeoutMs)
        } catch (e: SecurityException) {
            Log.e(TAG, "Missing BLE permissions: ${e.message}")
            listener.onScanError("Missing BLE permissions: ${e.message}")
        }
    }

    fun stop() {
        if (!scanning) return

        timeoutRunnable?.let { handler.removeCallbacks(it) }
        timeoutRunnable = null

        try {
            scanner?.stopScan(scanCallback)
        } catch (e: SecurityException) {
            Log.e(TAG, "SecurityException while stopping scan: ${e.message}")
        }

        scanning = false
        scanner = null
        seenDevices.clear()
        Log.i(TAG, "Foreground BLE scan stopped")

        listener?.onScanStopped()
        listener = null
    }

    fun isScanning(): Boolean = scanning

    private fun handleResult(result: ScanResult) {
        val device = result.device
        val deviceId: String
        try {
            deviceId = device.address
        } catch (e: SecurityException) {
            Log.e(TAG, "SecurityException reading device address: ${e.message}")
            return
        }

        val rssi = result.rssi
        val now = System.currentTimeMillis()

        val previous = seenDevices[deviceId]
        if (previous != null) {
            val rssiDelta = Math.abs(rssi - previous.rssi)
            val elapsed = now - previous.lastReportedMs
            if (rssiDelta < RSSI_CHANGE_THRESHOLD && elapsed < DEDUP_INTERVAL_MS) {
                return
            }
        }

        seenDevices[deviceId] = DeviceRecord(rssi = rssi, lastReportedMs = now)

        val name: String? = try {
            device.name
        } catch (e: SecurityException) {
            null
        }

        val manufacturerData = extractManufacturerData(result)

        listener?.onDeviceFound(deviceId, name, rssi, manufacturerData)
    }

    private fun extractManufacturerData(result: ScanResult): String? {
        val scanRecord = result.scanRecord ?: return null
        val sparseArray = scanRecord.manufacturerSpecificData ?: return null
        if (sparseArray.size() == 0) return null

        val sb = StringBuilder()
        for (i in 0 until sparseArray.size()) {
            if (i > 0) sb.append(",")
            val key = sparseArray.keyAt(i)
            val value = sparseArray.valueAt(i)
            sb.append(String.format("%04X:", key))
            value?.forEach { byte ->
                sb.append(String.format("%02X", byte))
            }
        }
        return sb.toString()
    }
}
