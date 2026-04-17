import { BleManager } from 'react-native-ble-plx'
import { PermissionsAndroid, Platform } from 'react-native'
import CryptoJS from 'crypto-js'

let bleManager: BleManager | null = null

function getBleManager(): BleManager {
  if (!bleManager || (bleManager as any)._destroyed) {
    try {
      console.log('🔧 Inicializando BleManager...')
      bleManager = new BleManager()
      console.log('✅ BleManager inicializado com sucesso')
    } catch (error) {
      console.error('❌ BleManager initialization failed:', error)
      throw new Error('Bluetooth not available in this environment')
    }
  }
  return bleManager
}

export interface BluetoothDevice {
  id: string
  name: string | null
  rssi: number
  serviceUUIDs?: string[]
  manufacturerData?: string | null
  isFastPairP23?: boolean  // true if service data contains Model ID 073482
}

export const BLEService = {
  // Request permissions (only asks if not already granted)
  async requestPermissions(): Promise<boolean> {
    if (Platform.OS === 'android') {
      const permissions = [
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ]

      try {
        // Check first — avoid showing dialog if already granted
        const checks = await Promise.all(permissions.map(p => PermissionsAndroid.check(p)))
        if (checks.every(Boolean)) {
          console.log('✅ BLE permissions already granted')
          return true
        }

        // Only request what's missing
        const missing = permissions.filter((_, i) => !checks[i])
        const granted = await PermissionsAndroid.requestMultiple(missing)
        const allGranted = Object.values(granted).every(
          perm => perm === PermissionsAndroid.RESULTS.GRANTED,
        )
        return allGranted
      } catch (err) {
        console.error('❌ Permission request error:', err)
        return false
      }
    }
    return true
  },

  // Check if Bluetooth is enabled
  async checkBluetoothState(): Promise<boolean> {
    try {
      const state = await getBleManager().state()
      return state === 'PoweredOn'
    } catch (err) {
      console.error('❌ Error checking Bluetooth state:', err)
      return false
    }
  },

  // Start scanning for devices
  async startScanning(
    onDeviceFound: (device: BluetoothDevice) => void,
    onScanningError?: (error: Error) => void,
  ): Promise<void> {
    try {
      console.log('📋 Verificando permissões...')
      const hasPermission = await BLEService.requestPermissions()
      console.log(`${hasPermission ? '✅' : '❌'} Permissões: ${hasPermission}`)
      if (!hasPermission) {
        throw new Error('Bluetooth permissions not granted')
      }

      console.log('🔍 Verificando estado do Bluetooth...')
      const isEnabled = await BLEService.checkBluetoothState()
      console.log(`${isEnabled ? '✅' : '❌'} Bluetooth habilitado: ${isEnabled}`)
      if (!isEnabled) {
        throw new Error('Bluetooth is not enabled')
      }

      console.log('🚀 Iniciando BLE scan...')
      getBleManager().startDeviceScan(null, { allowDuplicates: true }, (error, device) => {
        if (error) {
          console.error('❌ Scan error:', error)
          onScanningError?.(error)
          return
        }

        if (device) {
          // Check Fast Pair Model ID 073482 from FE2C service data
          let isFastPairP23 = false
          if (device.serviceData) {
            const fe2cData = (device.serviceData as any)?.['0000fe2c-0000-1000-8000-00805f9b34fb']
            if (fe2cData === 'BzSC') isFastPairP23 = true // base64 of 073482
          }
          onDeviceFound({
            id: device.id,
            name: device.name || 'Anonymous',
            rssi: device.rssi || 0,
            manufacturerData: device.manufacturerData,
            serviceUUIDs: device.serviceUUIDs,
            isFastPairP23,
          })
        }
      })
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error')
      console.error('❌ Start scanning error:', error)
      onScanningError?.(error)
    }
  },

  // Stop scanning
  async stopScanning(): Promise<void> {
    try {
      await getBleManager().stopDeviceScan()
      console.log('✅ BLE scan stopped')
    } catch (err) {
      console.error('❌ Stop scanning error:', err)
    }
  },

  // Connect to device
  async connectToDevice(deviceId: string): Promise<boolean> {
    try {
      console.log(`✅ Connecting to device: ${deviceId}`)
      const device = await getBleManager().connectToDevice(deviceId, { timeout: 10000, refreshGatt: 'OnConnected' })
      console.log(`✅ Connected to: ${device.name}`)
      return true
    } catch (err) {
      console.error('❌ Connection error:', err)
      return false
    }
  },

  // Disconnect device
  async disconnectDevice(deviceId: string): Promise<void> {
    try {
      await getBleManager().cancelDeviceConnection(deviceId)
      console.log(`✅ Disconnected from device: ${deviceId}`)
    } catch (err) {
      console.error('❌ Disconnection error:', err)
    }
  },

  // Discover services and characteristics
  async discoverServices(deviceId: string): Promise<boolean> {
    try {
      const device = await getBleManager().discoverAllServicesAndCharacteristicsForDevice(deviceId)
      console.log(`✅ Services discovered for ${device.name}`)
      return true
    } catch (err) {
      console.error('❌ Discovery error:', err)
      return false
    }
  },

  // Read characteristic
  async readCharacteristic(
    deviceId: string,
    serviceUUID: string,
    characteristicUUID: string,
  ): Promise<string | null> {
    try {
      const characteristic = await getBleManager().readCharacteristicForDevice(
        deviceId,
        serviceUUID,
        characteristicUUID,
      )
      return characteristic.value
    } catch (err) {
      console.error('❌ Read characteristic error:', err)
      return null
    }
  },

  // Write characteristic
  async writeCharacteristic(
    deviceId: string,
    serviceUUID: string,
    characteristicUUID: string,
    data: string,
  ): Promise<boolean> {
    try {
      await getBleManager().writeCharacteristicWithoutResponseForDevice(
        deviceId,
        serviceUUID,
        characteristicUUID,
        data,
      )
      return true
    } catch (err) {
      console.error('❌ Write characteristic error:', err)
      return false
    }
  },

  // ── FMDN helpers ──────────────────────────────────────────────────────
  // Encode byte array → base64 (used by multiple methods)
  _toBase64(bytes: number[]): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    let out = ''
    for (let i = 0; i < bytes.length; i += 3) {
      const b0 = bytes[i], b1 = bytes[i + 1] ?? 0, b2 = bytes[i + 2] ?? 0
      out += chars[b0 >> 2]
      out += chars[((b0 & 3) << 4) | (b1 >> 4)]
      out += i + 1 < bytes.length ? chars[((b1 & 15) << 2) | (b2 >> 6)] : '='
      out += i + 2 < bytes.length ? chars[b2 & 63] : '='
    }
    return out
  },

  _fromBase64(b64: string): number[] {
    const bytes: number[] = []
    try {
      const str = atob(b64)
      for (let i = 0; i < str.length; i++) bytes.push(str.charCodeAt(i))
    } catch { /* empty */ }
    return bytes
  },

  /**
   * Provision an EIK (Ephemeral Identity Key) on an FMDN tracker.
   * Bug report confirmed: service 0000fe2c exists with fe2c1238 (Beacon Actions)
   * but discoverAllServicesAndCharacteristics() doesn't always show it (GATT cache issue).
   * Strategy: try direct write to known UUIDs first, then discover as fallback.
   */
  async provisionEIK(deviceId: string): Promise<string | null> {
    const FMDN_SVC         = '0000fe2c-0000-1000-8000-00805f9b34fb'
    const ACCOUNT_KEY_CHAR = 'fe2c1236-8366-4814-8eb0-01de32100bea'
    const BEACON_ACTIONS   = 'fe2c1238-8366-4814-8eb0-01de32100bea'

    try {
      // NÃO para o scan — conexão funciona com scan rodando
      // NÃO faz mini-scan — usa MAC do caller (devices array do UI scan)
      await getBleManager().cancelDeviceConnection(deviceId).catch(() => {})
      console.log(`[FMDN] Provisioning for ${deviceId} (scan running)...`)
      const device = await getBleManager().connectToDevice(deviceId, { timeout: 10000, refreshGatt: 'OnConnected' })
      await device.discoverAllServicesAndCharacteristics()

      const services = await device.services()
      const svcUuids = services.map(s => s.uuid)
      console.log(`[FMDN] Services: ${svcUuids.join(', ')}`)

      if (!svcUuids.some(u => u.includes('fe2c'))) {
        console.warn('[FMDN] FE2C service not found')
        await getBleManager().cancelDeviceConnection(deviceId).catch(() => {})
        return null
      }

      // Generate 16-byte account key and 32-byte EIK
      const accountKeyBytes: number[] = []
      for (let i = 0; i < 16; i++) accountKeyBytes.push(Math.floor(Math.random() * 256))
      // Byte 0 must be 0x04 for account key type
      accountKeyBytes[0] = 0x04

      const eikBytes: number[] = []
      for (let i = 0; i < 32; i++) eikBytes.push(Math.floor(Math.random() * 256))

      // AccountKey is NOT written to fe2c1236 (MicflipFinder APK doesn't do this)
      // It's only used for HMAC/AES-ECB crypto in the Set EIK payload

      // Step 2: Read nonce from Beacon Actions
      let nonce: number[] = []
      let protocolVersion = 0x01
      try {
        const readResult = await getBleManager().readCharacteristicForDevice(deviceId, FMDN_SVC, BEACON_ACTIONS)
        if (readResult.value) {
          const raw = this._fromBase64(readResult.value)
          if (raw.length >= 9) {
            protocolVersion = raw[0]
            nonce = raw.slice(1, 9)
            console.log(`✅ [FMDN] Nonce: ${nonce.map(b => b.toString(16).padStart(2, '0')).join(' ')}`)
          }
        }
      } catch (e) {
        console.warn('[FMDN] Nonce read failed:', (e as Error)?.message)
      }

      // Step 3: Build all 9 EIK variations (from MicflipFinder APK reverse engineering)
      // AES-ECB encrypt: split EIK into 2x16-byte blocks, encrypt each with accountKey
      const aesEcb = (key: number[], data: number[]): number[] => {
        const keyWA = CryptoJS.lib.WordArray.create(new Uint8Array(key))
        const b1 = CryptoJS.AES.encrypt(CryptoJS.lib.WordArray.create(new Uint8Array(data.slice(0, 16))), keyWA, { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.NoPadding })
        const b2 = CryptoJS.AES.encrypt(CryptoJS.lib.WordArray.create(new Uint8Array(data.slice(16, 32))), keyWA, { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.NoPadding })
        const hex = b1.ciphertext.toString(CryptoJS.enc.Hex) + b2.ciphertext.toString(CryptoJS.enc.Hex)
        const out: number[] = []
        for (let i = 0; i < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16))
        return out
      }
      const hmac8 = (key: number[], data: number[]): number[] => {
        const h = CryptoJS.HmacSHA256(CryptoJS.lib.WordArray.create(new Uint8Array(data)), CryptoJS.lib.WordArray.create(new Uint8Array(key)))
        const hex = h.toString(CryptoJS.enc.Hex).slice(0, 16)
        const out: number[] = []
        for (let i = 0; i < 16; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16))
        return out
      }

      const eikEnc = aesEcb(accountKeyBytes, eikBytes)
      const nonce8 = nonce
      const dId = 0x02

      const variations: { name: string; payload: number[] }[] = [
        { name: 'C1: hmac(nonce) enc32', payload: [dId, 40, ...hmac8(accountKeyBytes, nonce8), ...eikEnc] },
        { name: 'C1b: hmac(nonce) plain', payload: [dId, 40, ...hmac8(accountKeyBytes, nonce8), ...eikBytes] },
        { name: 'C1c: hmac(nonce) dLen=0x20', payload: [dId, 32, ...hmac8(accountKeyBytes, nonce8), ...eikEnc] },
        { name: 'C1d: hmac(nonce+dId)', payload: [dId, 40, ...hmac8(accountKeyBytes, [...nonce8, dId]), ...eikEnc] },
        { name: 'C1e: hmac(nonce+eikEnc)', payload: [dId, 40, ...hmac8(accountKeyBytes, [...nonce8, ...eikEnc]), ...eikEnc] },
        { name: 'C1f: hmac_eik(nonce)', payload: [dId, 40, ...hmac8(eikBytes, nonce8), ...eikEnc] },
        { name: 'A1: full-hmac v1', payload: [dId, 40, ...hmac8(accountKeyBytes, [protocolVersion, ...nonce8, dId, 40, ...eikEnc]), ...eikEnc] },
        { name: 'D1: noAuth dLen=0x20', payload: [dId, 32, ...eikEnc] },
        { name: 'D2: noAuth dLen=0x28', payload: [dId, 40, ...eikEnc] },
      ]

      // Step 4: Try each variation
      let eikWritten = false
      for (const v of variations) {
        try {
          await getBleManager().writeCharacteristicWithResponseForDevice(
            deviceId, FMDN_SVC, BEACON_ACTIONS, this._toBase64(v.payload))
          console.log(`✅ [FMDN] EIK written! ${v.name}`)
          eikWritten = true
          break
        } catch {
          console.warn(`[FMDN] ${v.name} rejected`)
        }
      }

      await getBleManager().cancelDeviceConnection(deviceId).catch(() => {})

      if (eikWritten) {
        const eikB64 = this._toBase64(eikBytes)
        console.log(`✅ [FMDN] Provisioned! EIK=${eikB64.slice(0, 10)}...`)
        return eikB64
      }
      return null
    } catch (err) {
      console.warn('[FMDN] provisionEIK error:', (err as Error)?.message)
      await getBleManager().cancelDeviceConnection(deviceId).catch(() => {})
      return null
    }
  },

  /**
   * Ring an FMDN tracker using a stored EIK.
   * Flow: connect → read nonce → derive Ring Key → HMAC auth → write ring.
   */
  async ringFMDN(deviceId: string, eikB64: string): Promise<boolean> {
    const FMDN_SVC       = '0000fe2c-0000-1000-8000-00805f9b34fb'
    const BEACON_ACTIONS  = 'fe2c1238-8366-4814-8eb0-01de32100bea'

    try {
      console.log(`[FMDN Ring] Connecting to ${deviceId}...`)
      const device = await getBleManager().connectToDevice(deviceId, { timeout: 15000, autoConnect: true, refreshGatt: 'OnConnected' })
      await device.discoverAllServicesAndCharacteristics()

      // Try known FMDN service first, then all discovered
      const services = await device.services()
      const candidateSvcs = [FMDN_SVC, ...services.map(s => s.uuid).filter(u => u !== FMDN_SVC)]

      // Step 1: Read nonce — try each service
      let targetSvc: string | null = null
      let readResult: any = null
      for (const svc of candidateSvcs) {
        try {
          readResult = await getBleManager().readCharacteristicForDevice(deviceId, svc, BEACON_ACTIONS)
          if (readResult?.value) { targetSvc = svc; break }
        } catch { /* try next */ }
      }

      if (!targetSvc || !readResult?.value) {
        console.warn('[FMDN Ring] Could not read Beacon Actions from any service')
        await getBleManager().cancelDeviceConnection(deviceId).catch(() => {})
        return false
      }

      console.log(`[FMDN Ring] Beacon Actions found on service ${targetSvc}`)
      if (!readResult.value) {
        await getBleManager().cancelDeviceConnection(deviceId).catch(() => {})
        return false
      }
      const raw = this._fromBase64(readResult.value)
      if (raw.length < 9) {
        console.warn('[FMDN Ring] Invalid nonce response, length:', raw.length)
        await getBleManager().cancelDeviceConnection(deviceId).catch(() => {})
        return false
      }
      const protocolVersion = raw[0]
      const nonce = raw.slice(1, 9)
      console.log(`[FMDN Ring] Protocol v${protocolVersion}, nonce: ${nonce.map(b => b.toString(16).padStart(2, '0')).join(' ')}`)

      // Step 2: Derive Ring Key = SHA256(EIK || 0x02) truncated to 8 bytes
      const eikBytes = this._fromBase64(eikB64)
      const eikWithSuffix = CryptoJS.lib.WordArray.create(new Uint8Array([...eikBytes, 0x02]))
      const ringKeyFull = CryptoJS.SHA256(eikWithSuffix)
      const ringKeyHex = ringKeyFull.toString(CryptoJS.enc.Hex).slice(0, 16) // 8 bytes = 16 hex chars
      const ringKey = CryptoJS.enc.Hex.parse(ringKeyHex)

      // Step 3: Compute auth = HMAC-SHA256(ringKey, version || nonce || dataId || dataLen || additionalData)
      const dataId = 0x05
      const additionalData = [0xFF, 0x00, 0x3C, 0x03] // ring all, timeout 60 deciseconds, volume high
      const dataLen = additionalData.length

      const hmacInput = new Uint8Array([protocolVersion, ...nonce, dataId, dataLen, ...additionalData])
      const hmacInputWA = CryptoJS.lib.WordArray.create(hmacInput)
      const hmacFull = CryptoJS.HmacSHA256(hmacInputWA, ringKey)
      const authHex = hmacFull.toString(CryptoJS.enc.Hex).slice(0, 16) // 8 bytes
      const authBytes: number[] = []
      for (let i = 0; i < 16; i += 2) authBytes.push(parseInt(authHex.slice(i, i + 2), 16))

      // Step 4: Build ring payload
      const ringPayload = [dataId, dataLen + 8, ...authBytes, ...additionalData]
      const payloadB64 = this._toBase64(ringPayload)

      console.log(`[FMDN Ring] Payload: ${ringPayload.map(b => b.toString(16).padStart(2, '0')).join(' ')}`)

      // Step 5: Write
      try {
        await getBleManager().writeCharacteristicWithResponseForDevice(
          deviceId, targetSvc, BEACON_ACTIONS, payloadB64,
        )
        console.log(`✅ [FMDN Ring] Ring command sent!`)
        setTimeout(() => getBleManager().cancelDeviceConnection(deviceId).catch(() => {}), 7000)
        return true
      } catch {
        try {
          await getBleManager().writeCharacteristicWithoutResponseForDevice(
            deviceId, targetSvc, BEACON_ACTIONS, payloadB64,
          )
          console.log(`✅ [FMDN Ring] Ring sent (no-response)`)
          setTimeout(() => getBleManager().cancelDeviceConnection(deviceId).catch(() => {}), 7000)
          return true
        } catch (e) {
          console.warn('[FMDN Ring] Write failed:', (e as Error)?.message)
          await getBleManager().cancelDeviceConnection(deviceId).catch(() => {})
          return false
        }
      }
    } catch (err) {
      console.warn('[FMDN Ring] Error:', (err as Error)?.message)
      await getBleManager().cancelDeviceConnection(deviceId).catch(() => {})
      return false
    }
  },

  // Beep — tenta múltiplos protocolos de trackers BLE
  // Se eikB64 é fornecido, tenta FMDN ring autenticado quando FE2C é encontrado
  async playTuyaSound(deviceId: string, eikB64?: string): Promise<boolean> {
    // Encode byte array → base64
    const toBase64 = (bytes: number[]): string => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
      let out = ''
      for (let i = 0; i < bytes.length; i += 3) {
        const b0 = bytes[i], b1 = bytes[i + 1] ?? 0, b2 = bytes[i + 2] ?? 0
        out += chars[b0 >> 2]
        out += chars[((b0 & 3) << 4) | (b1 >> 4)]
        out += i + 1 < bytes.length ? chars[((b1 & 15) << 2) | (b2 >> 6)] : '='
        out += i + 2 < bytes.length ? chars[b2 & 63] : '='
      }
      return out
    }

    // Tuya frame: 55 AA [ver] [seq 2b] [cmd] [len 2b] [data] [checksum]
    const buildTuyaFrame = (cmd: number, data: number[]): string => {
      const bytes = [0x55, 0xAA, 0x00, 0x00, 0x00, cmd, 0x00, data.length, ...data]
      bytes.push(bytes.reduce((s, b) => s + b, 0) % 256)
      return toBase64(bytes)
    }

    const tryWrite = async (svc: string, char: string, b64: string): Promise<boolean> => {
      try {
        await getBleManager().writeCharacteristicWithResponseForDevice(deviceId, svc, char, b64)
        console.log(`✅ [BLE Beep] write-with-response OK: svc=${svc.slice(4,8)} char=${char.slice(4,8)}`)
        return true
      } catch {
        try {
          await getBleManager().writeCharacteristicWithoutResponseForDevice(deviceId, svc, char, b64)
          console.log(`✅ [BLE Beep] write-no-response OK: svc=${svc.slice(4,8)} char=${char.slice(4,8)}`)
          return true
        } catch {
          return false
        }
      }
    }

    try {
      // Limpar conexão anterior (se houver) para evitar "Operation was cancelled"
      await getBleManager().cancelDeviceConnection(deviceId).catch(() => {})
      console.log(`🔔 [BLE Beep] Conectando: ${deviceId}`)
      const device = await getBleManager().connectToDevice(deviceId, { timeout: 10000, refreshGatt: 'OnConnected' })
      await device.discoverAllServicesAndCharacteristics()

      // Loga os serviços encontrados — útil para diagnóstico
      const services = await device.services()
      const svcList = services.map(s => s.uuid)
      console.log(`[BLE Beep] Serviços encontrados: ${svcList.join(', ')}`)
      for (const svc of services) {
        const chars = await svc.characteristics()
        console.log(`  svc ${svc.uuid} → chars: ${chars.map(c => `${c.uuid}(r=${c.isReadable} w=${c.isWritableWithResponse} wn=${c.isWritableWithoutResponse})`).join(', ')}`)
      }

      let sent = false

      // ── 0. Google FMDN (Find My Device Network) — ring via Beacon Actions ──
      if (!sent) {
        const FMDN_SVC  = '0000fe2c-0000-1000-8000-00805f9b34fb'
        const FMDN_CHAR = 'fe2c1238-8366-4814-8eb0-01de32100bea'
        const hasFmdn = svcList.some(u => u.toLowerCase().includes('fe2c'))

        if (hasFmdn) {
          console.log(`[BLE Beep] FE2C encontrado! ${eikB64 ? 'Ring autenticado com EIK' : 'Ring sem auth'}`)

          if (eikB64) {
            // ── RING AUTENTICADO — lê nonce, calcula HMAC, envia ──
            try {
              const readResult = await getBleManager().readCharacteristicForDevice(deviceId, FMDN_SVC, FMDN_CHAR)
              if (readResult.value) {
                const raw = this._fromBase64(readResult.value)
                if (raw.length >= 9) {
                  const protocolVersion = raw[0]
                  const nonce = raw.slice(1, 9)
                  console.log(`[FMDN Ring] Nonce: ${nonce.map(b => b.toString(16).padStart(2, '0')).join(' ')}`)

                  // Derive Ring Key = SHA256(EIK || 0x02) truncated to 8 bytes
                  const eikBytes = this._fromBase64(eikB64)
                  const eikWithSuffix = CryptoJS.lib.WordArray.create(new Uint8Array([...eikBytes, 0x02]))
                  const ringKeyFull = CryptoJS.SHA256(eikWithSuffix)
                  const ringKeyHex = ringKeyFull.toString(CryptoJS.enc.Hex).slice(0, 16)
                  const ringKey = CryptoJS.enc.Hex.parse(ringKeyHex)

                  // Additional data: ring_all, timeout 60 deciseconds, volume high
                  const additionalData = [0xFF, 0x00, 0x3C, 0x03]
                  const dataId = 0x05
                  const dataLen = additionalData.length

                  // HMAC auth
                  const hmacInput = new Uint8Array([protocolVersion, ...nonce, dataId, dataLen, ...additionalData])
                  const hmacInputWA = CryptoJS.lib.WordArray.create(hmacInput)
                  const hmacFull = CryptoJS.HmacSHA256(hmacInputWA, ringKey)
                  const authHex = hmacFull.toString(CryptoJS.enc.Hex).slice(0, 16)
                  const authBytes: number[] = []
                  for (let i = 0; i < 16; i += 2) authBytes.push(parseInt(authHex.slice(i, i + 2), 16))

                  const ringPayload = [dataId, dataLen + 8, ...authBytes, ...additionalData]
                  console.log(`[FMDN Ring] Payload: ${ringPayload.map(b => b.toString(16).padStart(2, '0')).join(' ')}`)

                  sent = await tryWrite(FMDN_SVC, FMDN_CHAR, toBase64(ringPayload))
                  if (sent) console.log(`✅ [FMDN Ring] Ring autenticado enviado!`)
                }
              }
            } catch (e) {
              console.warn('[FMDN Ring] Auth ring failed:', (e as Error)?.message)
            }
          }

          // Fallback: ring sem auth (funciona em UTP mode)
          if (!sent) {
            const fakeAuth = [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
            const ringPayload = [0x05, 0x0C, ...fakeAuth, 0xFF, 0x00, 0x32, 0x03]
            sent = await tryWrite(FMDN_SVC, FMDN_CHAR, toBase64(ringPayload))
            if (sent) console.log(`✅ [BLE Beep] FMDN ring (sem auth) enviado`)
          }
        }
      }

      // ── 1. Apple Find My (FD44 / 4F860003) — protocolo FMNA oficial ──────
      if (!sent) {
        const FINDMY_SVC  = '0000fd44-0000-1000-8000-00805f9b34fb'
        const FINDMY_CHAR = '4f860003-943b-49ef-bed4-2f730304427a'
        const hasFd44 = svcList.some(u => u.toLowerCase().includes('fd44'))
        if (hasFd44) {
          console.log('[BLE Beep] Tentando Apple Find My (FD44)...')
          // Habilitar notificações primeiro (AirGuard faz isso antes do write)
          try {
            getBleManager().monitorCharacteristicForDevice(deviceId, FINDMY_SVC, FINDMY_CHAR, () => {})
            await new Promise(r => setTimeout(r, 300))
          } catch { /* notificações opcionais */ }
          // Forçar write-with-response (FMNA exige)
          try {
            await getBleManager().writeCharacteristicWithResponseForDevice(
              deviceId, FINDMY_SVC, FINDMY_CHAR, toBase64([0x01, 0x00, 0x03]))
            console.log('✅ [BLE Beep] FMNA sound (write-with-response) OK!')
            sent = true
            setTimeout(() => {
              getBleManager().writeCharacteristicWithResponseForDevice(
                deviceId, FINDMY_SVC, FINDMY_CHAR, toBase64([0x01, 0x01, 0x03])).catch(() => {})
            }, 5000)
          } catch (e) {
            console.warn('[BLE Beep] FMNA write-with-response failed:', (e as Error)?.message)
            // Fallback: write-without-response
            sent = await tryWrite(FINDMY_SVC, FINDMY_CHAR, toBase64([0x01, 0x00, 0x03]))
          }
        }
      }

      // ── 1b. Apple AirTag sound service (7DFC9000 / 0xAF) ──────────────
      if (!sent) {
        const AIRTAG_SVC  = '7dfc9000-7d1c-4951-86aa-8d9728f8d66c'
        const AIRTAG_CHAR = '7dfc9001-7d1c-4951-86aa-8d9728f8d66c'
        // Also try 7dfc8000 variant
        const AIRTAG_SVC2 = '7dfc8000-7d1c-4951-86aa-8d9728f8d66c'
        const AIRTAG_CHAR2 = '7dfc8001-7d1c-4951-86aa-8d9728f8d66c'
        const hasAirtag = svcList.some(u => u.includes('7dfc'))
        if (hasAirtag) {
          console.log('[BLE Beep] Tentando Apple AirTag sound (7DFC)...')
          sent = await tryWrite(AIRTAG_SVC, AIRTAG_CHAR, toBase64([0xAF]))
            || await tryWrite(AIRTAG_SVC2, AIRTAG_CHAR2, toBase64([0xAF]))
            || await tryWrite(AIRTAG_SVC2, AIRTAG_CHAR, toBase64([0xAF]))
          if (sent) console.log('✅ [BLE Beep] AirTag sound OK!')
        }
      }

      // ── 2. Apple Continuity / Nearby — clones chineses Find My ────────────
      // Alguns clones expõem d0611e78 (Continuity) e 9fa480e0 (Nearby) em vez de fd44.
      // Tentamos os mesmos opcodes FMNA + variantes simples nessas characteristics.
      if (!sent) {
        const CONT_SVC  = 'd0611e78-bbb4-4591-a5f8-487910ae4366'
        const CONT_CHAR = '8667556c-9a37-4c91-84ed-54ee27d90049'
        const NEAR_SVC  = '9fa480e0-4967-4542-9390-d343dc5d04ae'
        const NEAR_CHAR = 'af0badb1-5b99-43cd-917a-a77bc549e3cc'
        const payloads  = [
          [0x01, 0x00, 0x03], // FMNA start sound
          [0x01, 0x01, 0x03], // FMNA stop (some use as toggle)
          [0x08],             // opcode 0x08 play sound (FMNA variant)
          [0x0E],             // opcode 0x0E
          [0x01, 0x0E],
          [0x01],
          [0xFF],
        ]
        for (const p of payloads) {
          sent = await tryWrite(CONT_SVC, CONT_CHAR, toBase64(p))
          if (sent) { console.log(`✅ [BLE Beep] Continuity OK payload=${p.map(b => b.toString(16)).join(' ')}`); break }
        }
        if (!sent) {
          for (const p of payloads) {
            sent = await tryWrite(NEAR_SVC, NEAR_CHAR, toBase64(p))
            if (sent) { console.log(`✅ [BLE Beep] Nearby OK payload=${p.map(b => b.toString(16)).join(' ')}`); break }
          }
        }
      }

      // ── 2. Immediate Alert (BLE padrão) ───────────────────────────────────
      if (!sent) {
        sent = await tryWrite(
          '00001802-0000-1000-8000-00805f9b34fb',
          '00002a06-0000-1000-8000-00805f9b34fb',
          toBase64([0x02]), // HIGH ALERT
        )
        if (!sent) sent = await tryWrite(
          '00001802-0000-1000-8000-00805f9b34fb',
          '00002a06-0000-1000-8000-00805f9b34fb',
          toBase64([0x01]), // MILD ALERT
        )
      }

      // ── 3. iTAG / trackers genéricos FFE0 ────────────────────────────────
      if (!sent) {
        const FFE0_SVC  = '0000ffe0-0000-1000-8000-00805f9b34fb'
        const FFE1_CHAR = '0000ffe1-0000-1000-8000-00805f9b34fb'
        sent = await tryWrite(FFE0_SVC, FFE1_CHAR, toBase64([0x01]))
          || await tryWrite(FFE0_SVC, FFE1_CHAR, toBase64([0x02]))
          || await tryWrite(FFE0_SVC, FFE1_CHAR, toBase64([0xFF]))
      }

      // ── 4. Variante FFD0 ──────────────────────────────────────────────────
      if (!sent) {
        const FFD0_SVC  = '0000ffd0-0000-1000-8000-00805f9b34fb'
        const FFD1_CHAR = '0000ffd1-0000-1000-8000-00805f9b34fb'
        sent = await tryWrite(FFD0_SVC, FFD1_CHAR, toBase64([0x01]))
          || await tryWrite(FFD0_SVC, FFD1_CHAR, toBase64([0x02]))
      }

      // ── 5. Tuya BLE (0xFE2C) ─────────────────────────────────────────────
      if (!sent) {
        const TUYA_SVC    = '0000fe2c-0000-1000-8000-00805f9b34fb'
        const WRITE_CHAR  = 'fe2c1234-8366-4814-8eb0-01de32100bea'
        const WRITE2_CHAR = 'fe2c1236-8366-4814-8eb0-01de32100bea'
        const PAIR_PKT    = buildTuyaFrame(0x02, [])
        await tryWrite(TUYA_SVC, WRITE_CHAR, PAIR_PKT)
        await new Promise(r => setTimeout(r, 400))
        for (const dp of [1, 13, 29, 108, 15, 21]) {
          const pkt = buildTuyaFrame(0x06, [dp, 0x01, 0x00, 0x01, 0x01])
          sent = await tryWrite(TUYA_SVC, WRITE_CHAR, pkt)
            || await tryWrite(TUYA_SVC, WRITE2_CHAR, pkt)
          if (sent) break
        }
      }

      // ── 6. FD50 / AE00 / outros trackers chineses ─────────────────────────
      if (!sent) {
        for (const [svc, chr] of [
          ['0000fd50-0000-1000-8000-00805f9b34fb', '0000fd51-0000-1000-8000-00805f9b34fb'],
          ['0000ae00-0000-1000-8000-00805f9b34fb', '0000ae01-0000-1000-8000-00805f9b34fb'],
          ['15190001-12f4-c226-88ed-2ac5579f2a85', '8e0c0001-1d68-fb92-bf61-48377421680e'],
        ]) {
          sent = await tryWrite(svc, chr, toBase64([0x01]))
            || await tryWrite(svc, chr, toBase64([0xFF]))
          if (sent) break
        }
      }

      // ── 7. Nordic UART (NUS) — 6E40... ────────────────────────────────────
      if (!sent) {
        const NUS_SVC   = '6e400001-b5a3-f393-e0a9-e50e24dcca9e'
        const NUS_WRITE = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'
        sent = await tryWrite(NUS_SVC, NUS_WRITE, toBase64([0x01]))
          || await tryWrite(NUS_SVC, NUS_WRITE, toBase64([0x41, 0x4C, 0x45, 0x52, 0x54])) // "ALERT"
      }

      // ── 8. Tenta WRITE em qualquer char writable que não seja de config ────
      if (!sent) {
        console.log('[BLE Beep] Tentando write genérico em todas as characteristics writáveis...')
        outer: for (const svc of services) {
          const chars = await svc.characteristics()
          for (const c of chars) {
            if ((c.isWritableWithResponse || c.isWritableWithoutResponse) && !c.isReadable) {
              sent = await tryWrite(svc.uuid, c.uuid, toBase64([0x01]))
              if (sent) { console.log(`✅ [BLE Beep] Generic write OK: ${svc.uuid} / ${c.uuid}`); break outer }
            }
          }
        }
      }

      if (!sent) console.warn('[BLE Beep] Nenhum protocolo funcionou — verifique os serviços no log acima')

      setTimeout(() => getBleManager().cancelDeviceConnection(deviceId).catch(() => {}), 4000)
      return sent
    } catch (err) {
      console.warn('[BLE Beep] Tracker não suporta beep:', (err as Error)?.message ?? err)
      getBleManager().cancelDeviceConnection(deviceId).catch(() => {})
      return false
    }
  },

  /**
   * Connect to a BLE device, read its stable hardware identifier via GATT, disconnect.
   * Tries (in order):
   *   1. Device Information Service 0x180A → Serial Number 0x2A25
   *   2. Device Information Service 0x180A → Hardware Revision 0x2A27
   *   3. Generic Access 0x1800 → Device Name 0x2A00
   * Returns the decoded string, or null if none readable.
   */
  async readStableId(deviceId: string): Promise<string | null> {
    const DIS_SVC     = '0000180a-0000-1000-8000-00805f9b34fb'
    const SERIAL_CHAR = '00002a25-0000-1000-8000-00805f9b34fb'
    const HW_CHAR     = '00002a27-0000-1000-8000-00805f9b34fb'
    const GA_SVC      = '00001800-0000-1000-8000-00805f9b34fb'
    const NAME_CHAR   = '00002a00-0000-1000-8000-00805f9b34fb'

    const decode = (b64: string | null): string | null => {
      if (!b64) return null
      try {
        const str = atob(b64).trim()
        if (str.length < 2) return null
        return str
      } catch { return null }
    }

    try {
      console.log(`[GATT] Conectando a ${deviceId} para ler ID estável...`)
      const device = await getBleManager().connectToDevice(deviceId, { timeout: 10000, refreshGatt: 'OnConnected' })
      await device.discoverAllServicesAndCharacteristics()

      const candidates: [string, string][] = [
        [DIS_SVC, SERIAL_CHAR],
        [DIS_SVC, HW_CHAR],
        [GA_SVC,  NAME_CHAR],
      ]

      let stableId: string | null = null
      for (const [svc, chr] of candidates) {
        try {
          const c = await getBleManager().readCharacteristicForDevice(deviceId, svc, chr)
          const val = decode(c.value)
          if (val) { stableId = val; break }
        } catch { /* try next */ }
      }

      await getBleManager().cancelDeviceConnection(deviceId).catch(() => {})
      console.log(`[GATT] ID estável: ${stableId ?? 'não encontrado'}`)
      return stableId
    } catch (err) {
      console.warn('[GATT] readStableId:', (err as Error)?.message ?? err)
      await getBleManager().cancelDeviceConnection(deviceId).catch(() => {})
      return null
    }
  },

  // Inspecionar todos os serviços e características do dispositivo
  async inspectDevice(deviceId: string): Promise<{ services: { uuid: string; characteristics: string[] }[] } | null> {
    try {
      console.log(`🔍 Inspecionando: ${deviceId}`)
      const device = await getBleManager().connectToDevice(deviceId, { timeout: 10000, refreshGatt: 'OnConnected' })
      await device.discoverAllServicesAndCharacteristics()

      const services = await device.services()
      const result: { uuid: string; characteristics: string[] }[] = []

      for (const service of services) {
        const chars = await service.characteristics()
        result.push({
          uuid: service.uuid,
          characteristics: chars.map(c => c.uuid),
        })
      }

      console.log(`✅ Serviços encontrados:`, JSON.stringify(result, null, 2))

      // Desconecta após inspeção
      await getBleManager().cancelDeviceConnection(deviceId).catch(() => {})

      return { services: result }
    } catch (err) {
      console.error('❌ inspectDevice error:', err)
      await getBleManager().cancelDeviceConnection(deviceId).catch(() => {})
      return null
    }
  },

  // Emitir beep via Immediate Alert Service (BLE padrão — 0x1802 / 0x2A06)
  async playSound(deviceId: string): Promise<boolean> {
    // MokoSmart M1P protocol (BXP-S firmware)
    // Service: 0000AA00, Params char: 0000AA01, Password char: 0000AA04
    const MOKO_SVC = '0000aa00-0000-1000-8000-00805f9b34fb'
    const MOKO_PARAMS = '0000aa01-0000-1000-8000-00805f9b34fb'
    const MOKO_PASSWORD = '0000aa04-0000-1000-8000-00805f9b34fb'

    const mgr = new BleManager()
    try {
      console.log(`🔔 [Ring] Connecting to ${deviceId}...`)
      const device = await mgr.connectToDevice(deviceId, { timeout: 10000, refreshGatt: 'OnConnected' })
      await device.discoverAllServicesAndCharacteristics()

      const services = await device.services()
      const svcUuids = services.map(s => s.uuid.toLowerCase())
      console.log(`🔔 [Ring] Services: ${svcUuids.join(', ')}`)

      const hasMoko = svcUuids.some(u => u.includes('aa00'))

      if (hasMoko) {
        // MokoSmart M1P — use their protocol
        // Try password first (default: moko4321)
        try {
          const pwBytes = [0xEA, 0x01, 0x51, 0x08]
          const pw = 'moko4321'
          for (let i = 0; i < pw.length; i++) pwBytes.push(pw.charCodeAt(i))
          const pwB64 = btoa(String.fromCharCode(...pwBytes))
          await mgr.writeCharacteristicWithResponseForDevice(deviceId, MOKO_SVC, MOKO_PASSWORD, pwB64)
          console.log('🔔 [Ring] Password sent')
          await new Promise(r => setTimeout(r, 500))
        } catch (e) {
          console.warn('🔔 [Ring] Password write failed (may not be required):', (e as Error)?.message)
        }

        // LED Remote Reminder: 0xEA 0x01 0x61 0x05 0x03 interval(2) time(2)
        // interval=500ms (0x01F4), time=30 (=3 seconds, 0x001E)
        const ledCmd = [0xEA, 0x01, 0x61, 0x05, 0x03, 0x01, 0xF4, 0x00, 0x1E]
        const ledB64 = btoa(String.fromCharCode(...ledCmd))
        try {
          await mgr.writeCharacteristicWithResponseForDevice(deviceId, MOKO_SVC, MOKO_PARAMS, ledB64)
          console.log('✅ [Ring] LED reminder sent!')
        } catch (e) {
          console.warn('🔔 [Ring] LED write failed:', (e as Error)?.message)
        }

        // Buzzer Remote Reminder: 0xEA 0x01 0x62 0x05 0x0E interval(2) time(2)
        // interval=500ms (0x01F4), time=30 (=3 seconds, 0x001E)
        const buzzerCmd = [0xEA, 0x01, 0x62, 0x05, 0x0E, 0x01, 0xF4, 0x00, 0x1E]
        const buzzerB64 = btoa(String.fromCharCode(...buzzerCmd))
        try {
          await mgr.writeCharacteristicWithResponseForDevice(deviceId, MOKO_SVC, MOKO_PARAMS, buzzerB64)
          console.log('✅ [Ring] Buzzer reminder sent!')
        } catch (e) {
          console.warn('🔔 [Ring] Buzzer write failed:', (e as Error)?.message)
        }

        setTimeout(() => {
          mgr.cancelDeviceConnection(deviceId).catch(() => {})
          mgr.destroy()
        }, 5000)
        return true
      }

      // Fallback: Immediate Alert (0x1802) for other trackers
      const ALERT_SVC = '00001802-0000-1000-8000-00805f9b34fb'
      const ALERT_CHAR = '00002a06-0000-1000-8000-00805f9b34fb'
      try {
        await mgr.writeCharacteristicWithoutResponseForDevice(deviceId, ALERT_SVC, ALERT_CHAR, 'Ag==')
        console.log('✅ [Ring] Immediate Alert sent')
        setTimeout(() => { mgr.cancelDeviceConnection(deviceId).catch(() => {}); mgr.destroy() }, 3000)
        return true
      } catch {
        console.warn('🔔 [Ring] No supported ring protocol found')
        mgr.cancelDeviceConnection(deviceId).catch(() => {})
        mgr.destroy()
        return false
      }
    } catch (err) {
      console.warn('[playSound] Connection failed:', (err as Error)?.message ?? err)
      mgr.cancelDeviceConnection(deviceId).catch(() => {})
      mgr.destroy()
      return false
    }
  },

  // Parar beep (escreve 0x00)
  async stopSound(deviceId: string): Promise<void> {
    const ALERT_SERVICE = '00001802-0000-1000-8000-00805f9b34fb'
    const ALERT_CHAR    = '00002a06-0000-1000-8000-00805f9b34fb'
    const NO_ALERT_B64  = 'AA==' // 0x00 em base64
    try {
      await getBleManager().writeCharacteristicWithoutResponseForDevice(
        deviceId, ALERT_SERVICE, ALERT_CHAR, NO_ALERT_B64,
      )
    } catch { /* ignora */ }
  },

  // Cleanup
  async destroy(): Promise<void> {
    try {
      await getBleManager().destroy()
    } catch (err) {
      console.error('❌ Destroy error:', err)
    }
  },
}
