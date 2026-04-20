package expo.modules.bletracker

import android.bluetooth.*
import android.content.Context
import android.os.Build
import android.util.Log
import kotlinx.coroutines.*
import java.util.UUID
import kotlin.coroutines.resumeWithException

/**
 * MokoSmart M1P GATT client — follows official BeaconX-Pro SDK protocol.
 *
 * Sequence:
 * 1. Connect → discoverServices → find AA00
 * 2. Enable notifications on AA04 (password) and AA01 (params)
 * 3. Request MTU 247
 * 4. Write password to AA04: EA 01 51 08 [ascii] → wait EB 01 51 01 AA
 * 5. Write command to AA01 → wait EB 01 [cmd] 01 AA
 */
class MokoGattClient(private val context: Context) {

    companion object {
        private const val TAG = "BleTracker"
        private val SVC_CUSTOM = UUID.fromString("0000AA00-0000-1000-8000-00805F9B34FB")
        private val CHAR_PARAMS = UUID.fromString("0000AA01-0000-1000-8000-00805F9B34FB")
        private val CHAR_PASSWORD = UUID.fromString("0000AA04-0000-1000-8000-00805F9B34FB")
        private val CCCD = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
        private const val DEFAULT_PASSWORD = "Moko4321"
        private const val HEADER_TX: Byte = 0xEA.toByte()
        private const val HEADER_RX: Byte = 0xEB.toByte()
        private const val CMD_WRITE: Byte = 0x01
        private const val CMD_PASSWORD: Byte = 0x51
        private const val CMD_LED: Byte = 0x61
        private const val CMD_BUZZER: Byte = 0x62
        private const val RESULT_SUCCESS: Byte = 0xAA.toByte()
    }

    private var gatt: BluetoothGatt? = null
    private var paramsChar: BluetoothGattCharacteristic? = null
    private var passwordChar: BluetoothGattCharacteristic? = null
    private var connectCont: CancellableContinuation<Unit>? = null
    private var discoverCont: CancellableContinuation<Unit>? = null
    private var writeCont: CancellableContinuation<Unit>? = null
    private var notifyCont: CancellableContinuation<ByteArray>? = null
    private var mtuCont: CancellableContinuation<Unit>? = null

