package expo.modules.fmdn

import android.annotation.SuppressLint
import android.bluetooth.*
import android.content.Context
import android.os.Build
import android.util.Base64
import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import kotlin.concurrent.thread

class ExpoFmdnModule : Module() {

  companion object {
    private const val TAG = "ExpoFMDN"

    // FMDN GATT UUIDs
    private val FMDN_SERVICE = UUID.fromString("0000fe2c-0000-1000-8000-00805f9b34fb")
    private val KEY_BASED_PAIRING = UUID.fromString("fe2c1234-8366-4814-8eb0-01de32100bea")
    private val PASSKEY_CHAR = UUID.fromString("fe2c1235-8366-4814-8eb0-01de32100bea")
    private val ACCOUNT_KEY_CHAR = UUID.fromString("fe2c1236-8366-4814-8eb0-01de32100bea")
    private val BEACON_ACTIONS = UUID.fromString("fe2c1238-8366-4814-8eb0-01de32100bea")

    // FMDN Data IDs
    private const val READ_PARAMS: Byte = 0x00
    private const val READ_PROVISIONING: Byte = 0x01
    private const val SET_EIK: Byte = 0x02
    private const val CLEAR_EIK: Byte = 0x03
    private const val RING: Byte = 0x05
  }

  private val adapter: BluetoothAdapter?
    get() = (appContext.reactContext?.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

  override fun definition() = ModuleDefinition {
    Name("ExpoFmdn")

    // Discover FMDN services on a device — returns true if FE2C is found
    AsyncFunction("discoverFmdn") { macAddress: String, promise: Promise ->
      connectAndDiscover(macAddress) { gatt, hasService ->
        gatt.disconnect()
        gatt.close()
        promise.resolve(hasService)
      }
    }

    // Provision EIK: generate account key + EIK, write both to tracker
    // Returns { accountKey: base64, eik: base64 } or null
    AsyncFunction("provisionTracker") { macAddress: String, promise: Promise ->
      thread {
        try {
          // Timeout: reject if not resolved in 15s
          val resolved = java.util.concurrent.atomic.AtomicBoolean(false)
          val wrappedPromise = object : Promise {
            override fun resolve(value: Any?) { if (resolved.compareAndSet(false, true)) promise.resolve(value) }
            override fun reject(code: String, message: String?, cause: Throwable?) { if (resolved.compareAndSet(false, true)) promise.reject(code, message, cause) }
          }
          thread {
            Thread.sleep(15000)
            if (resolved.compareAndSet(false, true)) {
              Log.w(TAG, "[Provision] Timeout after 15s")
              promise.reject("FMDN_TIMEOUT", "Provisioning timed out after 15s", null)
            }
          }
          provisionTrackerImpl(macAddress, wrappedPromise)
        } catch (e: Exception) {
          Log.e(TAG, "provisionTracker error", e)
          promise.reject("FMDN_ERROR", e.message ?: "Unknown error", e)
        }
      }
    }

    // Ring a provisioned tracker using stored EIK
    AsyncFunction("ringTracker") { macAddress: String, eikBase64: String, promise: Promise ->
      thread {
        try {
          ringTrackerImpl(macAddress, eikBase64, promise)
        } catch (e: Exception) {
          Log.e(TAG, "ringTracker error", e)
          promise.reject("FMDN_ERROR", e.message ?: "Unknown error", e)
        }
      }
    }

    // Stop ring
    AsyncFunction("stopRing") { macAddress: String, eikBase64: String, promise: Promise ->
      thread {
        try {
          stopRingImpl(macAddress, eikBase64, promise)
        } catch (e: Exception) {
          Log.e(TAG, "stopRing error", e)
          promise.reject("FMDN_ERROR", e.message ?: "Unknown error", e)
        }
      }
    }
  }

  // ── Connect and discover FMDN service ──────────────────────────────────

  @SuppressLint("MissingPermission")
  private fun connectAndDiscover(macAddress: String, callback: (BluetoothGatt, Boolean) -> Unit) {
    val device = adapter?.getRemoteDevice(macAddress) ?: run {
      Log.e(TAG, "Device not found: $macAddress")
      return
    }

    val context = appContext.reactContext ?: return

    device.connectGatt(context, true, object : BluetoothGattCallback() {
      override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
        if (newState == BluetoothProfile.STATE_CONNECTED) {
          Log.i(TAG, "Connected to $macAddress, discovering services...")
          gatt.discoverServices()
        } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
          Log.i(TAG, "Disconnected from $macAddress")
        }
      }

      override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
        if (status == BluetoothGatt.GATT_SUCCESS) {
          val service = gatt.getService(FMDN_SERVICE)
          val hasBeaconActions = service?.getCharacteristic(BEACON_ACTIONS) != null
          Log.i(TAG, "Service discovery complete. FE2C found: $hasBeaconActions")
          if (service != null) {
            val chars = service.characteristics.map { "${it.uuid} (prop=0x${it.properties.toString(16)})" }
            Log.i(TAG, "FE2C characteristics: $chars")
          } else {
            // Log all services for debugging
            val allSvcs = gatt.services.map { it.uuid.toString() }
            Log.i(TAG, "All services: $allSvcs")
          }
          callback(gatt, hasBeaconActions)
        } else {
          Log.e(TAG, "Service discovery failed: $status")
          callback(gatt, false)
        }
      }
    })
  }

  // ── Provision tracker (Account Key + EIK) ──────────────────────────────

  @SuppressLint("MissingPermission")
  private fun provisionTrackerImpl(macAddress: String, promise: Promise) {
    val device = adapter?.getRemoteDevice(macAddress)
    if (device == null) {
      promise.reject("FMDN_ERROR", "Device not found: $macAddress", null)
      return
    }

    val context = appContext.reactContext
    if (context == null) {
      promise.reject("FMDN_ERROR", "No context", null)
      return
    }

    // Generate 16-byte account key and 32-byte EIK
    val accountKey = ByteArray(16).also { SecureRandom().nextBytes(it) }
    val eik = ByteArray(32).also { SecureRandom().nextBytes(it) }

    var step = 0 // 0=connect, 1=discover, 2=write account key, 3=read nonce, 4=write EIK
    var nonce: ByteArray? = null
    var protocolVersion: Byte = 0x01

    var retries = 0
    fun doConnect() {
      Log.i(TAG, "[Provision] Connecting attempt ${retries + 1}/3 to $macAddress...")
      device.connectGatt(context, true, object : BluetoothGattCallback() {
      override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
        if (newState == BluetoothProfile.STATE_CONNECTED) {
          Log.i(TAG, "[Provision] Connected! Discovering services...")
          step = 1
          gatt.discoverServices()
        } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
          if (step < 4) {
            Log.w(TAG, "[Provision] Disconnected at step $step (status=$status)")
            gatt.close()
            retries++
            if (retries < 3) {
              Thread.sleep(1000)
              doConnect()
            } else {
              promise.reject("FMDN_ERROR", "Connection failed after 3 retries", null)
            }
          }
        }
      }

      override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
        if (status != BluetoothGatt.GATT_SUCCESS) {
          promise.reject("FMDN_ERROR", "Service discovery failed", null)
          gatt.disconnect(); gatt.close()
          return
        }

        val service = gatt.getService(FMDN_SERVICE)
        if (service == null) {
          // Log what we found
          val allSvcs = gatt.services.map { it.uuid.toString() }
          Log.e(TAG, "[Provision] FE2C service not found. Available: $allSvcs")
          promise.reject("FMDN_NOT_FOUND", "FMDN service (FE2C) not found on device. Services: ${allSvcs.joinToString()}", null)
          gatt.disconnect(); gatt.close()
          return
        }

        Log.i(TAG, "[Provision] FE2C found! Writing account key...")

        // Step 2: Write account key (0xFE2C1236)
        val accountKeyChar = service.getCharacteristic(ACCOUNT_KEY_CHAR)
        if (accountKeyChar == null) {
          promise.reject("FMDN_ERROR", "Account Key characteristic not found", null)
          gatt.disconnect(); gatt.close()
          return
        }

        step = 2
        writeCharacteristic(gatt, accountKeyChar, accountKey)
      }

      override fun onCharacteristicWrite(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
        val service = gatt.getService(FMDN_SERVICE) ?: return

        when (step) {
          2 -> {
            // Account key written
            if (status == BluetoothGatt.GATT_SUCCESS) {
              Log.i(TAG, "[Provision] Account key written! Reading nonce from Beacon Actions...")
              step = 3
              val beaconActions = service.getCharacteristic(BEACON_ACTIONS)
              if (beaconActions != null) {
                gatt.readCharacteristic(beaconActions)
              } else {
                // Try writing EIK directly without nonce
                Log.w(TAG, "[Provision] Beacon Actions not found, trying EIK write anyway...")
                writeEik(gatt, service, eik, null, 0x01)
              }
            } else {
              Log.e(TAG, "[Provision] Account key write failed: $status")
              promise.reject("FMDN_ERROR", "Account key write failed (status=$status)", null)
              gatt.disconnect(); gatt.close()
            }
          }
          4 -> {
            // EIK written
            if (status == BluetoothGatt.GATT_SUCCESS) {
              Log.i(TAG, "✅ [Provision] EIK provisioned successfully!")
              val result = mapOf(
                "accountKey" to Base64.encodeToString(accountKey, Base64.NO_WRAP),
                "eik" to Base64.encodeToString(eik, Base64.NO_WRAP)
              )
              promise.resolve(result)
            } else {
              Log.e(TAG, "[Provision] EIK write failed: $status")
              promise.reject("FMDN_ERROR", "EIK write failed (status=$status)", null)
            }
            gatt.disconnect(); gatt.close()
          }
        }
      }

      override fun onCharacteristicRead(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray, status: Int) {
        if (step == 3 && status == BluetoothGatt.GATT_SUCCESS) {
          if (value.size >= 9) {
            protocolVersion = value[0]
            nonce = value.copyOfRange(1, 9)
            Log.i(TAG, "[Provision] Nonce read: ${nonce!!.joinToString(" ") { "%02x".format(it) }}")
          }
          val service = gatt.getService(FMDN_SERVICE) ?: return
          writeEik(gatt, service, eik, nonce, protocolVersion)
        }
      }

      // Legacy API for older Android versions
      @Deprecated("Required for API < 33")
      override fun onCharacteristicRead(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
          @Suppress("DEPRECATION")
          onCharacteristicRead(gatt, characteristic, characteristic.value ?: ByteArray(0), status)
        }
      }

      private fun writeEik(gatt: BluetoothGatt, service: BluetoothGattService, eik: ByteArray, nonce: ByteArray?, version: Byte) {
        step = 4
        val beaconActions = service.getCharacteristic(BEACON_ACTIONS) ?: run {
          promise.reject("FMDN_ERROR", "Beacon Actions characteristic not found", null)
          gatt.disconnect(); gatt.close()
          return
        }

        // Build Set EIK payload: [0x02][length][eik_bytes]
        // Simple provisioning without auth (for unpaired devices)
        val payload = ByteArray(2 + eik.size)
        payload[0] = SET_EIK
        payload[1] = eik.size.toByte()
        System.arraycopy(eik, 0, payload, 2, eik.size)

        Log.i(TAG, "[Provision] Writing EIK (${eik.size} bytes)...")
        writeCharacteristic(gatt, beaconActions, payload)
      }
    })
    }
    doConnect()
  }

  // ── Ring tracker ────────────────────────────────────────────────────────

  @SuppressLint("MissingPermission")
  private fun ringTrackerImpl(macAddress: String, eikBase64: String, promise: Promise) {
    val eik = Base64.decode(eikBase64, Base64.NO_WRAP)
    val ringKey = deriveKey(eik, 0x02)

    val device = adapter?.getRemoteDevice(macAddress)
    val context = appContext.reactContext
    if (device == null || context == null) {
      promise.reject("FMDN_ERROR", "Device or context not found", null)
      return
    }

    device.connectGatt(context, true, object : BluetoothGattCallback() {
      override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
        if (newState == BluetoothProfile.STATE_CONNECTED) {
          gatt.discoverServices()
        }
      }

      override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
        val service = gatt.getService(FMDN_SERVICE)
        val beaconActions = service?.getCharacteristic(BEACON_ACTIONS)
        if (beaconActions == null) {
          promise.reject("FMDN_NOT_FOUND", "FMDN service not found", null)
          gatt.disconnect(); gatt.close()
          return
        }
        // Read nonce first
        gatt.readCharacteristic(beaconActions)
      }

      override fun onCharacteristicRead(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray, status: Int) {
        if (status != BluetoothGatt.GATT_SUCCESS || value.size < 9) {
          promise.reject("FMDN_ERROR", "Failed to read nonce", null)
          gatt.disconnect(); gatt.close()
          return
        }

        val protocolVersion = value[0]
        val nonce = value.copyOfRange(1, 9)
        Log.i(TAG, "[Ring] Nonce: ${nonce.joinToString(" ") { "%02x".format(it) }}")

        // Ring parameters
        val ringOp: Byte = 0xFF.toByte()   // ring all
        val timeoutHi: Byte = 0x00         // 60 deciseconds = 6 sec
        val timeoutLo: Byte = 0x3C
        val volume: Byte = 0x03            // high
        val additionalData = byteArrayOf(ringOp, timeoutHi, timeoutLo, volume)

        // HMAC auth
        val hmacInput = byteArrayOf(protocolVersion) + nonce + byteArrayOf(RING, additionalData.size.toByte()) + additionalData
        val auth = hmacSha256(ringKey, hmacInput).copyOfRange(0, 8)

        Log.i(TAG, "[Ring] Auth: ${auth.joinToString(" ") { "%02x".format(it) }}")

        // Build payload: [data_id][data_len][auth 8B][additional_data 4B]
        val dataLen = (8 + additionalData.size).toByte()
        val payload = byteArrayOf(RING, dataLen) + auth + additionalData

        val service = gatt.getService(FMDN_SERVICE) ?: return
        val beaconActions = service.getCharacteristic(BEACON_ACTIONS) ?: return
        writeCharacteristic(gatt, beaconActions, payload)
      }

      @Deprecated("Required for API < 33")
      override fun onCharacteristicRead(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
          @Suppress("DEPRECATION")
          onCharacteristicRead(gatt, characteristic, characteristic.value ?: ByteArray(0), status)
        }
      }

      override fun onCharacteristicWrite(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
        if (status == BluetoothGatt.GATT_SUCCESS) {
          Log.i(TAG, "✅ [Ring] Ring command sent!")
          promise.resolve(true)
        } else {
          Log.e(TAG, "[Ring] Write failed: $status")
          promise.reject("FMDN_ERROR", "Ring write failed (status=$status)", null)
        }
        // Keep connected for 7s then disconnect
        Thread.sleep(7000)
        gatt.disconnect(); gatt.close()
      }
    })
  }

  // ── Stop ring ───────────────────────────────────────────────────────────

  @SuppressLint("MissingPermission")
  private fun stopRingImpl(macAddress: String, eikBase64: String, promise: Promise) {
    val eik = Base64.decode(eikBase64, Base64.NO_WRAP)
    val ringKey = deriveKey(eik, 0x02)

    val device = adapter?.getRemoteDevice(macAddress)
    val context = appContext.reactContext
    if (device == null || context == null) {
      promise.reject("FMDN_ERROR", "Device or context not found", null)
      return
    }

    device.connectGatt(context, true, object : BluetoothGattCallback() {
      override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
        if (newState == BluetoothProfile.STATE_CONNECTED) gatt.discoverServices()
      }

      override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
        val beaconActions = gatt.getService(FMDN_SERVICE)?.getCharacteristic(BEACON_ACTIONS)
        if (beaconActions == null) {
          promise.reject("FMDN_NOT_FOUND", "FMDN not found", null)
          gatt.disconnect(); gatt.close()
          return
        }
        gatt.readCharacteristic(beaconActions)
      }

      override fun onCharacteristicRead(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray, status: Int) {
        if (status != BluetoothGatt.GATT_SUCCESS || value.size < 9) {
          gatt.disconnect(); gatt.close()
          promise.reject("FMDN_ERROR", "Failed to read nonce", null)
          return
        }
        val protocolVersion = value[0]
        val nonce = value.copyOfRange(1, 9)
        val additionalData = byteArrayOf(0x00, 0x00, 0x00, 0x00) // stop ring
        val hmacInput = byteArrayOf(protocolVersion) + nonce + byteArrayOf(RING, additionalData.size.toByte()) + additionalData
        val auth = hmacSha256(ringKey, hmacInput).copyOfRange(0, 8)
        val payload = byteArrayOf(RING, (8 + additionalData.size).toByte()) + auth + additionalData

        val beaconActions = gatt.getService(FMDN_SERVICE)?.getCharacteristic(BEACON_ACTIONS) ?: return
        writeCharacteristic(gatt, beaconActions, payload)
      }

      @Deprecated("Required for API < 33")
      override fun onCharacteristicRead(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
          @Suppress("DEPRECATION")
          onCharacteristicRead(gatt, characteristic, characteristic.value ?: ByteArray(0), status)
        }
      }

      override fun onCharacteristicWrite(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
        promise.resolve(status == BluetoothGatt.GATT_SUCCESS)
        gatt.disconnect(); gatt.close()
      }
    })
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  @SuppressLint("MissingPermission")
  private fun writeCharacteristic(gatt: BluetoothGatt, char: BluetoothGattCharacteristic, value: ByteArray) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      gatt.writeCharacteristic(char, value, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT)
    } else {
      @Suppress("DEPRECATION")
      char.value = value
      @Suppress("DEPRECATION")
      char.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
      @Suppress("DEPRECATION")
      gatt.writeCharacteristic(char)
    }
  }

  /** Derive key: SHA256(EIK || suffix), truncated to 8 bytes */
  private fun deriveKey(eik: ByteArray, suffix: Byte): ByteArray {
    val digest = MessageDigest.getInstance("SHA-256")
    digest.update(eik)
    digest.update(suffix)
    return digest.digest().copyOfRange(0, 8)
  }

  /** HMAC-SHA256 */
  private fun hmacSha256(key: ByteArray, data: ByteArray): ByteArray {
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(key, "HmacSHA256"))
    return mac.doFinal(data)
  }
}
