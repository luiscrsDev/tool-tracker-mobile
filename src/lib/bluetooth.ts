import { BleManager } from 'react-native-ble-plx'
import { PermissionsAndroid, Platform } from 'react-native'
import CryptoJS from 'crypto-js'

let bleManager: BleManager | null = null

function getBleManager(): BleManager {
  if (!bleManager) {
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
          console.log(`📱 Device encontrado: ${device.name || 'Anonymous'} (${device.id}) - RSSI: ${device.rssi}`)
          onDeviceFound({
            id: device.id,
            name: device.name || 'Anonymous',
            rssi: device.rssi || 0,
            manufacturerData: device.manufacturerData,
            serviceUUIDs: device.serviceUUIDs,
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
      const device = await getBleManager().connectToDevice(deviceId, { timeout: 10000 })
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
    const FMDN_SVC        = '0000fe2c-0000-1000-8000-00805f9b34fb'
    const BEACON_ACTIONS   = 'fe2c1238-8366-4814-8eb0-01de32100bea'

    const tryWrite = async (svc: string, char: string, b64: string): Promise<boolean> => {
      try {
        await getBleManager().writeCharacteristicWithResponseForDevice(deviceId, svc, char, b64)
        return true
      } catch {
        try {
          await getBleManager().writeCharacteristicWithoutResponseForDevice(deviceId, svc, char, b64)
          return true
        } catch { return false }
      }
    }

    try {
      console.log(`[FMDN] Provisioning EIK for ${deviceId}...`)
      const device = await getBleManager().connectToDevice(deviceId, { timeout: 10000 })
      await device.discoverAllServicesAndCharacteristics()

      // Log all discovered services for debugging
      const services = await device.services()
      const svcUuids = services.map(s => s.uuid)
      console.log(`[FMDN] Discovered services: ${svcUuids.join(', ')}`)

      // Build candidate service list: known FMDN UUID first, then all discovered
      const candidateSvcs = [FMDN_SVC, ...svcUuids.filter(u => u !== FMDN_SVC)]

      // Generate random 32-byte EIK
      const eikBytes: number[] = []
      for (let i = 0; i < 32; i++) eikBytes.push(Math.floor(Math.random() * 256))
      const eikB64 = this._toBase64(eikBytes)

      // Step 1: Try reading nonce from Beacon Actions (confirms characteristic exists)
      let nonceRead = false
      let usedSvc: string | null = null
      for (const svc of candidateSvcs) {
        try {
          const readResult = await getBleManager().readCharacteristicForDevice(deviceId, svc, BEACON_ACTIONS)
          if (readResult.value) {
            const raw = this._fromBase64(readResult.value)
            if (raw.length >= 9) {
              console.log(`✅ [FMDN] Nonce read OK from service ${svc}: ${raw.slice(1, 9).map(b => b.toString(16).padStart(2, '0')).join(' ')}`)
              nonceRead = true
              usedSvc = svc
              break
            }
          }
        } catch { /* try next service */ }
      }

      if (!nonceRead) {
        console.warn('[FMDN] Could not read nonce from any service — Beacon Actions not accessible')
        // Still try writing blindly
        usedSvc = FMDN_SVC
      }

      // Step 2: Clear existing EIK (Data ID 0x03)
      const clearOk = await tryWrite(usedSvc!, BEACON_ACTIONS, this._toBase64([0x03, 0x00]))
      if (clearOk) {
        console.log('[FMDN] Clear EIK sent')
        await new Promise(r => setTimeout(r, 500))
      }

      // Step 3: Set new EIK (Data ID 0x02, 32 bytes)
      const setEikPayload = this._toBase64([0x02, 0x20, ...eikBytes])
      const writeOk = await tryWrite(usedSvc!, BEACON_ACTIONS, setEikPayload)

      if (writeOk) {
        console.log(`✅ [FMDN] EIK provisioned via service ${usedSvc}`)
        await getBleManager().cancelDeviceConnection(deviceId).catch(() => {})
        return eikB64
      }

      // Step 4: Fallback — try every discovered service
      for (const svc of svcUuids) {
        if (svc === usedSvc) continue
        const ok = await tryWrite(svc, BEACON_ACTIONS, setEikPayload)
        if (ok) {
          console.log(`✅ [FMDN] EIK provisioned via fallback service ${svc}`)
          await getBleManager().cancelDeviceConnection(deviceId).catch(() => {})
          return eikB64
        }
      }

      console.warn('[FMDN] EIK write failed on all services')
      await getBleManager().cancelDeviceConnection(deviceId).catch(() => {})
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
      const device = await getBleManager().connectToDevice(deviceId, { timeout: 10000 })
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

  // Beep — tenta múltiplos protocolos de trackers BLE (Tuya, iTAG, NUS, Immediate Alert)
  async playTuyaSound(deviceId: string): Promise<boolean> {
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
      console.log(`🔔 [BLE Beep] Conectando: ${deviceId}`)
      const device = await getBleManager().connectToDevice(deviceId, { timeout: 10000 })
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
      // Characteristic: FE2C1238-8366-4814-8EB0-01DE32100BEA
      // Ring = Data ID 0x05, auth 8 bytes (arbitrary if UTP mode), ring_all=0xFF, timeout 50 deciseconds, volume high
      if (!sent) {
        const FMDN_CHAR = 'fe2c1238-8366-4814-8eb0-01de32100bea'
        // Try each service that might host the FMDN beacon actions characteristic
        const candidateSvcs = [
          '0000feaa-0000-1000-8000-00805f9b34fb',  // FEAA (Eddystone/FMDN)
          ...svcList, // try all discovered services
        ]
        const fakeAuth = [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00] // arbitrary auth (works in UTP mode)
        const ringPayload = [
          0x05,       // Data ID = Ring
          0x0C,       // Data length = 12
          ...fakeAuth, // 8 bytes auth (arbitrary)
          0xFF,       // Ring all components
          0x00, 0x32, // Timeout = 50 deciseconds (5 sec)
          0x03,       // Volume = high
        ]
        for (const svc of candidateSvcs) {
          sent = await tryWrite(svc, FMDN_CHAR, toBase64(ringPayload))
          if (sent) {
            console.log(`✅ [BLE Beep] FMDN ring sent via service ${svc}`)
            break
          }
        }
      }

      // ── 1. Apple Find My (FD44 / 4F860003) — protocolo FMNA oficial ──────
      // Fonte: AirGuard (seemoo-lab) — AppleFindMy.kt
      if (!sent) {
        const FINDMY_SVC  = '0000fd44-0000-1000-8000-00805f9b34fb'
        const FINDMY_CHAR = '4f860003-943b-49ef-bed4-2f730304427a'
        const hasFd44 = svcList.some(u => u.toLowerCase().includes('fd44'))
        if (hasFd44) {
          console.log('[BLE Beep] Tentando Apple Find My (FD44)...')
          sent = await tryWrite(FINDMY_SVC, FINDMY_CHAR, toBase64([0x01, 0x00, 0x03]))
          if (sent) {
            setTimeout(() => tryWrite(FINDMY_SVC, FINDMY_CHAR, toBase64([0x01, 0x01, 0x03])).catch(() => {}), 5000)
          }
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
      const device = await getBleManager().connectToDevice(deviceId, { timeout: 10000 })
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
      const device = await getBleManager().connectToDevice(deviceId, { timeout: 10000 })
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
    const ALERT_SERVICE  = '00001802-0000-1000-8000-00805f9b34fb'
    const ALERT_CHAR     = '00002a06-0000-1000-8000-00805f9b34fb'
    const HIGH_ALERT_B64 = 'Ag==' // 0x02 em base64

    try {
      console.log(`🔔 Conectando para beep: ${deviceId}`)
      const device = await getBleManager().connectToDevice(deviceId, { timeout: 8000 })
      await device.discoverAllServicesAndCharacteristics()

      // Tenta sem resposta primeiro (mais rápido)
      try {
        await getBleManager().writeCharacteristicWithoutResponseForDevice(
          deviceId, ALERT_SERVICE, ALERT_CHAR, HIGH_ALERT_B64,
        )
      } catch {
        // Fallback: com resposta
        await getBleManager().writeCharacteristicWithResponseForDevice(
          deviceId, ALERT_SERVICE, ALERT_CHAR, HIGH_ALERT_B64,
        )
      }

      console.log(`✅ Beep enviado para ${deviceId}`)

      // Desconecta após 3 s (tempo do beep)
      setTimeout(() => {
        getBleManager().cancelDeviceConnection(deviceId).catch(() => {})
      }, 3000)

      return true
    } catch (err) {
      console.warn('[playSound] Tracker não suporta Immediate Alert:', (err as Error)?.message ?? err)
      getBleManager().cancelDeviceConnection(deviceId).catch(() => {})
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
