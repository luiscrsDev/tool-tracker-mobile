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
  linkTag: (toolId: string, tagId: string) => Promise<void>
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

      // Try cache first (3 min TTL)
      const cacheKey = `tools:${contractorId}`
      const cached = await CacheService.get<Tool[]>(cacheKey, { ttl: 3 * 60 * 1000 })

      let data: Tool[] | null = cached || null

      if (!cached) {
        // Check network before querying
        const isOnline = await NetworkService.isOnline()
        if (!isOnline) {
          throw new Error('Network error')
        }

        // Cache miss, query Supabase with retry
        const result = await retryWithBackoff(async () => {
          const { data: queryData, error: queryError } = await supabase
            .from('tools')
            .select('*')
            .eq('contractor_id', contractorId)
            .order('name')

          if (queryError) throw queryError
          return queryData || []
        }, 2) // 2 attempts for read operations

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
      }, 3) // 3 attempts for write operations

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
        if (!updated || updated.length === 0) throw new Error('Nenhuma linha atualizada — verifique as permissões no banco')
      }, 3)

      const tool = tools.find(t => t.id === id)
      if (tool) {
        await CacheService.invalidate(`tools:${tool.contractor_id}`)
      }
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
        const { error: deleteError } = await supabase
          .from('tools')
          .delete()
          .eq('id', id)

        if (deleteError) throw deleteError
      }, 3)

      const tool = tools.find(t => t.id === id)
      if (tool) {
        await CacheService.invalidate(`tools:${tool.contractor_id}`)
      }
      setTools(tools.filter(t => t.id !== id))
      console.log('✅ Tool deleted:', id)
    } catch (err) {
      const errorMsg = getErrorMessage(err)
      setError(new Error(errorMsg))
      console.error('❌ Error deleting tool:', err)
      throw err
    }
  }

  const linkTag = async (toolId: string, tagId: string) => {
    // 1. Atualiza no Supabase
    const { data, error: sbError } = await supabase
      .from('tools')
      .update({ tag_id: tagId, is_connected: true })
      .eq('id', toolId)
      .select('id, tag_id')

    if (sbError) throw new Error(sbError.message)
    if (!data || data.length === 0) throw new Error('Ferramenta não encontrada')
    if (data[0].tag_id !== tagId) throw new Error(`Supabase não salvou tag_id (retornou: ${data[0].tag_id})`)

    // 2. Atualiza estado local diretamente — sem passar pelo cache
    setTools(prev => prev.map(t => t.id === toolId ? { ...t, tag_id: tagId, is_connected: true } : t))

    console.log(`✅ linkTag: ferramenta ${toolId} → tag ${tagId}`)
  }

  return (
    <ToolsContext.Provider
      value={{
        tools,
        loading,
        error,
        refreshTools,
        addTool,
        updateTool,
        deleteTool,
        linkTag,
      }}
    >
      {children}
    </ToolsContext.Provider>
  )
}

export function useTools() {
  const context = useContext(ToolsContext)
  if (!context) {
    throw new Error('useTools must be used within ToolsProvider')
  }
  return context
}
