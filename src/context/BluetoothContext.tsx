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
  inspectDevice: (deviceId: string) => Promise<{ services: { uuid: string; characteristics: string[] }[] } | null>
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
            const exists = prev.some(d => d.id === device.id)
            if (exists) {
              return prev.map(d => (d.id === device.id ? device : d))
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
    const success = await BLEService.playTuyaSound(deviceId)
    if (!success) setError(new Error('Nenhum DP de alarme respondeu — verifique o console para detalhes'))
    return success
  }, [])

  const inspectDevice = useCallback(async (deviceId: string) => {
    setError(null)
    return BLEService.inspectDevice(deviceId)
  }, [])

  const playSound = useCallback(async (deviceId: string) => {
    setError(null)
    const success = await BLEService.playSound(deviceId)
    if (!success) setError(new Error('Não foi possível enviar beep — dispositivo não suporta Immediate Alert'))
    return success
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
        inspectDevice,
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
