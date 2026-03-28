import { supabase } from '@/lib/supabase'

/**
 * Analytics data aggregation for admin reports
 */
export const AnalyticsService = {
  /**
   * Get contractor usage metrics
   */
  async getContractorUsage(contractorId?: string) {
    try {
      const query = supabase.from('tools').select('contractor_id, count(*)').groupBy('contractor_id')

      if (contractorId) {
        query.eq('contractor_id', contractorId)
      }

      const { data, error } = await query

      if (error) throw error

      return (
        data?.map((row: any) => ({
          contractorId: row.contractor_id,
          toolCount: row.count,
        })) || []
      )
    } catch (err) {
      console.error('Error getting contractor usage:', err)
      return []
    }
  },

  /**
   * Get connectivity metrics for date range
   */
  async getConnectivityMetrics(startDate: Date, endDate: Date) {
    try {
      const { data, error } = await supabase
        .from('tools')
        .select('assigned_tag, created_at')
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString())

      if (error) throw error

      const total = data?.length || 0
      const connected = data?.filter((t: any) => t.assigned_tag != null).length || 0
      const uptime = total > 0 ? Math.round((connected / total) * 100) : 0

      return {
        total,
        connected,
        disconnected: total - connected,
        uptime,
      }
    } catch (err) {
      console.error('Error getting connectivity metrics:', err)
      return { total: 0, connected: 0, disconnected: 0, uptime: 0 }
    }
  },

  /**
   * Get incident statistics
   */
  async getIncidents(days = 7) {
    try {
      const startDate = new Date()
      startDate.setDate(startDate.getDate() - days)

      const { data, error } = await supabase
        .from('alerts')
        .select('severity, created_at')
        .gte('created_at', startDate.toISOString())

      if (error) throw error

      const stats = {
        critical: data?.filter((a: any) => a.severity === 'critical').length || 0,
        high: data?.filter((a: any) => a.severity === 'high').length || 0,
        medium: data?.filter((a: any) => a.severity === 'medium').length || 0,
        low: data?.filter((a: any) => a.severity === 'low').length || 0,
        total: data?.length || 0,
      }

      return stats
    } catch (err) {
      console.error('Error getting incidents:', err)
      return { critical: 0, high: 0, medium: 0, low: 0, total: 0 }
    }
  },

  /**
   * Get tool health status
   */
  async getToolHealth() {
    try {
      const { data, error } = await supabase
        .from('tools')
        .select('battery_level, last_seen')
        .neq('battery_level', null)

      if (error) throw error

      const tools = data || []
      const lowBattery = tools.filter((t: any) => t.battery_level < 20).length
      const criticalBattery = tools.filter((t: any) => t.battery_level < 10).length
      const avgBattery = tools.length > 0 ? Math.round(tools.reduce((sum: number, t: any) => sum + (t.battery_level || 0), 0) / tools.length) : 0

      return {
        totalTools: tools.length,
        lowBattery,
        criticalBattery,
        avgBattery,
      }
    } catch (err) {
      console.error('Error getting tool health:', err)
      return { totalTools: 0, lowBattery: 0, criticalBattery: 0, avgBattery: 0 }
    }
  },

  /**
   * Get growth metrics over time
   */
  async getGrowthMetrics(days = 30) {
    try {
      const startDate = new Date()
      startDate.setDate(startDate.getDate() - days)

      const { data: contractors, error: contractorError } = await supabase
        .from('contractors')
        .select('created_at')
        .gte('created_at', startDate.toISOString())

      if (contractorError) throw contractorError

      const { data: tools, error: toolError } = await supabase
        .from('tools')
        .select('created_at')
        .gte('created_at', startDate.toISOString())

      if (toolError) throw toolError

      return {
        newContractors: contractors?.length || 0,
        newTools: tools?.length || 0,
        period: `${days} dias`,
      }
    } catch (err) {
      console.error('Error getting growth metrics:', err)
      return { newContractors: 0, newTools: 0, period: 'N/A' }
    }
  },
}
