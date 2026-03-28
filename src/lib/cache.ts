import AsyncStorage from '@react-native-async-storage/async-storage'

interface CacheEntry<T> {
  data: T
  timestamp: number
  ttl: number
}

/**
 * Cache service for reducing Supabase queries
 * Stores data locally with TTL and provides offline support
 */
export const CacheService = {
  /**
   * Get cached data if it exists and is fresh
   * @param key Cache key
   * @param options TTL in ms (default: 5min), returns stale if offline
   */
  async get<T>(key: string, options?: { ttl?: number; returnStaleOffline?: boolean }): Promise<T | null> {
    const ttl = options?.ttl ?? 5 * 60 * 1000 // 5 min default
    const returnStaleOffline = options?.returnStaleOffline ?? true

    try {
      const cached = await AsyncStorage.getItem(`cache:${key}`)
      if (!cached) return null

      const entry: CacheEntry<T> = JSON.parse(cached)
      const isExpired = Date.now() - entry.timestamp > ttl

      if (!isExpired) {
        console.log(`✅ Cache hit: ${key}`)
        return entry.data
      }

      // Cache expired, but keep it for offline fallback
      if (returnStaleOffline) {
        console.log(`⚠️ Cache stale (fallback): ${key}`)
        return entry.data
      }

      return null
    } catch (err) {
      console.error(`❌ Cache read error: ${key}`, err)
      return null
    }
  },

  /**
   * Set cache data
   * @param key Cache key
   * @param data Data to cache
   * @param ttl Time to live in ms (default: 5min)
   */
  async set<T>(key: string, data: T, ttl?: number): Promise<void> {
    try {
      const entry: CacheEntry<T> = {
        data,
        timestamp: Date.now(),
        ttl: ttl ?? 5 * 60 * 1000,
      }
      await AsyncStorage.setItem(`cache:${key}`, JSON.stringify(entry))
      console.log(`📦 Cached: ${key}`)
    } catch (err) {
      console.error(`❌ Cache write error: ${key}`, err)
    }
  },

  /**
   * Invalidate specific cache key
   */
  async invalidate(key: string): Promise<void> {
    try {
      await AsyncStorage.removeItem(`cache:${key}`)
      console.log(`🗑️ Cache cleared: ${key}`)
    } catch (err) {
      console.error(`❌ Cache invalidate error: ${key}`, err)
    }
  },

  /**
   * Invalidate all cache entries matching pattern
   */
  async invalidatePattern(pattern: string): Promise<void> {
    try {
      const keys = await AsyncStorage.getAllKeys()
      const matching = keys.filter(k => k.startsWith(`cache:`) && k.includes(pattern))
      await AsyncStorage.multiRemove(matching)
      console.log(`🗑️ Cleared ${matching.length} cache entries matching: ${pattern}`)
    } catch (err) {
      console.error(`❌ Cache invalidate pattern error: ${pattern}`, err)
    }
  },

  /**
   * Clear all cache
   */
  async clear(): Promise<void> {
    try {
      const keys = await AsyncStorage.getAllKeys()
      const cacheKeys = keys.filter(k => k.startsWith('cache:'))
      await AsyncStorage.multiRemove(cacheKeys)
      console.log(`🗑️ Cache cleared (${cacheKeys.length} entries)`)
    } catch (err) {
      console.error('❌ Cache clear error:', err)
    }
  },
}
