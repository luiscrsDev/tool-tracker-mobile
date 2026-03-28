import * as TaskManager from 'expo-task-manager'
import * as Location from 'expo-location'
import AsyncStorage from '@react-native-async-storage/async-storage'

export const BACKGROUND_LOCATION_TASK = 'background-location-task'
const ACTIVE_TOOLS_KEY = 'activeTrackingTools'

export interface ActiveTool {
  id: string
  name: string
  contractorId: string
  tagId?: string   // BLE MAC do tracker (se pareado)
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
// Only handles tools WITHOUT a BLE tag (GPS-only tools).
// Tagged tools are handled by bleMonitoring.ts (event-driven).

TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }: TaskManager.TaskManagerTaskBody<{ locations: Location.LocationObject[] }>) => {
  if (error) {
    console.error('[BG] Location task error:', error.message)
    return
  }

  const locations = data?.locations
  if (!locations || locations.length === 0) return

  const latest = locations[locations.length - 1]
  const tools = await getPersistedTools()

  // Only GPS-only tools (tagged tools are tracked via BLE beacon events)
  const gpsOnlyTools = tools.filter(t => !t.tagId)
  if (gpsOnlyTools.length === 0) return

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) return

  const saveLocation = async (tool: ActiveTool) => {
    try {
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
            latitude: latest.coords.latitude,
            longitude: latest.coords.longitude,
            accuracy: latest.coords.accuracy,
            timestamp: new Date(latest.timestamp).toISOString(),
          },
        }),
      })

      await fetch(`${supabaseUrl}/rest/v1/location_history`, {
        method: 'POST',
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          tool_id: tool.id,
          contractor_id: tool.contractorId || null,
          latitude: latest.coords.latitude,
          longitude: latest.coords.longitude,
          accuracy: latest.coords.accuracy,
          altitude: latest.coords.altitude,
          heading: latest.coords.heading,
          speed: latest.coords.speed,
          timestamp: new Date(latest.timestamp).toISOString(),
          detection_method: 'background_gps',
        }),
      })

      console.log(`[BG] ✅ ${tool.name} (GPS) → ${latest.coords.latitude.toFixed(5)}, ${latest.coords.longitude.toFixed(5)}`)
    } catch (err) {
      console.error(`[BG] ❌ Erro ao salvar ${tool.id}:`, err)
    }
  }

  await Promise.all(gpsOnlyTools.map(saveLocation))
})

// ─── Start / stop ─────────────────────────────────────────────────────────────

export async function startBackgroundLocationUpdates(): Promise<boolean> {
  try {
    const { status } = await Location.requestBackgroundPermissionsAsync()
    if (status !== 'granted') {
      console.warn('[BG] Background location permission not granted')
      return false
    }

    const isRunning = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)
    if (isRunning) return true

    await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: 5 * 60 * 1000,
      distanceInterval: 50,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'LocateTool',
        notificationBody: 'Rastreando ferramentas em segundo plano',
        notificationColor: '#2563EB',
      },
      pausesUpdatesAutomatically: false,
    })

    console.log('[BG] ✅ Background location started')
    return true
  } catch (err) {
    console.error('[BG] ❌ Failed to start background location:', err)
    return false
  }
}

export async function stopBackgroundLocationUpdates(): Promise<void> {
  try {
    const isRunning = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)
    if (isRunning) {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)
      console.log('[BG] ✅ Background location stopped')
    }
  } catch (err) {
    console.error('[BG] ❌ Failed to stop background location:', err)
  }
}
