import React, { createContext, useContext, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { Site } from '@/types'

interface SitesContextType {
  sites: Site[]
  loading: boolean
  refreshSites: (contractorId: string) => Promise<void>
  addSite: (site: Omit<Site, 'id' | 'created_at'>) => Promise<Site>
  updateSite: (id: string, updates: Partial<Site>) => Promise<void>
  deleteSite: (id: string) => Promise<void>
  resolveLocation: (lat: number, lng: number) => string
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

  /** Resolve coordinates to site label or formatted address */
  const resolveLocation = useCallback((lat: number, lng: number): string => {
    for (const site of sites) {
      const dist = distanceMeters(lat, lng, site.latitude, site.longitude)
      if (dist <= site.radius_m) return site.label
    }
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
  }, [sites])

  return (
    <SitesContext.Provider value={{
      sites, loading, refreshSites, addSite, updateSite, deleteSite, resolveLocation,
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
