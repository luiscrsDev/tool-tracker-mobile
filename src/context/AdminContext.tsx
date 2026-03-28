import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '@/lib/supabase'
import { CacheService } from '@/lib/cache'
import { NetworkService } from '@/lib/network'
import { retryWithBackoff, getErrorMessage } from '@/lib/errors'
import type { Contractor } from '@/types'

export interface AdminStats {
  totalContractors: number
  activeTools: number
  activeAlerts: number
  avgToolsPerContractor: number
}

interface AdminContextType {
  contractors: Contractor[]
  stats: AdminStats
  loading: boolean
  error: Error | null
  refreshData: () => Promise<void>
}

const AdminContext = createContext<AdminContextType | undefined>(undefined)

export function AdminProvider({ children }: { children: React.ReactNode }) {
  const [contractors, setContractors] = useState<Contractor[]>([])
  const [stats, setStats] = useState<AdminStats>({
    totalContractors: 0,
    activeTools: 0,
    activeAlerts: 0,
    avgToolsPerContractor: 0,
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const refreshData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      // Try cache first (2 min TTL for admin data)
      const cachedContractors = await CacheService.get<Contractor[]>('admin:contractors', {
        ttl: 2 * 60 * 1000,
      })

      let contractorData = cachedContractors
      let toolData: any[] | null = null
      let alertData: any[] | null = null

      if (!cachedContractors) {
        // Check network before querying
        const isOnline = await NetworkService.isOnline()
        if (!isOnline) {
          throw new Error('Network error')
        }

        // Cache miss, query from Supabase with retry
        const data = await retryWithBackoff(async () => {
          const { data: result, error: contractorError } = await supabase
            .from('contractors')
            .select('*')
            .eq('status', 'active')
            .order('name')

          if (contractorError) throw contractorError
          return result || []
        }, 2)

        contractorData = data
        await CacheService.set('admin:contractors', contractorData)
      }

      setContractors(contractorData || [])

      // Fetch stats (always fresh, with retry)
      const tools = await retryWithBackoff(async () => {
        const { data, error: toolError } = await supabase
          .from('tools')
          .select('id, is_connected', { count: 'exact' })
          .eq('is_connected', true)

        if (toolError) throw toolError
        return data || []
      }, 2)
      toolData = tools

      const alerts = await retryWithBackoff(async () => {
        const { data, error: alertError } = await supabase
          .from('alerts')
          .select('id', { count: 'exact' })
          .eq('resolved', false)

        if (alertError) throw alertError
        return data || []
      }, 2)
      alertData = alerts

      const totalContractors = contractorData?.length || 0
      const activeTools = toolData?.length || 0
      const activeAlerts = alertData?.length || 0

      setStats({
        totalContractors,
        activeTools,
        activeAlerts,
        avgToolsPerContractor: totalContractors > 0 ? Math.round(activeTools / totalContractors) : 0,
      })

      console.log('✅ Admin data loaded')
    } catch (err) {
      const errorMsg = getErrorMessage(err)
      setError(new Error(errorMsg))
      console.error('❌ Error loading admin data:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  // Load data on mount (only for admin users)
  useEffect(() => {
    const checkUserType = async () => {
      try {
        const session = await AsyncStorage.getItem('authSession')
        if (session) {
          const parsed = JSON.parse(session)
          // Only load admin data if user is admin
          if (parsed.userType === 'admin') {
            await refreshData()
          }
        }
      } catch (err) {
        console.error('❌ Error checking user type in AdminProvider:', err)
      }
    }

    checkUserType()
  }, [])

  return (
    <AdminContext.Provider
      value={{
        contractors,
        stats,
        loading,
        error,
        refreshData,
      }}
    >
      {children}
    </AdminContext.Provider>
  )
}

export function useAdmin() {
  const context = useContext(AdminContext)
  if (!context) {
    throw new Error('useAdmin must be used within AdminProvider')
  }
  return context
}
