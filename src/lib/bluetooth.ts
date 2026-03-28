import { BleManager } from 'react-native-ble-plx'
import { PermissionsAndroid, Platform } from 'react-native'

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

  // Beep via protocolo Tuya BLE (serviço fe2c — Find Easy / trackers genéricos chineses)
  async playTuyaSound(deviceId: string): Promise<boolean> {
    const TUYA_SVC    = '0000fe2c-0000-1000-8000-00805f9b34fb'
    const WRITE_CHAR  = 'fe2c1234-8366-4814-8eb0-01de32100bea'   // write with response
    const WRITE2_CHAR = 'fe2c1236-8366-4814-8eb0-01de32100bea'   // write without response
    const NOTIFY_CHAR = 'fe2c1235-8366-4814-8eb0-01de32100bea'   // notify (responses)

    // Segundo serviço proprietário (alternativo)
    const ALT_SVC     = '15190001-12f4-c226-88ed-2ac5579f2a85'
    const ALT_CHAR    = '8e0c0001-1d68-fb92-bf61-48377421680e'

    const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

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
    const buildFrame = (cmd: number, data: number[]): string => {
      const bytes = [0x55, 0xAA, 0x00, 0x00, 0x00, cmd, 0x00, data.length, ...data]
      bytes.push(bytes.reduce((s, b) => s + b, 0) % 256)
      return toBase64(bytes)
    }

    // cmd 0x02 = pair/bind request (sem dados)
    const PAIR_PKT = buildFrame(0x02, [])

    // cmd 0x06 = write DP  — formato: [dpId][dpType=boolean][len=00 01][value=01]
    const alarmPackets = [1, 13, 29, 108, 15, 21].map(dp =>
      buildFrame(0x06, [dp, 0x01, 0x00, 0x01, 0x01]),
    )

    const tryWrite = async (svc: string, char: string, b64: string): Promise<boolean> => {
      try {
        await getBleManager().writeCharacteristicWithResponseForDevice(deviceId, svc, char, b64)
        return true
      } catch {
        try {
          await getBleManager().writeCharacteristicWithoutResponseForDevice(deviceId, svc, char, b64)
          return true
        } catch {
          return false
        }
      }
    }

    try {
      console.log(`🔔 [Tuya] Conectando: ${deviceId}`)
      const device = await getBleManager().connectToDevice(deviceId, { timeout: 10000 })
      await device.discoverAllServicesAndCharacteristics()

      // 1. Ativa notificações para receber respostas do dispositivo
      let notifSub: { remove: () => void } | null = null
      try {
        notifSub = getBleManager().monitorCharacteristicForDevice(
          deviceId, TUYA_SVC, NOTIFY_CHAR,
          (err, char) => {
            if (char?.value) console.log(`[Tuya] Resposta:`, char.value)
          },
        )
      } catch { /* notificações opcionais */ }

      // 2. Pair handshake (necessário em alguns dispositivos Tuya)
      console.log(`[Tuya] Enviando pair request...`)
      await tryWrite(TUYA_SVC, WRITE_CHAR, PAIR_PKT)
      await wait(600)

      // 3. Tenta cada DP de alarme
      let sent = false
      for (let i = 0; i < alarmPackets.length; i++) {
        const dpIds = [1, 13, 29, 108, 15, 21]
        console.log(`[Tuya] Tentando DP ${dpIds[i]}...`)
        const ok = await tryWrite(TUYA_SVC, WRITE_CHAR, alarmPackets[i])
          || await tryWrite(TUYA_SVC, WRITE2_CHAR, alarmPackets[i])
        if (ok) {
          console.log(`✅ [Tuya] DP ${dpIds[i]} enviado`)
          sent = true
          await wait(300) // aguarda resposta
          break
        }
      }

      // 4. Fallback: tenta o serviço alternativo com payload simples 0x01
      if (!sent) {
        console.log(`[Tuya] Tentando serviço alternativo...`)
        sent = await tryWrite(ALT_SVC, ALT_CHAR, toBase64([0x01]))
          || await tryWrite(ALT_SVC, ALT_CHAR, toBase64([0x01, 0x01]))
          || await tryWrite(ALT_SVC, ALT_CHAR, toBase64([0xFF]))
      }

      notifSub?.remove()
      setTimeout(() => getBleManager().cancelDeviceConnection(deviceId).catch(() => {}), 5000)
      return sent
    } catch (err) {
      console.error('❌ [Tuya] playTuyaSound error:', err)
      getBleManager().cancelDeviceConnection(deviceId).catch(() => {})
      return false
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
      console.error('❌ playSound error:', err)
      // Garante desconexão mesmo em erro
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
