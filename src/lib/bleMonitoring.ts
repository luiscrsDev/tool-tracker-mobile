/**
 * BLE Monitoring — event-driven approach
 *
 * Instead of a GPS timer that scans BLE, this module runs a
 * continuous BLE scan. When a known tracker is detected, it
 * fetches the current GPS and saves to Supabase.
 *
 * Flow:
 *   BLE advertisement detected → GPS lookup → save (throttled 5min/tracker)
 */

import { BleManager } from 'react-native-ble-plx'
import * as Location from 'expo-location'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { processDetection } from './movementEngine'

// Find Easy service UUID — usado para filtrar o scan no iOS background
// (iOS só permite BLE em background com Service UUID específico)
const FIND_EASY_SERVICE_UUID = '0000fe2c-0000-1000-8000-00805f9b34fb'

export interface MonitoredTool {
  toolId: string
  toolName: string
  contractorId: string
}

export interface DetectionResult {
  toolId: string
  latitude: number
  longitude: number
  accuracy: number | null
  timestamp: string
}

// Callback registered by LocationContext to update UI on beacon detection
let onDetectionCallback: ((result: DetectionResult) => void) | null = null

export function setOnDetectionCallback(cb: ((result: DetectionResult) => void) | null): void {
  onDetectionCallback = cb
}

// tagId (BLE MAC) → tool info
const monitoredTrackers = new Map<string, MonitoredTool>()

// tagId → last save timestamp (throttle)
const lastSaved = new Map<string, number>()

// toolId → last BLE detection timestamp (persisted, used by background task)
const BLE_LAST_SEEN_KEY = 'ble_last_seen'
let bleLastSeen = new Map<string, number>()

async function persistBleLastSeen() {
  const obj: Record<string, number> = {}
  bleLastSeen.forEach((v, k) => { obj[k] = v })
  await AsyncStorage.setItem(BLE_LAST_SEEN_KEY, JSON.stringify(obj)).catch(() => {})
}

export async function getBleLastSeen(): Promise<Map<string, number>> {
  try {
    const raw = await AsyncStorage.getItem(BLE_LAST_SEEN_KEY)
    if (raw) {
      const obj = JSON.parse(raw) as Record<string, number>
      return new Map(Object.entries(obj))
    }
  } catch { /* ignore */ }
  return new Map()
}

const MIN_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes per tracker
const BLE_VALIDITY_MS = 30 * 60 * 1000 // 30 min — BLE detection considered valid for background tracking

let manager: BleManager | null = null
let isScanning = false

// ─── Quick BLE scan (for background GPS callbacks) ───────────────────────────

/**
 * Perform a short BLE scan (5s) and return tool IDs of detected known trackers.
 * Designed to be called from the background GPS task every 2 min.
 * Updates bleLastSeen so background tracking stays valid.
 */
export async function quickBleScan(): Promise<string[]> {
  const detected = new Set<string>()
  let scanMgr: BleManager | null = null

  try {
    scanMgr = manager ?? new BleManager()
    const state = await scanMgr.state()
    if (state !== 'PoweredOn') {
      console.log('[BLE QuickScan] Bluetooth not powered on')
      return []
    }

    await new Promise<void>((resolve) => {
      scanMgr!.startDeviceScan(null, { allowDuplicates: false }, (error, device) => {
        if (error || !device?.id) return

        // Check by device ID (MAC)
        let tool = monitoredTrackers.get(device.id)

        // Fallback: match by manufacturer data (for Apple Find My)
        if (!tool && device.manufacturerData) {
          for (const [key, t] of monitoredTrackers.entries()) {
            if (key === device.manufacturerData) {
              tool = t
              break
            }
          }
        }

        if (tool) {
          detected.add(tool.toolId)
          bleLastSeen.set(tool.toolId, Date.now())
          console.log(`[BLE QuickScan] 📡 ${tool.toolName}`)
        }
      })

      // Stop after 5 seconds
      setTimeout(() => {
        try { scanMgr?.stopDeviceScan() } catch { /* ignore */ }
        resolve()
      }, 5000)
    })

    if (detected.size > 0) {
      persistBleLastSeen()
      console.log(`[BLE QuickScan] ✅ ${detected.size} tag(s) detected`)
    } else {
      console.log('[BLE QuickScan] No known tags found')
    }
  } catch (err) {
    console.warn('[BLE QuickScan] Error:', (err as Error)?.message)
  }

  return Array.from(detected)
}

// ─── Internal save ────────────────────────────────────────────────────────────

