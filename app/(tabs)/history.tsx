import { useState, useEffect, useCallback } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Linking,
} from 'react-native'
import { useTools } from '@/context/ToolsContext'
import { supabase } from '@/lib/supabase'

interface LocationRecord {
  id: string
  tool_id: string
  latitude: number
  longitude: number
  accuracy: number
  timestamp: string
  recorded_at: string
  address?: string
  speed?: number
}

const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371
  const dLat = (lat2 - lat1) * (Math.PI / 180)
  const dLon = (lon2 - lon1) * (Math.PI / 180)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export default function HistoryScreen() {
  const { tools } = useTools()
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null)
  const [history, setHistory] = useState<LocationRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const selectedTool = tools.find(t => t.id === selectedToolId)

  const loadHistory = useCallback(async (toolId: string) => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('location_history')
        .select('*')
        .eq('tool_id', toolId)
        .order('recorded_at', { ascending: false })
        .limit(100)

      if (error) throw error
      setHistory(data || [])
    } catch (err) {
      console.error('Erro ao carregar histórico:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (selectedToolId) {
      loadHistory(selectedToolId)
    }
  }, [selectedToolId])

  const onRefresh = async () => {
    if (!selectedToolId) return
    setRefreshing(true)
    await loadHistory(selectedToolId)
    setRefreshing(false)
  }

  const getStats = () => {
    if (history.length === 0) return null
    let totalDistance = 0
    for (let i = 0; i < history.length - 1; i++) {
      totalDistance += calculateDistance(
        history[i].latitude, history[i].longitude,
        history[i + 1].latitude, history[i + 1].longitude
      )
    }
    const first = new Date(history[history.length - 1].recorded_at)
    const last = new Date(history[0].recorded_at)
    const diffHours = (last.getTime() - first.getTime()) / (1000 * 60 * 60)
    const timeSpan = diffHours < 1
      ? `${Math.round(diffHours * 60)}min`
      : `${(Math.round(diffHours * 10) / 10).toFixed(1)}h`
    return { totalDistance: totalDistance.toFixed(2), points: history.length, timeSpan }
  }

  const openMap = (lat: number, lon: number) => {
    Linking.openURL(`https://www.google.com/maps?q=${lat},${lon}`)
  }

  const stats = getStats()

  // Tool selector
  if (!selectedToolId) {
    return (
      <View style={{ flex: 1, backgroundColor: '#F8FAFC' }}>
        <View style={{
          backgroundColor: '#0F172A',
          paddingHorizontal: 20,
          paddingTop: 56,
          paddingBottom: 20,
        }}>
          <Text style={{ fontSize: 22, fontWeight: '800', color: 'white', letterSpacing: -0.5 }}>
            Histórico
          </Text>
          <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>
            Selecione uma ferramenta
          </Text>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
          {tools.length === 0 ? (
            <View style={{ alignItems: 'center', paddingTop: 60 }}>
              <Text style={{ fontSize: 40, marginBottom: 12 }}>📦</Text>
              <Text style={{ fontSize: 15, fontWeight: '600', color: '#334155' }}>
                Nenhuma ferramenta
              </Text>
              <Text style={{ fontSize: 13, color: '#94A3B8', marginTop: 6, textAlign: 'center' }}>
                Cadastre ferramentas para ver o histórico
              </Text>
            </View>
          ) : (
            tools.map(tool => (
              <TouchableOpacity
                key={tool.id}
                onPress={() => setSelectedToolId(tool.id)}
                activeOpacity={0.7}
                style={{
                  backgroundColor: 'white',
                  borderRadius: 12,
                  padding: 16,
                  borderLeftWidth: 3,
                  borderLeftColor: '#2563EB',
                  shadowColor: '#000',
                  shadowOpacity: 0.06,
                  shadowRadius: 8,
                  shadowOffset: { width: 0, height: 2 },
                  elevation: 2,
                }}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 15, fontWeight: '700', color: '#0F172A' }}>
                      {tool.name}
                    </Text>
                    <Text style={{ fontSize: 11, color: '#94A3B8', marginTop: 3, letterSpacing: 0.5 }}>
                      {tool.type?.replace('_', ' ').toUpperCase()}
                    </Text>
                  </View>
                  <View style={{
                    backgroundColor: '#EFF6FF',
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: 20,
                  }}>
                    <Text style={{ fontSize: 11, color: '#2563EB', fontWeight: '700' }}>
                      VER →
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#F8FAFC' }}>
      {/* Header */}
      <View style={{
        backgroundColor: '#0F172A',
        paddingHorizontal: 20,
        paddingTop: 56,
        paddingBottom: 20,
      }}>
        <TouchableOpacity
          onPress={() => { setSelectedToolId(null); setHistory([]) }}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <Text style={{ color: '#2563EB', fontSize: 13, fontWeight: '600' }}>← Voltar</Text>
        </TouchableOpacity>
        <Text style={{ fontSize: 22, fontWeight: '800', color: 'white', letterSpacing: -0.5 }}>
          {selectedTool?.name}
        </Text>
        <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 3, letterSpacing: 0.5 }}>
          HISTÓRICO DE LOCALIZAÇÕES
        </Text>
      </View>

      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator color="#2563EB" size="large" />
          <Text style={{ color: '#94A3B8', marginTop: 12, fontSize: 13 }}>Carregando...</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#2563EB" />}
        >
          {/* Stats */}
          {stats && (
            <View style={{
              flexDirection: 'row',
              gap: 10,
              marginBottom: 20,
            }}>
              {[
                { label: 'PONTOS', value: String(stats.points), color: '#2563EB' },
                { label: 'DISTÂNCIA', value: `${stats.totalDistance}km`, color: '#10B981' },
                { label: 'PERÍODO', value: stats.timeSpan, color: '#F59E0B' },
              ].map((s, i) => (
                <View key={i} style={{
                  flex: 1,
                  backgroundColor: 'white',
                  borderRadius: 12,
                  padding: 14,
                  alignItems: 'center',
                  shadowColor: '#000',
                  shadowOpacity: 0.05,
                  shadowRadius: 6,
                  elevation: 1,
                  borderTopWidth: 3,
                  borderTopColor: s.color,
                }}>
                  <Text style={{ fontSize: 20, fontWeight: '800', color: '#0F172A' }}>{s.value}</Text>
                  <Text style={{ fontSize: 9, color: '#94A3B8', marginTop: 3, letterSpacing: 1, fontWeight: '600' }}>
                    {s.label}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* Empty state */}
          {history.length === 0 && (
            <View style={{ alignItems: 'center', paddingTop: 60 }}>
              <Text style={{ fontSize: 40, marginBottom: 12 }}>📍</Text>
              <Text style={{ fontSize: 15, fontWeight: '600', color: '#334155' }}>
                Sem dados de histórico
              </Text>
              <Text style={{ fontSize: 13, color: '#94A3B8', marginTop: 6, textAlign: 'center' }}>
                Ative o rastreamento para gerar histórico
              </Text>
            </View>
          )}

          {/* Timeline */}
          {history.map((record, idx) => {
            const next = history[idx + 1]
            const dist = next
              ? calculateDistance(record.latitude, record.longitude, next.latitude, next.longitude)
              : null
            const isFirst = idx === 0

            return (
              <View key={record.id} style={{ flexDirection: 'row', gap: 12, marginBottom: 4 }}>
                {/* Timeline dot + line */}
                <View style={{ alignItems: 'center', width: 24 }}>
                  <View style={{
                    width: isFirst ? 18 : 14,
                    height: isFirst ? 18 : 14,
                    borderRadius: 20,
                    backgroundColor: isFirst ? '#2563EB' : '#BFDBFE',
                    borderWidth: isFirst ? 0 : 2,
                    borderColor: '#2563EB',
                    shadowColor: isFirst ? '#2563EB' : 'transparent',
                    shadowOpacity: 0.4,
                    shadowRadius: 6,
                    elevation: isFirst ? 3 : 0,
                    marginTop: 16,
                  }} />
                  {idx < history.length - 1 && (
                    <View style={{
                      width: 2,
                      flex: 1,
                      minHeight: 40,
                      backgroundColor: '#BFDBFE',
                      marginVertical: 4,
                    }} />
                  )}
                </View>

                {/* Card */}
                <TouchableOpacity
                  style={{
                    flex: 1,
                    backgroundColor: isFirst ? '#EFF6FF' : 'white',
                    borderRadius: 12,
                    padding: 14,
                    marginBottom: 8,
                    borderWidth: 1.5,
                    borderColor: isFirst ? '#BFDBFE' : '#F1F5F9',
                    borderLeftWidth: 3,
                    borderLeftColor: '#2563EB',
                  }}
                  onPress={() => openMap(record.latitude, record.longitude)}
                  activeOpacity={0.8}
                >
                  {/* Time */}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <Text style={{ fontSize: 11, color: '#94A3B8', fontWeight: '600' }}>
                      {new Date(record.recorded_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      {' · '}
                      {new Date(record.recorded_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                    </Text>
                    {dist !== null && (
                      <View style={{
                        backgroundColor: '#DCFCE7',
                        paddingHorizontal: 8,
                        paddingVertical: 3,
                        borderRadius: 20,
                      }}>
                        <Text style={{ fontSize: 10, color: '#16A34A', fontWeight: '700' }}>
                          ↔ {dist.toFixed(2)}km
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* Coordinates */}
                  <Text style={{
                    fontSize: 13,
                    fontWeight: '700',
                    color: '#1E40AF',
                    fontVariant: ['tabular-nums'],
                    marginBottom: record.address ? 6 : 0,
                  }}>
                    {record.latitude.toFixed(5)}, {record.longitude.toFixed(5)}
                  </Text>

                  {/* Address */}
                  {record.address && (
                    <Text style={{ fontSize: 11, color: '#64748B', lineHeight: 16 }} numberOfLines={2}>
                      📮 {record.address}
                    </Text>
                  )}

                  {/* Footer */}
                  <View style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginTop: 8,
                    paddingTop: 8,
                    borderTopWidth: 1,
                    borderTopColor: '#F1F5F9',
                  }}>
                    <Text style={{ fontSize: 10, color: '#CBD5E1' }}>
                      ±{record.accuracy?.toFixed(0)}m precisão
                    </Text>
                    <Text style={{ fontSize: 10, color: '#2563EB', fontWeight: '600' }}>
                      Ver no mapa →
                    </Text>
                  </View>
                </TouchableOpacity>
              </View>
            )
          })}
        </ScrollView>
      )}
    </View>
  )
}