    private val gattCallback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
            Log.d(TAG, "GATT state=$status new=$newState")
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                connectCont?.resumeWith(Result.success(Unit)); connectCont = null
            } else {
                connectCont?.resumeWithException(Exception("Connect failed status=$status")); connectCont = null
            }
        }
        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
            if (status == BluetoothGatt.GATT_SUCCESS) discoverCont?.resumeWith(Result.success(Unit))
            else discoverCont?.resumeWithException(Exception("Discover failed $status"))
            discoverCont = null
        }
        override fun onMtuChanged(g: BluetoothGatt, mtu: Int, status: Int) {
            Log.d(TAG, "MTU=$mtu"); mtuCont?.resumeWith(Result.success(Unit)); mtuCont = null
        }
        override fun onDescriptorWrite(g: BluetoothGatt, d: BluetoothGattDescriptor, status: Int) {
            writeCont?.resumeWith(Result.success(Unit)); writeCont = null
        }
        override fun onCharacteristicWrite(g: BluetoothGatt, c: BluetoothGattCharacteristic, status: Int) {
            writeCont?.resumeWith(Result.success(Unit)); writeCont = null
        }
        @Suppress("DEPRECATION")
        override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic) {
            val v = c.value ?: return
            Log.d(TAG, "RX [${c.uuid.toString().substring(4,8)}]: ${v.joinToString(" ") { "%02X".format(it) }}")
            notifyCont?.resumeWith(Result.success(v)); notifyCont = null
        }
    }

    /** Connect, authenticate, and ring LED + buzzer */
    suspend fun connectAndRing(mac: String, command: String = "both") {
        try {
            connect(mac)
            discoverServices()
            findChars()
            enableNotify(passwordChar!!)
            enableNotify(paramsChar!!)
            requestMtu(247)
            auth()
            when (command) {
                "led" -> ledBlink()
                "buzzer" -> buzzerRing()
                "both" -> { ledBlink(); delay(500); buzzerRing() }
            }
            Log.i(TAG, "✅ Ring OK ($command)")
        } finally { disconnect() }
    }

    /** Connect and authenticate only */
    suspend fun connectAndAuth(mac: String) {
        try {
            connect(mac)
            discoverServices()
            findChars()
            enableNotify(passwordChar!!)
            enableNotify(paramsChar!!)
            requestMtu(247)
            auth()
            Log.i(TAG, "✅ Auth OK")
        } finally { disconnect() }
    }

    /** Blink LED (must be connected+authed) */
    suspend fun blinkLed() = ledBlink()

    /** Ring buzzer (must be connected+authed) */
    suspend fun buzz() = buzzerRing()

    // ─── Internal ──────────────────────────────────────────────────────

    private suspend fun connect(mac: String) = withTimeout(10000) {
        suspendCancellableCoroutine { c ->
            connectCont = c
            try {
                val dev = (context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter.getRemoteDevice(mac)
                gatt = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
                    dev.connectGatt(context, false, gattCallback, BluetoothDevice.TRANSPORT_LE)
                else dev.connectGatt(context, false, gattCallback)
                Log.d(TAG, "Connecting $mac...")
            } catch (e: SecurityException) { c.resumeWithException(e) }
        }
    }

    private suspend fun discoverServices() = withTimeout(10000) {
        suspendCancellableCoroutine { c ->
            discoverCont = c
            try { gatt?.discoverServices() } catch (e: SecurityException) { c.resumeWithException(e) }
        }
    }

    private fun findChars() {
        val g = gatt ?: throw Exception("GATT null")
        val svcs = try { g.services } catch (e: SecurityException) { throw e }
        Log.d(TAG, "Services: ${svcs.map { it.uuid.toString().substring(4,8) }}")
        val svc = g.getService(SVC_CUSTOM) ?: throw Exception("AA00 not found! Have: ${svcs.map { it.uuid.toString().substring(4,8) }}")
        paramsChar = svc.getCharacteristic(CHAR_PARAMS) ?: throw Exception("AA01 not found")
        passwordChar = svc.getCharacteristic(CHAR_PASSWORD) ?: throw Exception("AA04 not found")
        Log.d(TAG, "✅ AA00/AA01/AA04 found")
    }

    private suspend fun enableNotify(ch: BluetoothGattCharacteristic) = withTimeout(5000) {
        suspendCancellableCoroutine { c ->
            writeCont = c
            try {
                gatt?.setCharacteristicNotification(ch, true)
                val desc = ch.getDescriptor(CCCD)
                if (desc != null) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        gatt?.writeDescriptor(desc, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
                    } else {
                        @Suppress("DEPRECATION")
                        desc.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                        @Suppress("DEPRECATION")
                        gatt?.writeDescriptor(desc)
                    }
                } else { c.resumeWith(Result.success(Unit)) }
            } catch (e: SecurityException) { c.resumeWithException(e) }
        }
        delay(100)
    }

    private suspend fun requestMtu(mtu: Int) = withTimeout(5000) {
        suspendCancellableCoroutine { c ->
            mtuCont = c
            try { gatt?.requestMtu(mtu) } catch (e: SecurityException) { c.resumeWithException(e) }
        }
    }

    private suspend fun auth(pw: String = DEFAULT_PASSWORD) {
        val pwBytes = pw.toByteArray(Charsets.US_ASCII)
        val payload = byteArrayOf(HEADER_TX, CMD_WRITE, CMD_PASSWORD, pwBytes.size.toByte(), *pwBytes)
        Log.d(TAG, "TX auth: ${payload.joinToString(" ") { "%02X".format(it) }}")
        writeAndWait(passwordChar!!, payload, "auth")
    }

    private suspend fun ledBlink(interval: Int = 500, time: Int = 30) {
        val payload = byteArrayOf(
            HEADER_TX, CMD_WRITE, CMD_LED, 0x05, 0x03,
            (interval shr 8).toByte(), (interval and 0xFF).toByte(),
            (time shr 8).toByte(), (time and 0xFF).toByte(),
        )
        Log.d(TAG, "TX LED: ${payload.joinToString(" ") { "%02X".format(it) }}")
        writeAndWait(paramsChar!!, payload, "LED")
    }

    private suspend fun buzzerRing(interval: Int = 500, time: Int = 30) {
        val payload = byteArrayOf(
            HEADER_TX, CMD_WRITE, CMD_BUZZER, 0x05, 0x0E,
            (interval shr 8).toByte(), (interval and 0xFF).toByte(),
            (time shr 8).toByte(), (time and 0xFF).toByte(),
        )
        Log.d(TAG, "TX buzzer: ${payload.joinToString(" ") { "%02X".format(it) }}")
        writeAndWait(paramsChar!!, payload, "buzzer")
    }

    private suspend fun writeAndWait(ch: BluetoothGattCharacteristic, data: ByteArray, label: String) = withTimeout(10000) {
        // Write
        suspendCancellableCoroutine<Unit> { c ->
            writeCont = c
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    gatt?.writeCharacteristic(ch, data, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT)
                } else {
                    @Suppress("DEPRECATION") ch.value = data
                    @Suppress("DEPRECATION") ch.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
                    @Suppress("DEPRECATION") gatt?.writeCharacteristic(ch)
                }
            } catch (e: SecurityException) { c.resumeWithException(e) }
        }
        // Wait notify
        val rx = suspendCancellableCoroutine<ByteArray> { c -> notifyCont = c }
        if (rx.size >= 5 && rx[0] == HEADER_RX && rx[4] == RESULT_SUCCESS) {
            Log.d(TAG, "✅ $label OK")
        } else {
            throw Exception("$label rejected: ${rx.joinToString(" ") { "%02X".format(it) }}")
        }
    }

    private fun disconnect() {
        try { gatt?.disconnect(); gatt?.close() } catch (_: SecurityException) {}
        gatt = null; paramsChar = null; passwordChar = null
    }
}
