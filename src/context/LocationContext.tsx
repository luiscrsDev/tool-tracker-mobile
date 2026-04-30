import React, { createContext, useContext, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { LocationService, type LocationData } from '@/lib/location'
import {
  addPersistedTool,
  removePersistedTool,
  getPersistedTools,
  persistActiveTools,
  startBackgroundLocationUpdates,
  stopBackgroundLocationUpdates,
} from '@/lib/backgroundTracking'
// JS BLE monitoring removed — native Kotlin service handles all BLE tracking
// Keeping removeTrackerFromMonitor for stopTracking cleanup
import {
  removeTrackerFromMonitor,
  setOnDetectionCallback,
  destroyBleMonitor,
} from '@/lib/bleMonitoring'

interface TrackedTool {
  id: string
  name: string
  contractorId: string
  tagId?: string
  location: LocationData | null
  lastUpdated: number
}

interface LastSavedLocation {
  latitude: number
  longitude: number
  timestamp: number
}

interface LocationContextType {
  trackedTools: TrackedTool[]
  tracking: boolean
  currentLocation: LocationData | null
  error: Error | null
  startTracking: (toolId: string, toolName: string, contractorId: string, tagId?: string) => Promise<void>
  stopTracking: (toolId: string) => Promise<void>
  updateToolLocation: (toolId: string, location: LocationData) => Promise<void>
  getCurrentLocation: () => Promise<LocationData | null>
  loadLastKnownLocations: (toolIds: string[]) => Promise<void>
  allToolLocations: Map<string, LocationData>
  getToolLastLocation: (toolId: string) => LocationData | null
}

const LocationContext = createContext<LocationContextType | undefined>(undefined)

export function LocationProvider({ children }: { children: React.ReactNode }) {
  const [trackedTools, setTrackedTools] = useState<TrackedTool[]>([])
  const [tracking, setTracking] = useState(false)
  const [currentLocation, setCurrentLocation] = useState<LocationData | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [allToolLocations, setAllToolLocations] = useState<Map<string, LocationData>>(new Map())
  const watchIds = React.useRef<Map<string, number>>(new Map())
  const lastSavedLocations = React.useRef<Map<string, LastSavedLocation>>(new Map())
  const lastSaveTimestamps = React.useRef<Map<string, number>>(new Map())
  const savingInProgress = React.useRef<Set<string>>(new Set())

  // Calculate distance between two points (in meters)
  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371000 // Earth's radius in meters
    const dLat = ((lat2 - lat1) * Math.PI) / 180
    const dLon = ((lon2 - lon1) * Math.PI) / 180
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return R * c
  }

  // Save location to history
  const saveLocationToHistory = useCallback(
    async (toolId: string, contractorId: string, location: LocationData) => {
      try {
        console.log(`📝 [saveLocationToHistory] Saving for ${toolId} by ${contractorId}:`, {
          latitude: location.latitude.toFixed(6),
          longitude: location.longitude.toFixed(6),
          accuracy: location.accuracy,
        })

        const { data, error: insertError } = await supabase.from('location_history').insert({
          tool_id: toolId,
          contractor_id: contractorId || null,
          latitude: location.latitude,
          longitude: location.longitude,
          accuracy: location.accuracy,
          altitude: location.altitude,
          heading: location.heading,
          speed: location.speed,
          timestamp: location.timestamp,
          address: location.address,
        })

        if (insertError) {
          console.error('❌ Error saving to location_history:', insertError.code, insertError.message)
          console.error('❌ Error details:', insertError)
          return
        }

        console.log(`✅ Location saved to history: ${toolId}`, data)
      } catch (err) {
        console.error('❌ Error in saveLocationToHistory:', err)
      }
    },
    [],
  )

  // Decide if should save (5min passed OR >10m moved)
  const shouldSaveLocation = (toolId: string, location: LocationData): boolean => {
    const lastSaved = lastSavedLocations.current.get(toolId)
    const lastSaveTime = lastSaveTimestamps.current.get(toolId) || 0
    const now = Date.now()

    // 5 minutes passed
    if (now - lastSaveTime > 5 * 60 * 1000) {
      console.log(`📍 [shouldSaveLocation] 5min passed for ${toolId}`)
      return true
    }

    // Location changed >10 meters
    if (lastSaved) {
      const distance = calculateDistance(lastSaved.latitude, lastSaved.longitude, location.latitude, location.longitude)
      if (distance > 10) {
        console.log(`📍 [shouldSaveLocation] ${distance}m moved for ${toolId}`)
        return true
      }
    }

    return false
  }

  const getCurrentLocation = useCallback(async () => {
    try {
      const location = await LocationService.getCurrentLocation()
      if (location) {
        setCurrentLocation(location)
      }
      return location
    } catch (err) {
      const errorMsg = err instanceof Error ? err : new Error('Location error')
      setError(errorMsg)
      return null
    }
  }, [])

  const updateToolLocation = useCallback(
    async (toolId: string, location: LocationData) => {
      try {
        // Always update last_seen_location
        const { error: updateError } = await supabase
          .from('tools')
          .update({
            last_seen_location: {
              latitude: location.latitude,
              longitude: location.longitude,
              address: location.address,
              timestamp: new Date(location.timestamp).toISOString(),
            },
          })
          .eq('id', toolId)

        if (updateError) {
          console.warn('⚠️ Supabase update error (network?):', updateError.message)
        } else {
          console.log(`✅ Last location updated: ${toolId}`)
        }

        // Check if should save to history (5min OR >10m moved)
        // Lock prevents concurrent saves for the same tool (race condition fix)
        if (shouldSaveLocation(toolId, location) && !savingInProgress.current.has(toolId)) {
          const contractorId = trackedTools.find(t => t.id === toolId)?.contractorId || ''
          savingInProgress.current.add(toolId)
          // Update refs BEFORE await to block any concurrent call
          lastSavedLocations.current.set(toolId, {
            latitude: location.latitude,
            longitude: location.longitude,
            timestamp: location.timestamp,
          })
          lastSaveTimestamps.current.set(toolId, Date.now())
          try {
            await saveLocationToHistory(toolId, contractorId, location)
          } finally {
            savingInProgress.current.delete(toolId)
          }
        }

        // Update local state
        setTrackedTools(prev =>
          prev.map(tool =>
            tool.id === toolId
              ? {
                  ...tool,
                  location,
                  lastUpdated: Date.now(),
                }
              : tool,
          ),
        )
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        console.error('❌ Update location error:', errorMsg)
      }
    },
    [saveLocationToHistory],
  )

  // Restore tracking state on mount (persisted across app restarts)
  React.useEffect(() => {
    const restore = async () => {
      const persisted = await getPersistedTools()
      if (persisted.length === 0) return

      console.log(`[LocationContext] Restoring ${persisted.length} tracked tool(s) from storage`)

      // Refresh tag_id from tags table via tools.assigned_tag
      let enriched = persisted
      try {
        const { data: dbTools } = await supabase
          .from('tools')
          .select('id, assigned_tag, tags:assigned_tag(tag_id)')
          .in('id', persisted.map(t => t.id))

        if (dbTools && dbTools.length > 0) {
          const tagMap = new Map(dbTools.map((t: any) => [t.id, (t.tags as any)?.tag_id ?? undefined]))
          enriched = persisted.map(t => ({ ...t, tagId: tagMap.get(t.id) ?? t.tagId }))
          await persistActiveTools(enriched)
          console.log(`[LocationContext] tag_id refreshed from tags table`)
        }
      } catch {
        console.warn('[LocationContext] Could not refresh tag_id, using cached data')
      }

      // BLE monitoring handled by native Kotlin service — no JS monitors needed

      await Promise.all(
        enriched.map(tool =>
          startTracking(tool.id, tool.name, tool.contractorId, tool.tagId).catch(err => {
            console.warn(`[LocationContext] Could not restore tracking for ${tool.id}:`, err.message)
          }),
        ),
      )
    }
    restore()
    // Run once on mount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const startTracking = useCallback(
    async (toolId: string, toolName: string, contractorId: string, tagId?: string) => {
      console.log(`\n🔍 START TRACKING: ${toolName} (${tagId ? 'BLE' : 'GPS'})`)
      try {
        setError(null)

        const hasPermission = await LocationService.requestPermissions()
        if (!hasPermission) throw new Error('Permissão de localização foi recusada')

        // Add to tracked list (skip duplicates)
        setTrackedTools(prev => {
          if (prev.some(t => t.id === toolId)) return prev
          return [...prev, { id: toolId, name: toolName, contractorId, tagId, location: null, lastUpdated: 0 }]
        })

        if (tagId) {
          // ── BLE tool ──────────────────────────────────────────────
          // BLE tracking handled entirely by native Kotlin service (duty cycle scan)
          // Do NOT register in JS bleMonitoring — causes duplicate records
          setTracking(true)
          console.log(`✅ RASTREAMENTO ATIVO (nativo): ${toolName} [${tagId}]\n`)
        } else {
          // ── GPS tool ──────────────────────────────────────────────
          // Location follows the contractor's phone.
          const initialLocation = await LocationService.getCurrentLocation()
          if (initialLocation) {
            setTrackedTools(prev =>
              prev.map(t => t.id === toolId ? { ...t, location: initialLocation, lastUpdated: Date.now() } : t),
            )
            void supabase.from('tools').update({
              last_seen_location: {
                latitude: initialLocation.latitude,
                longitude: initialLocation.longitude,
                address: initialLocation.address,
                timestamp: new Date(initialLocation.timestamp).toISOString(),
              },
            }).eq('id', toolId)
          }

          const watchId = await LocationService.watchPosition(
            location => {
              setTrackedTools(prev =>
                prev.map(t => t.id === toolId ? { ...t, location, lastUpdated: Date.now() } : t),
              )
              updateToolLocation(toolId, location).catch(() => {})
            },
            err => {
              console.error('❌ Watch position error:', err.message)
              setError(err)
            },
          )

          if (watchId === -1) throw new Error('Falha ao iniciar rastreamento de posição')
          watchIds.current.set(toolId, watchId)
          setTracking(true)
          console.log(`✅ RASTREAMENTO ATIVO (GPS): ${toolName}\n`)
        }

        await addPersistedTool({ id: toolId, name: toolName, contractorId, tagId })
        startBackgroundLocationUpdates().catch(() => {})
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`\n❌ TRACKING FAILED: ${msg}\n`)
        setError(new Error(msg))
        throw new Error(msg)
      }
    },
    [updateToolLocation],
  )

  const stopTracking = useCallback(async (toolId: string) => {
    try {
      setError(null)

      // Stop watching position
      const watchId = watchIds.current.get(toolId)
      if (watchId !== undefined) {
        LocationService.clearWatch(watchId)
        watchIds.current.delete(toolId)
      }

      // Stop BLE monitor for this tool's tracker
      const tool = trackedTools.find(t => t.id === toolId)
      if (tool) {
        // tagId is not stored in TrackedTool state, retrieve from persisted storage
        const persisted = await getPersistedTools()
        const persistedTool = persisted.find(t => t.id === toolId)
        if (persistedTool?.tagId) {
          removeTrackerFromMonitor(persistedTool.tagId)
        }
      }

      // Remove from tracked list
      setTrackedTools(prev => prev.filter(t => t.id !== toolId))

      if (watchIds.current.size === 0) {
        setTracking(false)
      }

      // Remove from AsyncStorage
      await removePersistedTool(toolId)

      // Stop background location if no tools remain
      const remaining = await getPersistedTools()
      if (remaining.length === 0) {
        await stopBackgroundLocationUpdates()
      }

      console.log(`✅ Tracking stopped for: ${toolId}`)
    } catch (err) {
      const errorMsg = err instanceof Error ? err : new Error('Stop tracking error')
      setError(errorMsg)
      console.error('❌ Stop tracking error:', err)
    }
  }, [trackedTools])

  // Load last known locations for all tools
  const loadLastKnownLocations = useCallback(async (toolIds: string[]) => {
    try {
      if (toolIds.length === 0) {
        console.warn('⚠️ No tool IDs provided')
        return
      }

      console.log(`🔄 Loading last locations for tools:`, toolIds)

      const { data, error } = await supabase
        .from('tools')
        .select('id, last_seen_location')
        .in('id', toolIds)

      if (error) {
        console.error('❌ Error loading last locations:', error.message)
        return
      }

      console.log(`📍 Loaded ${data?.length || 0} tools from database`)

      if (data && data.length > 0) {
        data.forEach(tool => {
          if (tool.last_seen_location) {
            console.log(
              `✅ Tool ${tool.id} has location:`,
              `${tool.last_seen_location.latitude}, ${tool.last_seen_location.longitude}`,
            )
          } else {
            console.log(`⚠️ Tool ${tool.id} has NO location data`)
          }
        })

        // Update allToolLocations map
        const newLocations = new Map(allToolLocations)
        data.forEach(toolData => {
          if (toolData.last_seen_location) {
            newLocations.set(toolData.id, {
              latitude: toolData.last_seen_location.latitude,
              longitude: toolData.last_seen_location.longitude,
              accuracy: toolData.last_seen_location.accuracy || 0,
              altitude: toolData.last_seen_location.altitude || null,
              heading: toolData.last_seen_location.heading || null,
              speed: toolData.last_seen_location.speed || null,
              timestamp: new Date(toolData.last_seen_location.timestamp).getTime(),
              address: toolData.last_seen_location.address,
            })
          }
        })
        setAllToolLocations(newLocations)

        // Also update tracked tools if they're in the list
        setTrackedTools(prev =>
          prev.map(tool => {
            const toolData = data.find(d => d.id === tool.id)
            return toolData && toolData.last_seen_location
              ? {
                  ...tool,
                  location: newLocations.get(tool.id) || tool.location,
                  lastUpdated: new Date(toolData.last_seen_location.timestamp).getTime(),
                }
              : tool
          }),
        )
      }
    } catch (err) {
      console.error('❌ Error in loadLastKnownLocations:', err)
    }
  }, [])

  // Register BLE detection callback — updates UI when beacon is detected nearby
  React.useEffect(() => {
    setOnDetectionCallback(({ toolId, latitude, longitude, accuracy, timestamp }) => {
      const location: LocationData = {
        latitude,
        longitude,
        accuracy: accuracy ?? 0,
        altitude: null,
        heading: null,
        speed: null,
        timestamp: new Date(timestamp).getTime(),
        address: undefined,
      }
      setTrackedTools(prev =>
        prev.map(t => t.id === toolId ? { ...t, location, lastUpdated: Date.now() } : t),
      )
      setAllToolLocations(prev => {
        const next = new Map(prev)
        next.set(toolId, location)
        return next
      })
    })
    return () => setOnDetectionCallback(null)
  }, [])

  // Cleanup on unmount
  React.useEffect(() => {
    const ids = watchIds.current
    return () => {
      ids.forEach(watchId => {
        LocationService.clearWatch(watchId)
      })
      destroyBleMonitor()
    }
  }, [])

  // Helper to get last location of any tool
  const getToolLastLocation = React.useCallback(
    (toolId: string): LocationData | null => {
      return allToolLocations.get(toolId) || null
    },
    [allToolLocations],
  )

  const value = React.useMemo(
    () => ({
      trackedTools,
      tracking,
      currentLocation,
      error,
      startTracking,
      stopTracking,
      updateToolLocation,
      getCurrentLocation,
      loadLastKnownLocations,
      allToolLocations,
      getToolLastLocation,
    }),
    [trackedTools, tracking, currentLocation, error, startTracking, stopTracking, updateToolLocation, getCurrentLocation, loadLastKnownLocations, allToolLocations, getToolLastLocation],
  )

  return (
    <LocationContext.Provider value={value}>
      {children}
    </LocationContext.Provider>
  )
}

export function useLocation() {
  const context = useContext(LocationContext)
  if (!context) {
    throw new Error('useLocation must be used within LocationProvider')
  }
  return context
}
