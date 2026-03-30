import * as TaskManager from 'expo-task-manager'
import * as Location from 'expo-location'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { processDetection } from './movementEngine'
import { startBleMonitoring, stopBleMonitoring, isMonitoring } from './bleMonitoring'

export const BACKGROUND_LOCATION_TASK = 'background-location-task'
const ACTIVE_TOOLS_KEY = 'activeTrackingTools'

export interface ActiveTool {
  id: string
  name: string
  contractorId: string
  tagId?: string
}

// ─── AsyncStorage helpers ────────────────────────────────────────────────────

export async function persistActiveTools(tools: ActiveTool[]): Promise<void> {
  await AsyncStorage.setItem(ACTIVE_TOOLS_KEY, JSON.stringify(tools))
}

export async function getPersistedTools(): Promise<ActiveTool[]> {
  try {
    const raw = await AsyncStorage.getItem(ACTIVE_TOOLS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export async function addPersistedTool(tool: ActiveTool): Promise<void> {
  const current = await getPersistedTools()
  const updated = [...current.filter(t => t.id !== tool.id), tool]
  await persistActiveTools(updated)
}

export async function removePersistedTool(toolId: string): Promise<void> {
  const current = await getPersistedTools()
  await persistActiveTools(current.filter(t => t.id !== toolId))
}

// ─── Background task ──────────────────────────────────────────────────────────
// Handles GPS-only tools AND provides location for BLE-tagged tools

TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }: TaskManager.TaskManagerTaskBody<{ locations: Location.LocationObject[] }>) => {
  if (error) {
    console.error('[BG] Location task error:', error.message)
    return
  }

  const locations = data?.locations
  if (!locations || locations.length === 0) return

  const latest = locations[locations.length - 1]
  const { latitude, longitude, speed } = latest.coords
  const tools = await getPersistedTools()

  if (tools.length === 0) return

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) return

  // GPS-only tools: save location directly
  const gpsOnlyTools = tools.filter(t => !t.tagId)
  for (const tool of gpsOnlyTools) {
    try {
      // Update last_seen_location
      await fetch(`${supabaseUrl}/rest/v1/tools?id=eq.${tool.id}`, {
        method: 'PATCH',
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          last_seen_location: {
            latitude, longitude,
            accuracy: latest.coords.accuracy,
            timestamp: new Date(latest.timestamp).toISOString(),
          },
        }),
      })

      // Process through movement engine
      await processDetection(
        tool.id, tool.contractorId,
        latitude, longitude, speed,
        null, tools.map(t => t.id),
      )

      console.log(`[BG] ✅ ${tool.name} (GPS) → ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`)
    } catch (err) {
      console.error(`[BG] ❌ ${tool.name}:`, err)
    }
  }
})

// ─── Start / stop ─────────────────────────────────────────────────────────────

export async function startBackgroundTracking(): Promise<boolean> {
  try {
    // Request background location permission
    const { status } = await Location.requestBackgroundPermissionsAsync()
    if (status !== 'granted') {
      console.warn('[BG] Background location permission not granted')
      return false
    }

    // Start background location with foreground service
    const isRunning = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)
    if (!isRunning) {
      await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 2 * 60 * 1000,  // every 2 min
        distanceInterval: 10,           // or 10m movement
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: 'Locate Tool',
          notificationBody: 'Rastreando ferramentas em segundo plano',
          notificationColor: '#2563EB',
        },
        pausesUpdatesAutomatically: false,
      })
      console.log('[BG] ✅ Background location started')
    }

    // Start BLE monitoring (runs alongside foreground service)
    if (!isMonitoring()) {
      startBleMonitoring()
      console.log('[BG] ✅ BLE monitoring started')
    }

    return true
  } catch (err) {
    console.error('[BG] ❌ Failed to start:', err)
    return false
  }
}

export async function stopBackgroundTracking(): Promise<void> {
  try {
    const isRunning = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)
    if (isRunning) {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)
    }
    stopBleMonitoring()
    console.log('[BG] ✅ Background tracking stopped')
  } catch (err) {
    console.error('[BG] ❌ Failed to stop:', err)
  }
}

// Legacy exports for compatibility
export const startBackgroundLocationUpdates = startBackgroundTracking
export const stopBackgroundLocationUpdates = stopBackgroundTracking
