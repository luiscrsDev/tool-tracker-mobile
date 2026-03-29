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
 * Bond with device at Android OS level.
 * This may enable write-with-response on protected GATT characteristics.
 */
export async function bondDevice(macAddress: string): Promise<boolean> {
  try {
    return await ExpoFmdn.bondDevice(macAddress)
  } catch {
    return false
  }
}

/**
 * Full GFPS Key-based Pairing: ECDH handshake → account key → EIK provision.
 * antiSpoofingPubKey: base64 of the 64-byte Anti-Spoofing Public Key (x||y)
 * Returns { accountKey, eik } or null.
 */
export async function gfpsPair(macAddress: string, antiSpoofingPubKey: string): Promise<FmdnResult | null> {
  try {
    return await ExpoFmdn.gfpsPair(macAddress, antiSpoofingPubKey)
  } catch (e) {
    console.warn('[GFPS] Pair failed:', (e as Error)?.message)
    return null
  }
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
