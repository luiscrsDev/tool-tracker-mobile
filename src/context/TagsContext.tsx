import React, { createContext, useContext, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { Tag } from '@/types'

interface TagsContextType {
  tags: Tag[]
  loading: boolean
  refreshTags: (contractorId: string) => Promise<void>
  createTag: (tag: { contractor_id: string; name: string; tag_id: string; eik?: string | null }) => Promise<Tag>
  deleteTag: (id: string) => Promise<void>
  updateTag: (id: string, updates: Partial<Tag>) => Promise<void>
  getTagById: (id: string) => Tag | undefined
  getTagByTagId: (tagId: string) => Tag | undefined
}

const TagsContext = createContext<TagsContextType | undefined>(undefined)

export function TagsProvider({ children }: { children: React.ReactNode }) {
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(false)

  const refreshTags = useCallback(async (contractorId: string) => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('tags')
        .select('*')
        .eq('contractor_id', contractorId)
        .order('name')

      if (error) throw error
      setTags(data || [])
    } catch (err) {
      console.error('❌ Error loading tags:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  const createTag = useCallback(async (tag: { contractor_id: string; name: string; tag_id: string; eik?: string | null }): Promise<Tag> => {
    // Check if tag_id already exists (re-pairing same device)
    const existing = tags.find(t => t.tag_id === tag.tag_id)
    if (existing) {
      const updates: Partial<Tag> = {}
      if (tag.name !== existing.name) updates.name = tag.name
      if (tag.eik && tag.eik !== existing.eik) updates.eik = tag.eik
      if (Object.keys(updates).length > 0) {
        await updateTag(existing.id, updates)
        return { ...existing, ...updates }
      }
      return existing
    }

    const { data, error } = await supabase
      .from('tags')
      .insert({
        contractor_id: tag.contractor_id,
        name: tag.name,
        tag_id: tag.tag_id,
        eik: tag.eik ?? null,
        status: 'active',
      })
      .select('*')
      .single()

    if (error) throw new Error(error.message)
    setTags(prev => [...prev, data])
    console.log(`✅ Tag criada: ${data.name} (${data.tag_id})`)
    return data
  }, [tags])

  const deleteTag = useCallback(async (id: string) => {
    const { error } = await supabase.from('tags').delete().eq('id', id)
    if (error) throw new Error(error.message)
    setTags(prev => prev.filter(t => t.id !== id))
    console.log(`✅ Tag deletada: ${id}`)
  }, [])

  const updateTag = useCallback(async (id: string, updates: Partial<Tag>) => {
    const { error } = await supabase.from('tags').update(updates).eq('id', id)
    if (error) throw new Error(error.message)
    setTags(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t))
  }, [])

  const getTagById = useCallback((id: string) => tags.find(t => t.id === id), [tags])
  const getTagByTagId = useCallback((tagId: string) => tags.find(t => t.tag_id === tagId), [tags])

  return (
    <TagsContext.Provider value={{
      tags, loading, refreshTags, createTag, deleteTag, updateTag, getTagById, getTagByTagId,
    }}>
      {children}
    </TagsContext.Provider>
  )
}

export function useTags() {
  const context = useContext(TagsContext)
  if (!context) throw new Error('useTags must be used within TagsProvider')
  return context
}