async function saveDetection(tagId: string, tool: MonitoredTool): Promise<void> {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) return

  try {
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    })

    const { latitude, longitude, accuracy, altitude, heading, speed } = pos.coords
    const timestamp = new Date(pos.timestamp).toISOString()

    // Skip unreliable GPS (accuracy > 50m = indoor/bad signal)
    if (accuracy && accuracy > 50) {
      console.log(`[BLE Monitor] GPS accuracy too low (${accuracy.toFixed(0)}m) — skipping save`)
      return
    }

    // Update last_seen_location (only with good GPS)
    await fetch(`${supabaseUrl}/rest/v1/tools?id=eq.${tool.toolId}`, {
      method: 'PATCH',
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        last_seen_location: { latitude, longitude, accuracy, timestamp },
      }),
    })

    // Save to location_history
    await fetch(`${supabaseUrl}/rest/v1/location_history`, {
      method: 'POST',
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        tool_id: tool.toolId,
        contractor_id: tool.contractorId || null,
        latitude,
        longitude,
        accuracy,
        altitude,
        heading,
        speed,
        timestamp,
        detection_method: 'ble_beacon',
      }),
    })

    lastSaved.set(tagId, Date.now())
    // Persist BLE detection time for background GPS task
    bleLastSeen.set(tool.toolId, Date.now())
    persistBleLastSeen()
    console.log(`[BLE Monitor] ✅ ${tool.toolName} (${tagId}) → ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`)
    onDetectionCallback?.({ toolId: tool.toolId, latitude, longitude, accuracy: accuracy ?? null, timestamp })

    // NOTE: Movement tracking (processDetection) is handled by the native
    // BleTrackingService in Kotlin. Do NOT call processDetection here to
    // avoid duplicate records with wrong timestamps.
  } catch (err) {
    console.error(`[BLE Monitor] ❌ Erro ao salvar ${tool.toolId}:`, err)
  }
}

// ─── Scan callback ────────────────────────────────────────────────────────────

function onDeviceFound(deviceId: string, manufacturerData?: string): void {
  // Try by device ID (MAC) first — works for static-MAC trackers (e.g. TY)
  let tool = monitoredTrackers.get(deviceId)
  let resolvedKey = deviceId

  // Fallback: match by manufacturer data — needed for Apple Find My devices
  // that rotate their MAC address. tag_id was stored as mfr data during pairing.
  if (!tool && manufacturerData) {
    for (const [key, t] of monitoredTrackers.entries()) {
      if (key === manufacturerData) {
        tool = t
        resolvedKey = key
        // Cache current MAC → same tool, avoids repeated lookup within session
        monitoredTrackers.set(deviceId, t)
        console.log(`[BLE Monitor] 🔄 MAC atualizado: ${deviceId} → ${t.toolName}`)
        break
      }
    }
  }

  if (!tool) return

  const now = Date.now()
  const last = lastSaved.get(deviceId) ?? 0
  if (now - last < MIN_INTERVAL_MS) return // throttled

  // Mark immediately to prevent concurrent saves
  lastSaved.set(deviceId, now)
  console.log(`[BLE Monitor] 📡 Beacon detectado: ${deviceId} (${tool.toolName})`)

  saveDetection(deviceId, tool).catch(err => {
    // Reset throttle on failure so next detection retries
    lastSaved.set(deviceId, last)
    console.error(`[BLE Monitor] saveDetection failed:`, err)
  })
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Register a tracker to monitor. Starts scanning if not already running. */
export function addTrackerToMonitor(tagId: string, tool: MonitoredTool): void {
  monitoredTrackers.set(tagId, tool)
  console.log(`[BLE Monitor] Adicionado: ${tagId} → ${tool.toolName}`)
  if (!isScanning) {
    startMonitoring()
  }
}

/** Remove a tracker. Stops scanning if no trackers remain. */
export function removeTrackerFromMonitor(tagId: string): void {
  monitoredTrackers.delete(tagId)
  lastSaved.delete(tagId)
  console.log(`[BLE Monitor] Removido: ${tagId}`)
  if (monitoredTrackers.size === 0) {
    stopMonitoring()
  }
}

/** Replace the entire monitored set (used on app restore). */
export function setMonitoredTrackers(entries: Array<{ tagId: string; tool: MonitoredTool }>): void {
  monitoredTrackers.clear()
  entries.forEach(({ tagId, tool }) => monitoredTrackers.set(tagId, tool))
  console.log(`[BLE Monitor] Set com ${monitoredTrackers.size} trackers`)
  if (monitoredTrackers.size > 0 && !isScanning) {
    startMonitoring()
  } else if (monitoredTrackers.size === 0) {
    stopMonitoring()
  }
}

export function isMonitoring(): boolean { return isScanning }
export function startBleMonitoring(): void { startMonitoring() }
export function stopBleMonitoring(): void { stopMonitoring() }

function startMonitoring(): void {
  if (isScanning) return
  try {
    if (!manager) {
      manager = new BleManager()
    }
    // Filter by Find Easy service UUID so iOS allows scanning in background.
    // Android ignores this filter at the radio level but still receives all
    // advertisements — the UUID filter is applied in software on Android.
    manager.startDeviceScan(null, { allowDuplicates: true }, (error, device) => {
      if (error) {
        console.warn('[BLE Monitor] Scan error:', error.message)
        return
      }
      if (device?.id) {
        onDeviceFound(device.id, device.manufacturerData ?? undefined)
      }
    })
    isScanning = true
    console.log('[BLE Monitor] ✅ Scan contínuo iniciado (filtro Find Easy)')
  } catch (err) {
    console.error('[BLE Monitor] ❌ Falha ao iniciar scan:', err)
  }
}

function stopMonitoring(): void {
  if (!isScanning) return
  try {
    manager?.stopDeviceScan()
    isScanning = false
    console.log('[BLE Monitor] ⛔ Scan parado')
  } catch (err) {
    console.error('[BLE Monitor] ❌ Falha ao parar scan:', err)
  }
}

export function destroyBleMonitor(): void {
  stopMonitoring()
  try {
    manager?.destroy()
  } catch { /* ignore */ }
  manager = null
  monitoredTrackers.clear()
  lastSaved.clear()
}
