import * as Location from 'expo-location'

export interface LocationData {
  latitude: number
  longitude: number
  accuracy: number
  altitude: number | null
  heading: number | null
  speed: number | null
  timestamp: number
  address?: string
}

let locationSubscription: Location.LocationSubscription | null = null

export const LocationService = {
  // Request permissions
  async requestPermissions(): Promise<boolean> {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync()
      console.log(`📍 Location permission status: ${status}`)
      return status === 'granted'
    } catch (err) {
      console.error('❌ Permission error:', err)
      return false
    }
  },

  // Get current location once
  async getCurrentLocation(): Promise<LocationData | null> {
    try {
      console.log('📍 Requesting current location...')
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
        timeoutMs: 30000,
      })

      console.log('✅ Got current location:', location.coords)
      return {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        accuracy: location.coords.accuracy || 0,
        altitude: location.coords.altitude || null,
        heading: location.coords.heading || null,
        speed: location.coords.speed || null,
        timestamp: location.timestamp,
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      console.error('❌ Location error:', errorMsg)
      return null
    }
  },

  // Watch position (continuous tracking)
  async watchPosition(
    onLocationChange: (location: LocationData) => void,
    onError?: (error: Error) => void,
  ): Promise<number> {
    try {
      console.log('📍 Starting location watch...')
      locationSubscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Highest,
          timeInterval: 1000, // 1 second
          distanceInterval: 5, // 5 meters
        },
        location => {
          try {
            onLocationChange({
              latitude: location.coords.latitude,
              longitude: location.coords.longitude,
              accuracy: location.coords.accuracy || 0,
              altitude: location.coords.altitude || null,
              heading: location.coords.heading || null,
              speed: location.coords.speed || null,
              timestamp: location.timestamp,
            })
          } catch (err) {
            console.error('❌ Error in location callback:', err)
            onError?.(err instanceof Error ? err : new Error(String(err)))
          }
        },
      )
      console.log('✅ Location watch started')
      return 1 // Return dummy ID since expo-location doesn't return an ID
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      console.error('❌ Fatal error starting watch:', errorMsg)
      onError?.(new Error(`Failed to start position watch: ${errorMsg}`))
      return -1
    }
  },

  // Stop watching position
  clearWatch(watchId: number): void {
    try {
      if (locationSubscription) {
        locationSubscription.remove()
        locationSubscription = null
        console.log('✅ Location watch stopped')
      }
    } catch (err) {
      console.error('❌ Error stopping watch:', err)
    }
  },

  // Calculate distance between two points (in meters)
  calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 6371000 // Earth's radius in meters
    const dLat = ((lat2 - lat1) * Math.PI) / 180
    const dLon = ((lon2 - lon1) * Math.PI) / 180
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return R * c
  },

  // Format location to readable string
  formatLocation(location: LocationData): string {
    return `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`
  },

  // Get location URL for maps
  getLocationUrl(latitude: number, longitude: number): string {
    return `https://maps.google.com/?q=${latitude},${longitude}`
  },
}
