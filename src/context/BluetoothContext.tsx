import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'
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
  playTuyaSound: (deviceId: string, eikB64?: string) => Promise<boolean>
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

  // Purge stale devices every 5s while scanning
  useEffect(() => {
    if (!scanning) return
    const interval = setInterval(() => {
      setDevices(prev => {
        const now = Date.now()
        return prev.filter(d => !((d as any)._lastSeen) || (now - (d as any)._lastSeen) < 6000)
      })
    }, 3000)
    return () => clearInterval(interval)
  }, [scanning])

  const startScanning = useCallback(async () => {
    try {
      setScanning(true)
      setError(null)
      setDevices([])

      await BLEService.startScanning(
        device => {
          setDevices(prev => {
            const now = Date.now()

            // Tag the device with a timestamp, preserve name if new ad has none
            const tagged = { ...device, _lastSeen: now }

            // Dedup by MAC — update existing entry, keep name if new one is Anonymous
            const byMac = prev.findIndex(d => d.id === device.id)
            if (byMac !== -1) {
              return prev.map((d, i) => {
                if (i !== byMac) return d
                const keepName = (!device.name || device.name === 'Anonymous') && d.name && d.name !== 'Anonymous'
                return { ...tagged, name: keepName ? d.name : tagged.name }
              })
            }

            // New MAC: if P23 (Fast Pair model ID) but no name, set "Find Easy"
            if ((tagged as any).isFastPairP23 && (!tagged.name || tagged.name === 'Anonymous')) {
              tagged.name = 'Find Easy'
            }

            return [...prev, tagged]
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

  const playTuyaSound = useCallback(async (deviceId: string, eikB64?: string) => {
    setError(null)
    return BLEService.playTuyaSound(deviceId, eikB64)
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
