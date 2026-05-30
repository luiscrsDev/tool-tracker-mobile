package expo.modules.bletracker

import android.bluetooth.*
import android.content.Context
import android.os.Build
import android.util.Log
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import java.util.UUID
import kotlin.coroutines.resumeWithException

/**
 * MokoSmart M1P GATT client — follows official BeaconX-Pro SDK protocol.
 *
 * Sequence:
 * 1. Connect → discoverServices → find AA00
 * 2. Enable notifications on AA04 (password) and AA01 (params)
 * 3. Request MTU 247
 * 4. Write password to AA04: EA 01 51 08 [ascii] → wait EB 01 51 01 AA on AA04
 * 5. Write command to AA01 → wait EB 01 [cmd] 01 AA on AA01
 *
 * Reliability fixes vs. the original implementation:
 *   - Per-characteristic notify channels so AA01/AA04 notifications can never
 *     resolve the wrong waiter.
 *   - notify channel is created *before* the write, eliminating the
 *     write-completes → notify-arrives → setup-waiter race.
 *   - invokeOnCancellation clears latched continuations so a timeout cannot
 *     leak resume-on-stale-continuation into the next operation.
 *   - disconnect() awaits STATE_DISCONNECTED (≤2s) before close() to prevent
 *     Android's internal GATT cache from refusing the next connect.
 *   - Implements both the deprecated and Android 13+ onCharacteristicChanged.
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
    private var mtuCont: CancellableContinuation<Unit>? = null
    private var disconnectCont: CancellableContinuation<Unit>? = null

    // One channel per characteristic. Capacity 4 so a stray notify cannot block
    // the GATT delivery thread.
    private val notifyChannels = HashMap<UUID, Channel<ByteArray>>()

    private val gattCallback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
            Log.d(TAG, "GATT state=$status new=$newState")
            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    connectCont?.let {
                        connectCont = null
                        it.resumeWith(Result.success(Unit))
                    }
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    // First, fail any in-flight connect attempt
                    connectCont?.let {
                        connectCont = null
                        it.resumeWithException(Exception("Disconnected during connect (status=$status)"))
                    }
                    // Then notify anything waiting on a clean disconnect
                    disconnectCont?.let {
                        disconnectCont = null
                        it.resumeWith(Result.success(Unit))
                    }
                }
            }
        }

        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
            val cont = discoverCont ?: return
            discoverCont = null
            if (status == BluetoothGatt.GATT_SUCCESS) cont.resumeWith(Result.success(Unit))
            else cont.resumeWithException(Exception("Discover failed $status"))
        }

        override fun onMtuChanged(g: BluetoothGatt, mtu: Int, status: Int) {
            Log.d(TAG, "MTU=$mtu")
            mtuCont?.let { mtuCont = null; it.resumeWith(Result.success(Unit)) }
        }

        override fun onDescriptorWrite(g: BluetoothGatt, d: BluetoothGattDescriptor, status: Int) {
            writeCont?.let { writeCont = null; it.resumeWith(Result.success(Unit)) }
        }

        override fun onCharacteristicWrite(g: BluetoothGatt, c: BluetoothGattCharacteristic, status: Int) {
            writeCont?.let { writeCont = null; it.resumeWith(Result.success(Unit)) }
        }

        // Android 13+ delivers value here; on older versions the deprecated
        // overload is invoked (which we still implement below for safety).
        override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic, value: ByteArray) {
            deliverNotify(c.uuid, value)
        }

        @Suppress("DEPRECATION")
        override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic) {
            // Only invoked on API < 33. On API 33+ the value-bearing overload above is used.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) return
            val v = c.value ?: return
            deliverNotify(c.uuid, v)
        }
    }

    private fun deliverNotify(uuid: UUID, value: ByteArray) {
        Log.d(TAG, "RX [${uuid.toString().substring(4, 8)}]: ${value.joinToString(" ") { "%02X".format(it) }}")
        val ch = notifyChannels[uuid] ?: return
        val ok = ch.trySend(value).isSuccess
        if (!ok) Log.w(TAG, "Notify channel full for $uuid")
    }

    /** Connect, authenticate, and ring LED + buzzer. */
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
            Log.i(TAG, "Ring OK ($command)")
        } finally { disconnect() }
    }

    /** Connect and authenticate only. */
    suspend fun connectAndAuth(mac: String) {
        try {
            connect(mac)
            discoverServices()
            findChars()
            enableNotify(passwordChar!!)
            enableNotify(paramsChar!!)
            requestMtu(247)
            auth()
            Log.i(TAG, "Auth OK")
        } finally { disconnect() }
    }

    // ─── Internal ──────────────────────────────────────────────────────

    private suspend fun connect(mac: String) = withTimeout(10_000) {
        suspendCancellableCoroutine { c ->
            connectCont = c
            c.invokeOnCancellation { if (connectCont === c) connectCont = null }
            try {
                val dev = (context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager)
                    .adapter.getRemoteDevice(mac)
                gatt = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
                    dev.connectGatt(context, false, gattCallback, BluetoothDevice.TRANSPORT_LE)
                else dev.connectGatt(context, false, gattCallback)
                Log.d(TAG, "Connecting $mac...")
            } catch (e: SecurityException) { c.resumeWithException(e) }
        }
    }

    private suspend fun discoverServices() = withTimeout(10_000) {
        suspendCancellableCoroutine { c ->
            discoverCont = c
            c.invokeOnCancellation { if (discoverCont === c) discoverCont = null }
            try { gatt?.discoverServices() } catch (e: SecurityException) { c.resumeWithException(e) }
        }
    }

    private fun findChars() {
        val g = gatt ?: throw Exception("GATT null")
        // Force a service cache refresh so post-firmware-update devices that
        // changed their service UUIDs are re-discovered correctly.
        tryRefreshGattCache(g)
        val svcs = try { g.services } catch (e: SecurityException) { throw e }
        Log.d(TAG, "Services: ${svcs.map { it.uuid.toString().substring(4, 8) }}")
        val svc = g.getService(SVC_CUSTOM) ?: throw Exception(
            "AA00 not found! Have: ${svcs.map { it.uuid.toString().substring(4, 8) }}"
        )
        paramsChar = svc.getCharacteristic(CHAR_PARAMS) ?: throw Exception("AA01 not found")
        passwordChar = svc.getCharacteristic(CHAR_PASSWORD) ?: throw Exception("AA04 not found")
        Log.d(TAG, "AA00/AA01/AA04 found")
    }

    private fun tryRefreshGattCache(g: BluetoothGatt) {
        try {
            val method = g.javaClass.getMethod("refresh")
            val result = method.invoke(g) as? Boolean ?: false
            if (result) Log.d(TAG, "GATT cache refreshed")
        } catch (e: Exception) {
            // Reflection may fail on stricter API levels — non-fatal.
        }
    }

    private suspend fun enableNotify(ch: BluetoothGattCharacteristic) = withTimeout(5_000) {
        // Pre-allocate (or replace) the notify channel for this characteristic
        // so notifications cannot be lost between subscribe and first wait.
        notifyChannels[ch.uuid]?.close()
        notifyChannels[ch.uuid] = Channel(capacity = 4)

        suspendCancellableCoroutine<Unit> { c ->
            writeCont = c
            c.invokeOnCancellation { if (writeCont === c) writeCont = null }
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
                } else {
                    writeCont = null
                    c.resumeWith(Result.success(Unit))
                }
            } catch (e: SecurityException) { c.resumeWithException(e) }
        }
        delay(100)
    }

    private suspend fun requestMtu(mtu: Int) = withTimeout(5_000) {
        suspendCancellableCoroutine { c ->
            mtuCont = c
            c.invokeOnCancellation { if (mtuCont === c) mtuCont = null }
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

    private suspend fun writeAndWait(ch: BluetoothGattCharacteristic, data: ByteArray, label: String) =
        withTimeout(10_000) {
            // Drain any stale notifications that arrived between operations so
            // we only consider notifies that correspond to the upcoming write.
            val channel = notifyChannels[ch.uuid]
                ?: throw IllegalStateException("Notifications not enabled for ${ch.uuid}")
            while (channel.tryReceive().isSuccess) { /* drop */ }

            // Write
            suspendCancellableCoroutine<Unit> { c ->
                writeCont = c
                c.invokeOnCancellation { if (writeCont === c) writeCont = null }
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        gatt?.writeCharacteristic(ch, data, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT)
                    } else {
                        legacyWriteCharacteristic(ch, data)
                    }
                } catch (e: SecurityException) { c.resumeWithException(e) }
            }

            // Wait notify on the SAME characteristic
            val rx = channel.receive()
            if (rx.size >= 5 && rx[0] == HEADER_RX && rx[4] == RESULT_SUCCESS) {
                Log.d(TAG, "$label OK")
            } else {
                throw Exception("$label rejected: ${rx.joinToString(" ") { "%02X".format(it) }}")
            }
        }

    @Suppress("DEPRECATION")
    private fun legacyWriteCharacteristic(ch: BluetoothGattCharacteristic, data: ByteArray) {
        ch.value = data
        ch.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
        gatt?.writeCharacteristic(ch)
    }

    private suspend fun disconnect() {
        val g = gatt ?: return
        // Try to await the disconnect event so Android's internal cache state
        // is consistent before we close the GATT.
        try {
            withTimeout(2_000) {
                suspendCancellableCoroutine<Unit> { c ->
                    disconnectCont = c
                    c.invokeOnCancellation { if (disconnectCont === c) disconnectCont = null }
                    try { g.disconnect() } catch (_: SecurityException) {
                        disconnectCont = null
                        c.resumeWith(Result.success(Unit))
                    }
                }
            }
        } catch (_: TimeoutCancellationException) {
            Log.w(TAG, "disconnect await timed out — closing anyway")
        } catch (_: Exception) { /* ignore */ }
        try { g.close() } catch (_: SecurityException) {}
        gatt = null
        paramsChar = null
        passwordChar = null
        notifyChannels.values.forEach { it.close() }
        notifyChannels.clear()
    }
}
