import React, { createContext, useContext, useState, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import * as Location from 'expo-location'
import type { Site } from '@/types'

interface SitesContextType {
  sites: Site[]
  loading: boolean
  refreshSites: (contractorId: string) => Promise<void>
  addSite: (site: Omit<Site, 'id' | 'created_at'>) => Promise<Site>
  updateSite: (id: string, updates: Partial<Site>) => Promise<void>
  deleteSite: (id: string) => Promise<void>
  resolveLocation: (lat: number, lng: number) => string
  resolveLocationAsync: (lat: number, lng: number) => Promise<string>
}

const SitesContext = createContext<SitesContextType | undefined>(undefined)

/** Haversine distance in meters */
function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function SitesProvider({ children }: { children: React.ReactNode }) {
  const [sites, setSites] = useState<Site[]>([])
  const [loading, setLoading] = useState(false)

  const refreshSites = useCallback(async (contractorId: string) => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('sites')
        .select('*')
        .eq('contractor_id', contractorId)
        .order('label')

      if (error) throw error
      setSites(data || [])
    } catch (err) {
      console.error('❌ Error loading sites:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  const addSite = useCallback(async (site: Omit<Site, 'id' | 'created_at'>): Promise<Site> => {
    const { data, error } = await supabase
      .from('sites')
      .insert(site)
      .select('*')
      .single()

    if (error) throw new Error(error.message)
    setSites(prev => [...prev, data])
    return data
  }, [])

  const updateSite = useCallback(async (id: string, updates: Partial<Site>) => {
    const { error } = await supabase.from('sites').update(updates).eq('id', id)
    if (error) throw new Error(error.message)
    setSites(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s))
  }, [])

  const deleteSite = useCallback(async (id: string) => {
    const { error } = await supabase.from('sites').delete().eq('id', id)
    if (error) throw new Error(error.message)
    setSites(prev => prev.filter(s => s.id !== id))
  }, [])

  // Cache de reverse geocoding
  const geocodeCache = useRef(new Map<string, string>())

  /** Resolve sync: site label ou coordenadas */
  const resolveLocation = useCallback((lat: number, lng: number): string => {
    for (const site of sites) {
      const dist = distanceMeters(lat, lng, site.latitude, site.longitude)
      if (dist <= site.radius_m) return site.label
    }
    const key = `${lat.toFixed(4)},${lng.toFixed(4)}`
    return geocodeCache.current.get(key) || `${lat.toFixed(5)}, ${lng.toFixed(5)}`
  }, [sites])

  /** Resolve async: site label → reverse geocode → coordenadas */
  const resolveLocationAsync = useCallback(async (lat: number, lng: number): Promise<string> => {
    // 1. Check sites
    for (const site of sites) {
      const dist = distanceMeters(lat, lng, site.latitude, site.longitude)
      if (dist <= site.radius_m) return site.label
    }
    // 2. Check cache
    const key = `${lat.toFixed(4)},${lng.toFixed(4)}`
    if (geocodeCache.current.has(key)) return geocodeCache.current.get(key)!
    // 3. Reverse geocode
    try {
      const results = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng })
      if (results.length > 0) {
        const r = results[0]
        const streetFull = [r.streetNumber, r.street].filter(Boolean).join(' ')
        const parts = [streetFull, r.city, r.region].filter(Boolean)
        const address = parts.join(', ') || `${lat.toFixed(5)}, ${lng.toFixed(5)}`
        geocodeCache.current.set(key, address)
        return address
      }
    } catch { /* fallback */ }
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
  }, [sites])

  return (
    <SitesContext.Provider value={{
      sites, loading, refreshSites, addSite, updateSite, deleteSite, resolveLocation, resolveLocationAsync,
    }}>
      {children}
    </SitesContext.Provider>
  )
}

export function useSites() {
  const context = useContext(SitesContext)
  if (!context) throw new Error('useSites must be used within SitesProvider')
  return context
}
