import React, { createContext, useContext, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { CacheService } from '@/lib/cache'
import { NetworkService } from '@/lib/network'
import { retryWithBackoff, getErrorMessage } from '@/lib/errors'
import type { Alert } from '@/types'

interface AlertsContextType {
  alerts: Alert[]
  loading: boolean
  error: Error | null
  refreshAlerts: (contractorId: string) => Promise<void>
  resolveAlert: (alertId: string) => Promise<void>
}

const AlertsContext = createContext<AlertsContextType | undefined>(undefined)

export function AlertsProvider({ children }: { children: React.ReactNode }) {
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const refreshAlerts = async (contractorId: string) => {
    try {
      setLoading(true)
      setError(null)

      // Try cache first (2 min TTL)
      const cacheKey = `alerts:${contractorId}`
      const cached = await CacheService.get<Alert[]>(cacheKey, { ttl: 2 * 60 * 1000 })

      let data: Alert[] | null = cached || null

      if (!cached) {
        // Check network before querying
        const isOnline = await NetworkService.isOnline()
        if (!isOnline) {
          throw new Error('Network error')
        }

        // Cache miss, query Supabase with retry
        const result = await retryWithBackoff(async () => {
          const { data: queryData, error: queryError } = await supabase
            .from('alerts')
            .select('*')
            .eq('contractor_id', contractorId)
            .eq('resolved', false)
            .order('created_at', { ascending: false })

          if (queryError) throw queryError
          return queryData || []
        }, 2)

        data = result
        await CacheService.set(cacheKey, data)
      }

      setAlerts(data || [])
      console.log('✅ Alerts loaded:', data?.length || 0)
    } catch (err) {
      const errorMsg = getErrorMessage(err)
      setError(new Error(errorMsg))
      console.error('❌ Error loading alerts:', err)
    } finally {
      setLoading(false)
    }
  }

  const resolveAlert = async (alertId: string) => {
    try {
      setError(null)

      await retryWithBackoff(async () => {
        const { error: updateError } = await supabase
          .from('alerts')
          .update({
            resolved: true,
            resolved_at: new Date().toISOString(),
          })
          .eq('id', alertId)

        if (updateError) throw updateError
      }, 3)

      const alert = alerts.find(a => a.id === alertId)
      if (alert) {
        await CacheService.invalidate(`alerts:${alert.contractor_id}`)
      }
      setAlerts(alerts.filter(a => a.id !== alertId))
      console.log('✅ Alert resolved')
    } catch (err) {
      const errorMsg = getErrorMessage(err)
      setError(new Error(errorMsg))
      console.error('❌ Error resolving alert:', err)
      throw err
    }
  }

  return (
    <AlertsContext.Provider
      value={{
        alerts,
        loading,
        error,
        refreshAlerts,
        resolveAlert,
      }}
    >
      {children}
    </AlertsContext.Provider>
  )
}

export function useAlerts() {
  const context = useContext(AlertsContext)
  if (!context) {
    throw new Error('useAlerts must be used within AlertsProvider')
  }
  return context
}
