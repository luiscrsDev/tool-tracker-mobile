import { requireNativeModule } from 'expo-modules-core'

interface FmdnResult {
  accountKey: string  // base64
  eik: string         // base64
}

const ExpoFmdn = requireNativeModule('ExpoFmdn')

/**
 * Check if a BLE device has the FMDN service (0xFE2C)
 */
export async function discoverFmdn(macAddress: string): Promise<boolean> {
  return ExpoFmdn.discoverFmdn(macAddress)
}

/**
 * Provision a tracker: writes account key + EIK to the device.
 * The tracker must be in pairing mode (factory reset / unprovisioned).
 * Returns { accountKey, eik } as base64 strings for storage.
 */
export async function provisionTracker(macAddress: string): Promise<FmdnResult | null> {
  try {
    return await ExpoFmdn.provisionTracker(macAddress)
  } catch {
    return null
  }
}

/**
 * Ring a provisioned tracker using stored EIK.
 * Plays sound for ~6 seconds at high volume.
 */
export async function ringTracker(macAddress: string, eikBase64: string): Promise<boolean> {
  try {
    return await ExpoFmdn.ringTracker(macAddress, eikBase64)
  } catch {
    return false
  }
}

/**
 * Stop ringing a tracker.
 */
export async function stopRing(macAddress: string, eikBase64: string): Promise<boolean> {
  try {
    return await ExpoFmdn.stopRing(macAddress, eikBase64)
  } catch {
    return false
  }
}
