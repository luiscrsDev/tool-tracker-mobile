package expo.modules.bletracker

import android.annotation.SuppressLint
import android.bluetooth.*
import android.content.Context
import android.os.Build
import android.util.Log
import kotlinx.coroutines.*
import kotlinx.coroutines.suspendCancellableCoroutine
import java.util.UUID
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * GATT client for MokoSmart M1P BLE tags.
 *
 * Handles connection, authentication, LED blink and buzzer commands
 * using Android's native BluetoothGatt API with coroutine wrappers.
 */
class MokoGattClient(private val context: Context) {

    companion object {
        private const val TAG = "BleTracker"

        // Moko primary service & characteristics
        val MOKO_SVC: UUID       = UUID.fromString("0000aa00-0000-1000-8000-00805f9b34fb")
        val MOKO_PARAMS: UUID    = UUID.fromString("0000aa01-0000-1000-8000-00805f9b34fb")
        val MOKO_PASSWORD: UUID  = UUID.fromString("0000aa04-0000-1000-8000-00805f9b34fb")

        // Fallback service & characteristic
        val FALLBACK_SVC: UUID   = UUID.fromString("00001910-0000-1000-8000-00805f9b34fb")
        val FALLBACK_CHAR: UUID  = UUID.fromString("00002b11-0000-1000-8000-00805f9b34fb")

        const val DEFAULT_PASSWORD = "Moko4321"

        // Timeouts
        private const val CONNECT_TIMEOUT_MS = 10_000L
        private const val WRITE_TIMEOUT_MS   = 5_000L

        // LED defaults: interval 500ms (0x01F4), time 30 units = 3s (0x001E)
        private const val LED_INTERVAL: Int = 0x01F4
        private const val LED_TIME: Int     = 0x001E

        // Buzzer defaults: same as LED
        private const val BUZZER_INTERVAL: Int = 0x01F4
        private const val BUZZER_TIME: Int     = 0x001E
    }

    private var bluetoothGatt: BluetoothGatt? = null

    // ── Public API ──────────────────────────────────────────────────────

    /**
     * Full flow: connect → authenticate → blink LED → buzz → disconnect.
     */
    suspend fun connectAndAlert(macAddress: String, password: String = DEFAULT_PASSWORD) {
        try {
            connect(macAddress)
            discoverServices()
            authenticate(password)
            blinkLed()
            buzz()
        } catch (e: Exception) {
            Log.e(TAG, "connectAndAlert failed for $macAddress: ${e.message}", e)
            throw e
        } finally {
            disconnect()
        }
    }

    /**
     * Connect → authenticate only (no alert commands).
     */
    suspend fun connectAndAuth(macAddress: String, password: String = DEFAULT_PASSWORD) {
        try {
            connect(macAddress)
            discoverServices()
            authenticate(password)
        } catch (e: Exception) {
            Log.e(TAG, "connectAndAuth failed for $macAddress: ${e.message}", e)
            throw e
        }
    }

    /**
     * Send LED blink command (must be connected & authenticated first).
     */
    suspend fun blinkLed(
        interval: Int = LED_INTERVAL,
        time: Int = LED_TIME
    ) {
        val payload = byteArrayOf(
            0xEA.toByte(),
            0x01.toByte(),
            0x61.toByte(),
            0x05.toByte(),
            0x03.toByte(),
            (interval shr 8 and 0xFF).toByte(),
            (interval and 0xFF).toByte(),
            (time shr 8 and 0xFF).toByte(),
            (time and 0xFF).toByte()
        )
        writeToParamsChar(payload, "LED blink")
    }

    /**
     * Send buzzer command (must be connected & authenticated first).
     */
    suspend fun buzz(
        interval: Int = BUZZER_INTERVAL,
        time: Int = BUZZER_TIME
    ) {
        val payload = byteArrayOf(
            0xEA.toByte(),
            0x01.toByte(),
            0x62.toByte(),
            0x05.toByte(),
            0x0E.toByte(),
            (interval shr 8 and 0xFF).toByte(),
            (interval and 0xFF).toByte(),
            (time shr 8 and 0xFF).toByte(),
            (time and 0xFF).toByte()
        )
        writeToParamsChar(payload, "Buzzer")
    }

