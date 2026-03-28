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

// Find Easy service UUID — usado para filtrar o scan no iOS background
// (iOS só permite BLE em background com Service UUID específico)
const FIND_EASY_SERVICE_UUID = '0000fe2c-0000-1000-8000-00805f9b34fb'

export interface MonitoredTool {
  toolId: string
  toolName: string
  contractorId: string
}

// tagId (BLE MAC) → tool info
const monitoredTrackers = new Map<string, MonitoredTool>()

// tagId → last save timestamp (throttle)
const lastSaved = new Map<string, number>()

const MIN_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes per tracker

let manager: BleManager | null = null
let isScanning = false

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

    // Update last_seen_location
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
    console.log(`[BLE Monitor] ✅ ${tool.toolName} (${tagId}) → ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`)
  } catch (err) {
    console.error(`[BLE Monitor] ❌ Erro ao salvar ${tool.toolId}:`, err)
  }
}

// ─── Scan callback ────────────────────────────────────────────────────────────

function onDeviceFound(deviceId: string): void {
  const tool = monitoredTrackers.get(deviceId)
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

function startMonitoring(): void {
  if (isScanning) return
  try {
    if (!manager) {
      manager = new BleManager()
    }
    // Filter by Find Easy service UUID so iOS allows scanning in background.
    // Android ignores this filter at the radio level but still receives all
    // advertisements — the UUID filter is applied in software on Android.
    manager.startDeviceScan([FIND_EASY_SERVICE_UUID], { allowDuplicates: false }, (error, device) => {
      if (error) {
        console.warn('[BLE Monitor] Scan error:', error.message)
        return
      }
      if (device?.id) {
        onDeviceFound(device.id)
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
