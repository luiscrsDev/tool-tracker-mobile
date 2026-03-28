import React, { createContext, useContext, useState, useCallback } from 'react'
import { BLEService, type BluetoothDevice } from '@/lib/bluetooth'

interface BluetoothContextType {
  devices: BluetoothDevice[]
  scanning: boolean
  connected: boolean
  error: Error | null
  startScanning: () => Promise<void>
  stopScanning: () => Promise<void>
  connectToDevice: (deviceId: string) => Promise<boolean>
  disconnectDevice: (deviceId: string) => Promise<void>
  playSound: (deviceId: string) => Promise<boolean>
  playTuyaSound: (deviceId: string) => Promise<boolean>
  ringFMDN: (deviceId: string, eikB64: string) => Promise<boolean>
  provisionEIK: (deviceId: string) => Promise<string | null>
  inspectDevice: (deviceId: string) => Promise<{ services: { uuid: string; characteristics: string[] }[] } | null>
  readStableId: (deviceId: string) => Promise<string | null>
  clearDevices: () => void
  selectedDevice: BluetoothDevice | null
  setSelectedDevice: (device: BluetoothDevice | null) => void
}

const BluetoothContext = createContext<BluetoothContextType | undefined>(undefined)

export function BluetoothProvider({ children }: { children: React.ReactNode }) {
  const [devices, setDevices] = useState<BluetoothDevice[]>([])
  const [scanning, setScanning] = useState(false)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [selectedDevice, setSelectedDevice] = useState<BluetoothDevice | null>(null)

  const startScanning = useCallback(async () => {
    try {
      setScanning(true)
      setError(null)
      setDevices([])

      await BLEService.startScanning(
        device => {
          setDevices(prev => {
            // For Apple Find My devices (mfr starts 4C00): both MAC and mfr data rotate,
            // so there is no stable dedup key. Strategy: keep only the strongest-RSSI
            // Apple entries up to a cap of 10, replacing the weakest when cap is exceeded.
            const isApple = (() => {
              if (!device.manufacturerData) return false
              try {
                const b = Uint8Array.from(atob(device.manufacturerData), c => c.charCodeAt(0))
                return b[0] === 0x4C && b[1] === 0x00
              } catch { return false }
            })()

            // Normal dedup by MAC
            const byMac = prev.findIndex(d => d.id === device.id)
            if (byMac !== -1) {
              return prev.map((d, i) => (i === byMac ? device : d))
            }

            if (isApple) {
              const appleEntries = prev.filter(d => {
                if (!d.manufacturerData) return false
                try {
                  const b = Uint8Array.from(atob(d.manufacturerData), c => c.charCodeAt(0))
                  return b[0] === 0x4C && b[1] === 0x00
                } catch { return false }
              })
              if (appleEntries.length >= 10) {
                // Replace the weakest Apple entry if new one is stronger
                const weakest = appleEntries.reduce((a, b) => (a.rssi < b.rssi ? a : b))
                if (device.rssi > weakest.rssi) {
                  return prev.map(d => d.id === weakest.id ? device : d)
                }
                return prev // list full and new device is weaker — discard
              }
            }

            return [...prev, device]
          })
        },
        err => {
          setError(err)
          setScanning(false)
        },
      )
    } catch (err) {
      const errorMsg = err instanceof Error ? err : new Error('Unknown error')
      setError(errorMsg)
      setScanning(false)
    }
  }, [])

  const stopScanning = useCallback(async () => {
    try {
      await BLEService.stopScanning()
      setScanning(false)
    } catch (err) {
      const errorMsg = err instanceof Error ? err : new Error('Unknown error')
      setError(errorMsg)
    }
  }, [])

  const connectToDevice = useCallback(async (deviceId: string) => {
    try {
      setError(null)
      const success = await BLEService.connectToDevice(deviceId)
      if (success) {
        await BLEService.discoverServices(deviceId)
        setConnected(true)
        const device = devices.find(d => d.id === deviceId)
        if (device) {
          setSelectedDevice(device)
        }
        console.log('✅ Device connected and ready')
      }
      return success
    } catch (err) {
      const errorMsg = err instanceof Error ? err : new Error('Unknown error')
      setError(errorMsg)
      return false
    }
  }, [devices])

  const disconnectDevice = useCallback(async (deviceId: string) => {
    try {
      setError(null)
      await BLEService.disconnectDevice(deviceId)
      setConnected(false)
      setSelectedDevice(null)
    } catch (err) {
      const errorMsg = err instanceof Error ? err : new Error('Unknown error')
      setError(errorMsg)
    }
  }, [])

  const playTuyaSound = useCallback(async (deviceId: string) => {
    setError(null)
    return BLEService.playTuyaSound(deviceId)
  }, [])

  const inspectDevice = useCallback(async (deviceId: string) => {
    setError(null)
    return BLEService.inspectDevice(deviceId)
  }, [])

  const readStableId = useCallback(async (deviceId: string) => {
    setError(null)
    return BLEService.readStableId(deviceId)
  }, [])

  const ringFMDN = useCallback(async (deviceId: string, eikB64: string) => {
    setError(null)
    return BLEService.ringFMDN(deviceId, eikB64)
  }, [])

  const provisionEIK = useCallback(async (deviceId: string) => {
    setError(null)
    return BLEService.provisionEIK(deviceId)
  }, [])

  const playSound = useCallback(async (deviceId: string) => {
    setError(null)
    return BLEService.playSound(deviceId)
  }, [])

  const clearDevices = useCallback(() => {
    setDevices([])
  }, [])

  return (
    <BluetoothContext.Provider
      value={{
        devices,
        scanning,
        connected,
        error,
        startScanning,
        stopScanning,
        connectToDevice,
        disconnectDevice,
        playSound,
        playTuyaSound,
        ringFMDN,
        provisionEIK,
        inspectDevice,
        readStableId,
        clearDevices,
        selectedDevice,
        setSelectedDevice,
      }}
    >
      {children}
    </BluetoothContext.Provider>
  )
}

export function useBluetooth() {
  const context = useContext(BluetoothContext)
  if (!context) {
    throw new Error('useBluetooth must be used within BluetoothProvider')
  }
  return context
}