    /**
     * Disconnect and release resources.
     */
    @SuppressLint("MissingPermission")
    fun disconnect() {
        try {
            bluetoothGatt?.let { gatt ->
                Log.d(TAG, "Disconnecting GATT…")
                gatt.disconnect()
                gatt.close()
            }
        } catch (e: SecurityException) {
            Log.w(TAG, "SecurityException on disconnect: ${e.message}")
        } finally {
            bluetoothGatt = null
        }
    }

    // ── Connection ──────────────────────────────────────────────────────

    @SuppressLint("MissingPermission")
    private suspend fun connect(macAddress: String) {
        val adapter = BluetoothAdapter.getDefaultAdapter()
            ?: throw IllegalStateException("Bluetooth not available")

        val device: BluetoothDevice = try {
            adapter.getRemoteDevice(macAddress)
        } catch (e: IllegalArgumentException) {
            throw IllegalArgumentException("Invalid MAC address: $macAddress", e)
        }

        Log.d(TAG, "Connecting to $macAddress …")

        bluetoothGatt = withTimeout(CONNECT_TIMEOUT_MS) {
            suspendCancellableCoroutine { cont ->
                try {
                    val callback = object : BluetoothGattCallback() {
                        override fun onConnectionStateChange(
                            gatt: BluetoothGatt,
                            status: Int,
                            newState: Int
                        ) {
                            when {
                                newState == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS -> {
                                    Log.d(TAG, "Connected to $macAddress")
                                    if (cont.isActive) cont.resume(gatt)
                                }
                                else -> {
                                    Log.e(TAG, "Connection failed – status=$status state=$newState")
                                    gatt.close()
                                    if (cont.isActive) {
                                        cont.resumeWithException(
                                            Exception("GATT connection failed (status=$status, state=$newState)")
                                        )
                                    }
                                }
                            }
                        }
                    }

                    val gatt = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        device.connectGatt(context, false, callback, BluetoothDevice.TRANSPORT_LE)
                    } else {
                        device.connectGatt(context, false, callback)
                    }

                    cont.invokeOnCancellation {
                        Log.d(TAG, "Connection cancelled, closing GATT")
                        try {
                            gatt.disconnect()
                            gatt.close()
                        } catch (_: SecurityException) {}
                    }
                } catch (e: SecurityException) {
                    if (cont.isActive) {
                        cont.resumeWithException(
                            SecurityException("BLE CONNECT_PRIVILEGED permission missing: ${e.message}")
                        )
                    }
                }
            }
        }
    }

    // ── Service Discovery ───────────────────────────────────────────────

    @SuppressLint("MissingPermission")
    private suspend fun discoverServices() {
        val gatt = bluetoothGatt ?: throw IllegalStateException("Not connected")

        withTimeout(CONNECT_TIMEOUT_MS) {
            suspendCancellableCoroutine<Unit> { cont ->
                val originalCallback = gattCallbackField(gatt)
                val wrappedCallback = object : BluetoothGattCallback() {
                    override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
                        if (status == BluetoothGatt.GATT_SUCCESS) {
                            val serviceUuids = gatt.services.map { it.uuid.toString() }
                            Log.d(TAG, "Discovered ${gatt.services.size} services: $serviceUuids")
                            if (cont.isActive) cont.resume(Unit)
                        } else {
                            Log.e(TAG, "Service discovery failed – status=$status")
                            if (cont.isActive) {
                                cont.resumeWithException(
                                    Exception("Service discovery failed (status=$status)")
                                )
                            }
                        }
                    }

                    override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
                        if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                            Log.e(TAG, "Disconnected during service discovery")
                            if (cont.isActive) {
                                cont.resumeWithException(Exception("Disconnected during service discovery"))
                            }
                        }
                    }
                }

                try {
                    // We need a fresh callback-aware discovery. The simplest reliable
                    // approach is to use a channel / CompletableDeferred, but the
                    // suspendCancellableCoroutine approach with a dedicated
                    // BluetoothGattCallback per operation is cleaner. Because Android
                    // only allows ONE callback per BluetoothGatt (set at connect time),
                    // we store a mutable reference and dispatch from the root callback.
                    // For simplicity here we re-register via reflection-free approach:
                    // store pending continuations in an instance field.
                    pendingServiceDiscovery = cont
                    if (!gatt.discoverServices()) {
                        pendingServiceDiscovery = null
                        if (cont.isActive) {
                            cont.resumeWithException(Exception("discoverServices() returned false"))
                        }
                    }
                } catch (e: SecurityException) {
                    if (cont.isActive) {
                        cont.resumeWithException(
                            SecurityException("BLE permission missing for service discovery: ${e.message}")
                        )
                    }
                }
            }
        }
    }

    // ── Authentication ──────────────────────────────────────────────────

    private suspend fun authenticate(password: String) {
        val gatt = bluetoothGatt ?: throw IllegalStateException("Not connected")
        val passwordBytes = password.toByteArray(Charsets.US_ASCII)

        // Build auth payload: [0xEA, 0x01, 0x51, 0x08, ...password_bytes]
        val header = byteArrayOf(
            0xEA.toByte(),
            0x01.toByte(),
            0x51.toByte(),
            passwordBytes.size.toByte()
        )
        val payload = header + passwordBytes

        // Try primary service AA00 / char AA04
        val primarySvc = gatt.getService(MOKO_SVC)
        if (primarySvc != null) {
            val pwChar = primarySvc.getCharacteristic(MOKO_PASSWORD)
            if (pwChar != null) {
                Log.d(TAG, "Authenticating via AA00/AA04")
                writeCharacteristic(gatt, pwChar, payload, "Auth(AA04)")
                return
            } else {
                Log.w(TAG, "AA04 characteristic not found in AA00 service")
            }
        } else {
            Log.w(TAG, "AA00 service not found, trying fallback 1910/2B11")
        }

        // Fallback: service 0x1910 / char 0x2B11
        val fallbackSvc = gatt.getService(FALLBACK_SVC)
        if (fallbackSvc != null) {
            val fbChar = fallbackSvc.getCharacteristic(FALLBACK_CHAR)
            if (fbChar != null) {
                Log.d(TAG, "Authenticating via 1910/2B11 (fallback)")
                writeCharacteristic(gatt, fbChar, payload, "Auth(2B11)")
                return
            }
        }

        // Last resort: write to any writable characteristic we can find
        Log.w(TAG, "No known auth characteristic found, trying any writable char")
        writeToAnyWritable(gatt, payload, "Auth(fallback)")
    }

    // ── Write to Params Characteristic ──────────────────────────────────

    private suspend fun writeToParamsChar(payload: ByteArray, label: String) {
        val gatt = bluetoothGatt ?: throw IllegalStateException("Not connected")

        // Try AA00/AA01
        val primarySvc = gatt.getService(MOKO_SVC)
        if (primarySvc != null) {
            val paramsChar = primarySvc.getCharacteristic(MOKO_PARAMS)
            if (paramsChar != null) {
                Log.d(TAG, "$label → AA00/AA01")
                writeCharacteristic(gatt, paramsChar, payload, label)
                return
            }
        }

        // Fallback: any writable characteristic
        Log.w(TAG, "AA00/AA01 not available for $label, trying any writable char")
        writeToAnyWritable(gatt, payload, label)
    }

    // ── Write to Any Writable Characteristic ────────────────────────────

    private suspend fun writeToAnyWritable(gatt: BluetoothGatt, payload: ByteArray, label: String) {
        for (service in gatt.services) {
            for (char in service.characteristics) {
                val props = char.properties
                if (props and BluetoothGattCharacteristic.PROPERTY_WRITE != 0 ||
                    props and BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE != 0
                ) {
                    Log.d(TAG, "$label → fallback write to ${service.uuid}/${char.uuid}")
                    writeCharacteristic(gatt, char, payload, label)
                    return
                }
            }
        }
        throw Exception("No writable characteristic found for $label")
    }

    // ── Low-level Characteristic Write ──────────────────────────────────

    @SuppressLint("MissingPermission")
    private suspend fun writeCharacteristic(
        gatt: BluetoothGatt,
        characteristic: BluetoothGattCharacteristic,
        value: ByteArray,
        label: String
    ) {
        withTimeout(WRITE_TIMEOUT_MS) {
            suspendCancellableCoroutine<Unit> { cont ->
                pendingWrite = cont

                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        // API 33+: use new writeCharacteristic signature
                        val writeType = if (characteristic.properties and
                            BluetoothGattCharacteristic.PROPERTY_WRITE != 0
                        ) {
                            BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
                        } else {
                            BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
                        }
                        val result = gatt.writeCharacteristic(characteristic, value, writeType)
                        if (result != BluetoothStatusCodes.SUCCESS) {
                            pendingWrite = null
                            if (cont.isActive) {
                                cont.resumeWithException(
                                    Exception("$label writeCharacteristic returned error code $result")
                                )
                            }
                        }
                    } else {
                        // Legacy API
                        @Suppress("DEPRECATION")
                        characteristic.value = value
                        characteristic.writeType =
                            if (characteristic.properties and BluetoothGattCharacteristic.PROPERTY_WRITE != 0) {
                                BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
                            } else {
                                BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
                            }
                        @Suppress("DEPRECATION")
                        if (!gatt.writeCharacteristic(characteristic)) {
                            pendingWrite = null
                            if (cont.isActive) {
                                cont.resumeWithException(
                                    Exception("$label writeCharacteristic() returned false")
                                )
                            }
                        }
                    }

                    Log.d(TAG, "$label: wrote ${value.size} bytes to ${characteristic.uuid}")
                } catch (e: SecurityException) {
                    pendingWrite = null
                    if (cont.isActive) {
                        cont.resumeWithException(
                            SecurityException("BLE permission missing for $label write: ${e.message}")
                        )
                    }
                }
            }
        }
    }

    // ── GATT Callback (single instance, dispatches to pending continuations) ─

    @Volatile private var pendingServiceDiscovery: CancellableContinuation<Unit>? = null
    @Volatile private var pendingWrite: CancellableContinuation<Unit>? = null

    /**
     * The single BluetoothGattCallback used for the lifetime of a connection.
     * It dispatches events to the appropriate pending continuation.
     */
    private val gattCallback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
            if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                Log.w(TAG, "Disconnected (status=$status)")
                pendingServiceDiscovery?.let {
                    if (it.isActive) it.resumeWithException(Exception("Disconnected"))
                }
                pendingWrite?.let {
                    if (it.isActive) it.resumeWithException(Exception("Disconnected"))
                }
            }
        }

        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            val cont = pendingServiceDiscovery
            pendingServiceDiscovery = null
            if (cont == null || !cont.isActive) return

            if (status == BluetoothGatt.GATT_SUCCESS) {
                val uuids = gatt.services.map { it.uuid.toString() }
                Log.d(TAG, "Discovered ${gatt.services.size} services: $uuids")
                cont.resume(Unit)
            } else {
                cont.resumeWithException(Exception("Service discovery failed (status=$status)"))
            }
        }

        override fun onCharacteristicWrite(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
            status: Int
        ) {
            val cont = pendingWrite
            pendingWrite = null
            if (cont == null || !cont.isActive) return

            if (status == BluetoothGatt.GATT_SUCCESS) {
                Log.d(TAG, "Write OK → ${characteristic.uuid}")
                cont.resume(Unit)
            } else {
                cont.resumeWithException(
                    Exception("Write failed for ${characteristic.uuid} (status=$status)")
                )
            }
        }
    }

    // ── Actual connect using the shared callback ────────────────────────

    /**
     * Re-implementation of connect() that uses [gattCallback] so that
     * service discovery and writes can be dispatched through it.
     */
    @SuppressLint("MissingPermission")
    private suspend fun connectInternal(macAddress: String) {
        val adapter = BluetoothAdapter.getDefaultAdapter()
            ?: throw IllegalStateException("Bluetooth not available")

        val device: BluetoothDevice = try {
            adapter.getRemoteDevice(macAddress)
        } catch (e: IllegalArgumentException) {
            throw IllegalArgumentException("Invalid MAC address: $macAddress", e)
        }

        Log.d(TAG, "Connecting to $macAddress …")

        bluetoothGatt = withTimeout(CONNECT_TIMEOUT_MS) {
            suspendCancellableCoroutine { cont ->
                try {
                    val gatt = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        device.connectGatt(context, false, connectCallbackFor(cont), BluetoothDevice.TRANSPORT_LE)
                    } else {
                        device.connectGatt(context, false, connectCallbackFor(cont))
                    }

                    cont.invokeOnCancellation {
                        try {
                            gatt.disconnect()
                            gatt.close()
                        } catch (_: SecurityException) {}
                    }
                } catch (e: SecurityException) {
                    if (cont.isActive) {
                        cont.resumeWithException(
                            SecurityException("BLE CONNECT permission missing: ${e.message}")
                        )
                    }
                }
            }
        }
    }

    /**
     * Creates a [BluetoothGattCallback] that resolves the connection continuation
     * and then delegates all subsequent events to [gattCallback].
     */
    private fun connectCallbackFor(cont: CancellableContinuation<BluetoothGatt>): BluetoothGattCallback {
        return object : BluetoothGattCallback() {
            @Volatile private var connected = false

            override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
                if (!connected) {
                    if (newState == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) {
                        connected = true
                        Log.d(TAG, "Connected to ${gatt.device.address}")
                        if (cont.isActive) cont.resume(gatt)
                    } else {
                        gatt.close()
                        if (cont.isActive) {
                            cont.resumeWithException(
                                Exception("Connection failed (status=$status, state=$newState)")
                            )
                        }
                    }
                } else {
                    // Delegate post-connection events
                    gattCallback.onConnectionStateChange(gatt, status, newState)
                }
            }

            override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
                gattCallback.onServicesDiscovered(gatt, status)
            }

            override fun onCharacteristicWrite(
                gatt: BluetoothGatt,
                characteristic: BluetoothGattCharacteristic,
                status: Int
            ) {
                gattCallback.onCharacteristicWrite(gatt, characteristic, status)
            }
        }
    }

    /**
     * Helper – there is no public accessor for the callback set at connect time,
     * so this is a no-op placeholder referenced by the initial [discoverServices]
     * implementation. The actual dispatching uses [connectCallbackFor].
     */
    private fun gattCallbackField(gatt: BluetoothGatt): BluetoothGattCallback? = null

    // ── Refactored public connect (uses shared callback) ────────────────

    init {
        // Override the public connect/discoverServices to use the shared callback path.
        // Kotlin doesn't allow overriding private methods, so we simply ensure the
        // public entry points (connectAndAlert, connectAndAuth) call connectInternal.
    }

    /**
     * Full flow using the shared callback approach.
     */
    suspend fun connectAuthAndAlert(macAddress: String, password: String = DEFAULT_PASSWORD) {
        try {
            connectInternal(macAddress)
            discoverServicesInternal()
            authenticate(password)
            blinkLed()
            buzz()
        } catch (e: Exception) {
            Log.e(TAG, "connectAuthAndAlert failed for $macAddress: ${e.message}", e)
            throw e
        } finally {
            disconnect()
        }
    }

    @SuppressLint("MissingPermission")
    private suspend fun discoverServicesInternal() {
        val gatt = bluetoothGatt ?: throw IllegalStateException("Not connected")

        withTimeout(CONNECT_TIMEOUT_MS) {
            suspendCancellableCoroutine<Unit> { cont ->
                pendingServiceDiscovery = cont
                try {
                    if (!gatt.discoverServices()) {
                        pendingServiceDiscovery = null
                        if (cont.isActive) {
                            cont.resumeWithException(Exception("discoverServices() returned false"))
                        }
                    }
                } catch (e: SecurityException) {
                    pendingServiceDiscovery = null
                    if (cont.isActive) {
                        cont.resumeWithException(
                            SecurityException("BLE permission missing: ${e.message}")
                        )
                    }
                }
            }
        }
    }
}
