import React, { createContext, useContext, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { CacheService } from '@/lib/cache'
import { NetworkService } from '@/lib/network'
import { retryWithBackoff, getErrorMessage } from '@/lib/errors'
import type { Tool } from '@/types'

interface ToolsContextType {
  tools: Tool[]
  loading: boolean
  error: Error | null
  refreshTools: (contractorId: string) => Promise<void>
  addTool: (tool: Omit<Tool, 'id' | 'created_at' | 'updated_at'>) => Promise<void>
  updateTool: (id: string, updates: Partial<Tool>) => Promise<void>
  deleteTool: (id: string) => Promise<void>
  linkTag: (toolId: string, tagRecordId: string) => Promise<void>
  unlinkTag: (toolId: string) => Promise<void>
}

const ToolsContext = createContext<ToolsContextType | undefined>(undefined)

export function ToolsProvider({ children }: { children: React.ReactNode }) {
  const [tools, setTools] = useState<Tool[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const refreshTools = async (contractorId: string) => {
    try {
      setLoading(true)
      setError(null)

      const cacheKey = `tools:${contractorId}`
      const cached = await CacheService.get<Tool[]>(cacheKey, { ttl: 3 * 60 * 1000 })

      let data: Tool[] | null = cached || null

      if (!cached) {
        const isOnline = await NetworkService.isOnline()
        if (!isOnline) throw new Error('Network error')

        const result = await retryWithBackoff(async () => {
          const { data: queryData, error: queryError } = await supabase
            .from('tools')
            .select('*')
            .eq('contractor_id', contractorId)
            .order('name')

          if (queryError) throw queryError
          return queryData || []
        }, 2)

        data = result
        await CacheService.set(cacheKey, data)
      }

      setTools(data || [])
      console.log('✅ Tools loaded:', data?.length || 0)
    } catch (err) {
      const errorMsg = getErrorMessage(err)
      setError(new Error(errorMsg))
      console.error('❌ Error loading tools:', err)
    } finally {
      setLoading(false)
    }
  }

  const addTool = async (tool: Omit<Tool, 'id' | 'created_at' | 'updated_at'>) => {
    try {
      setError(null)

      const data = await retryWithBackoff(async () => {
        const { data: result, error: insertError } = await supabase
          .from('tools')
          .insert([tool])
          .select()

        if (insertError) throw insertError
        return result
      }, 3)

      if (data) {
        setTools([...tools, data[0]])
        await CacheService.invalidate(`tools:${tool.contractor_id}`)
        console.log('✅ Tool added:', data[0].name)
      }
    } catch (err) {
      const errorMsg = getErrorMessage(err)
      setError(new Error(errorMsg))
      console.error('❌ Error adding tool:', err)
      throw err
    }
  }

  const updateTool = async (id: string, updates: Partial<Tool>) => {
    try {
      setError(null)

      await retryWithBackoff(async () => {
        const { data: updated, error: updateError } = await supabase
          .from('tools')
          .update(updates)
          .eq('id', id)
          .select()

        if (updateError) throw updateError
        if (!updated || updated.length === 0) throw new Error('Nenhuma linha atualizada')
      }, 3)

      const tool = tools.find(t => t.id === id)
      if (tool) await CacheService.invalidate(`tools:${tool.contractor_id}`)
      setTools(tools.map(t => (t.id === id ? { ...t, ...updates } : t)))
      console.log('✅ Tool updated:', id)
    } catch (err) {
      const errorMsg = getErrorMessage(err)
      setError(new Error(errorMsg))
      console.error('❌ Error updating tool:', err)
      throw err
    }
  }

  const deleteTool = async (id: string) => {
    try {
      setError(null)

      await retryWithBackoff(async () => {
        const { error: deleteError } = await supabase.from('tools').delete().eq('id', id)
        if (deleteError) throw deleteError
      }, 3)

      const tool = tools.find(t => t.id === id)
      if (tool) await CacheService.invalidate(`tools:${tool.contractor_id}`)
      setTools(tools.filter(t => t.id !== id))
      console.log('✅ Tool deleted:', id)
    } catch (err) {
      const errorMsg = getErrorMessage(err)
      setError(new Error(errorMsg))
      console.error('❌ Error deleting tool:', err)
      throw err
    }
  }

  const linkTag = async (toolId: string, tagRecordId: string) => {
    // 1. Remove assigned_tag de qualquer outra ferramenta com esse tag
    await supabase
      .from('tools')
      .update({ assigned_tag: null })
      .eq('assigned_tag', tagRecordId)
      .neq('id', toolId)

    // 2. Vincula
    const { data, error: sbError } = await supabase
      .from('tools')
      .update({ assigned_tag: tagRecordId })
      .eq('id', toolId)
      .select('id, assigned_tag')

    if (sbError) throw new Error(sbError.message)
    if (!data || data.length === 0) throw new Error('Ferramenta não encontrada')

    // 3. Atualiza estado local
    setTools(prev => prev.map(t => {
      if (t.id === toolId) return { ...t, assigned_tag: tagRecordId }
      if (t.assigned_tag === tagRecordId) return { ...t, assigned_tag: null }
      return t
    }))

    await CacheService.invalidatePattern('tools:')
    console.log(`✅ linkTag: ferramenta ${toolId} → tag ${tagRecordId}`)
  }

  const unlinkTag = async (toolId: string) => {
    const { error: sbError } = await supabase
      .from('tools')
      .update({ assigned_tag: null })
      .eq('id', toolId)

    if (sbError) throw new Error(sbError.message)

    setTools(prev => prev.map(t =>
      t.id === toolId ? { ...t, assigned_tag: null } : t
    ))

    await CacheService.invalidatePattern('tools:')
    console.log(`✅ unlinkTag: ferramenta ${toolId} desvinculada`)
  }

  return (
    <ToolsContext.Provider
      value={{
        tools, loading, error,
        refreshTools, addTool, updateTool, deleteTool, linkTag, unlinkTag,
      }}
    >
      {children}
    </ToolsContext.Provider>
  )
}

export function useTools() {
  const context = useContext(ToolsContext)
  if (!context) throw new Error('useTools must be used within ToolsProvider')
  return context
}
