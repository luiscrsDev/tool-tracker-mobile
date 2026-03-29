import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, Linking,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useTools } from '@/context/ToolsContext'
import { useSites } from '@/context/SitesContext'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'

interface LocationRecord {
  id: string
  tool_id: string
  latitude: number
  longitude: number
  accuracy: number
  recorded_at: string
}

export default function HistoryScreen() {
  const { tools } = useTools()
  const { resolveLocationAsync, refreshSites } = useSites()
  const { contractor } = useAuth()
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null)
  const [history, setHistory] = useState<LocationRecord[]>([])
  const [addresses, setAddresses] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const selectedTool = tools.find(t => t.id === selectedToolId)

  useEffect(() => {
    if (contractor?.id) refreshSites(contractor.id)
  }, [contractor?.id])

  const loadHistory = useCallback(async (toolId: string) => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('location_history')
        .select('id, tool_id, latitude, longitude, accuracy, recorded_at')
        .eq('tool_id', toolId)
        .order('recorded_at', { ascending: false })
        .limit(50)

      if (error) throw error
      setHistory(data || [])

      // Resolve addresses
      const map = new Map<string, string>()
      for (const r of (data || [])) {
        const addr = await resolveLocationAsync(r.latitude, r.longitude)
        map.set(r.id, addr)
      }
      setAddresses(map)
    } catch (err) {
      console.error('Erro ao carregar histórico:', err)
    } finally {
      setLoading(false)
    }
  }, [resolveLocationAsync])

  useEffect(() => {
    if (selectedToolId) loadHistory(selectedToolId)
  }, [selectedToolId])

  const onRefresh = async () => {
    if (!selectedToolId) return
    setRefreshing(true)
    await loadHistory(selectedToolId)
    setRefreshing(false)
  }

  const timeAgo = (ts: string) => {
    const diff = Date.now() - new Date(ts).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'Agora'
    if (mins < 60) return `${mins}min atrás`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h atrás`
    return new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  // Tool selector
  if (!selectedToolId) {
    return (
      <View style={{ flex: 1, backgroundColor: '#F8FAFC' }}>
        <View style={{ backgroundColor: '#0F172A', paddingHorizontal: 20, paddingTop: 56, paddingBottom: 20 }}>
          <Text style={{ fontSize: 22, fontWeight: '800', color: 'white' }}>Histórico</Text>
          <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>Selecione uma ferramenta</Text>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
          {tools.map(tool => (
            <TouchableOpacity
              key={tool.id}
              onPress={() => setSelectedToolId(tool.id)}
              style={{
                backgroundColor: 'white', borderRadius: 12, padding: 14,
                flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, elevation: 1,
              }}
            >
              <View>
                <Text style={{ fontSize: 15, fontWeight: '700', color: '#0F172A' }}>{tool.name}</Text>
                <Text style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>{tool.type}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#CBD5E1" />
            </TouchableOpacity>
          ))}
          {tools.length === 0 && (
            <View style={{ alignItems: 'center', paddingTop: 60 }}>
              <Ionicons name="time-outline" size={64} color="#CBD5E1" />
              <Text style={{ fontSize: 15, fontWeight: '600', color: '#64748B', marginTop: 16 }}>Sem ferramentas rastreadas</Text>
            </View>
          )}
        </ScrollView>
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#F8FAFC' }}>
      <View style={{ backgroundColor: '#0F172A', paddingHorizontal: 20, paddingTop: 56, paddingBottom: 20 }}>
        <TouchableOpacity onPress={() => { setSelectedToolId(null); setHistory([]); setAddresses(new Map()) }} style={{ marginBottom: 12 }}>
          <Text style={{ color: '#2563EB', fontSize: 13, fontWeight: '600' }}>← Voltar</Text>
        </TouchableOpacity>
        <Text style={{ fontSize: 22, fontWeight: '800', color: 'white' }}>{selectedTool?.name}</Text>
        <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 3 }}>
          {history.length} registros
        </Text>
      </View>

      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator color="#2563EB" size="large" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {history.length === 0 && (
            <View style={{ alignItems: 'center', paddingTop: 60 }}>
              <Ionicons name="time-outline" size={64} color="#CBD5E1" />
              <Text style={{ fontSize: 15, fontWeight: '600', color: '#64748B', marginTop: 16 }}>Sem histórico</Text>
            </View>
          )}

          {history.map((record, idx) => (
            <View key={record.id} style={{ flexDirection: 'row', gap: 10, marginBottom: 2 }}>
              {/* Timeline */}
              <View style={{ alignItems: 'center', width: 20 }}>
                <View style={{
                  width: idx === 0 ? 14 : 10, height: idx === 0 ? 14 : 10, borderRadius: 10,
                  backgroundColor: idx === 0 ? '#2563EB' : '#BFDBFE', marginTop: 14,
                }} />
                {idx < history.length - 1 && (
                  <View style={{ width: 2, flex: 1, backgroundColor: '#E2E8F0', marginVertical: 2 }} />
                )}
              </View>

              {/* Card */}
              <TouchableOpacity
                style={{
                  flex: 1, backgroundColor: 'white', borderRadius: 10, padding: 12, marginBottom: 6,
                  borderWidth: 1, borderColor: idx === 0 ? '#BFDBFE' : '#F1F5F9',
                }}
                onPress={() => Linking.openURL(`https://www.google.com/maps?q=${record.latitude},${record.longitude}`)}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#1E40AF', flex: 1 }}>
                    {addresses.get(record.id) || `${record.latitude.toFixed(5)}, ${record.longitude.toFixed(5)}`}
                  </Text>
                  <Ionicons name="open-outline" size={14} color="#93C5FD" />
                </View>
                <Text style={{ fontSize: 11, color: '#94A3B8' }}>
                  {timeAgo(record.recorded_at)}
                </Text>
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  )
}
