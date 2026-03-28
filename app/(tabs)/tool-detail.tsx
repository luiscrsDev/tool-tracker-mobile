import { useEffect, useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  Linking,
  ActivityIndicator,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useTools } from '@/context/ToolsContext'
import { useLocation } from '@/context/LocationContext'
import { supabase } from '@/lib/supabase'

interface LocationRecord {
  id: string
  latitude: number
  longitude: number
  accuracy: number
  recorded_at: string
  address?: string
}

export default function ToolDetailScreen() {
  const { toolId } = useLocalSearchParams<{ toolId: string }>()
  const router = useRouter()
  const { tools, deleteTool } = useTools()
  const { allToolLocations, trackedTools } = useLocation()
  const [recentHistory, setRecentHistory] = useState<LocationRecord[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)

  const tool = tools.find(t => t.id === toolId)
  const lastLocation = allToolLocations.get(toolId ?? '') || tool?.last_seen_location
  const isTracking = trackedTools.some(t => t.id === toolId)

  useEffect(() => {
    if (toolId) loadRecentHistory()
  }, [toolId])

  const loadRecentHistory = async () => {
    try {
      setLoadingHistory(true)
      const { data } = await supabase
        .from('location_history')
        .select('id, latitude, longitude, accuracy, recorded_at, address')
        .eq('tool_id', toolId)
        .order('recorded_at', { ascending: false })
        .limit(5)
      setRecentHistory(data || [])
    } catch (err) {
      console.error('Erro ao carregar histórico:', err)
    } finally {
      setLoadingHistory(false)
    }
  }

  const handleDelete = () => {
    Alert.alert('Deletar Ferramenta?', `Tem certeza que deseja deletar "${tool?.name}"?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Deletar',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteTool(toolId!)
            router.back()
          } catch {
            Alert.alert('Erro', 'Falha ao deletar ferramenta')
          }
        },
      },
    ])
  }

  const openMap = () => {
    if (!lastLocation) return
    Linking.openURL(`https://www.google.com/maps?q=${lastLocation.latitude},${lastLocation.longitude}`)
  }

  if (!tool) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ color: '#94A3B8' }}>Ferramenta não encontrada</Text>
      </View>
    )
  }

  const batteryColor = !tool.battery ? '#94A3B8'
    : tool.battery < 20 ? '#EF4444'
    : tool.battery < 50 ? '#F59E0B'
    : '#10B981'

  return (
    <View style={{ flex: 1, backgroundColor: '#F8FAFC' }}>
      {/* Header */}
      <View style={{
        backgroundColor: '#0F172A',
        paddingHorizontal: 20,
        paddingTop: 56,
        paddingBottom: 24,
      }}>
        <TouchableOpacity onPress={() => router.back()} style={{ marginBottom: 16 }}>
          <Text style={{ color: '#2563EB', fontSize: 13, fontWeight: '600' }}>← Voltar</Text>
        </TouchableOpacity>

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 24, fontWeight: '800', color: 'white', letterSpacing: -0.5 }}>
              {tool.name}
            </Text>
            <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 4, letterSpacing: 0.5 }}>
              {tool.type?.replace('_', ' ').toUpperCase()}
            </Text>
          </View>
          <View style={{
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 20,
            backgroundColor: isTracking ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.08)',
            borderWidth: 1,
            borderColor: isTracking ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.1)',
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{
                width: 6, height: 6, borderRadius: 3,
                backgroundColor: isTracking ? '#10B981' : '#64748B',
              }} />
              <Text style={{ fontSize: 10, color: isTracking ? '#10B981' : '#64748B', fontWeight: '700', letterSpacing: 0.5 }}>
                {isTracking ? 'RASTREANDO' : 'INATIVO'}
              </Text>
            </View>
          </View>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>

        {/* Specs */}
        <View style={{
          backgroundColor: 'white',
          borderRadius: 12,
          padding: 16,
          shadowColor: '#000',
          shadowOpacity: 0.05,
          shadowRadius: 6,
          elevation: 1,
        }}>
          <Text style={{ fontSize: 10, fontWeight: '700', color: '#94A3B8', letterSpacing: 1, marginBottom: 14 }}>
            ESPECIFICAÇÕES
          </Text>
          <View style={{ gap: 12 }}>
            {[
              { label: 'Tipo', value: tool.type?.replace('_', ' ') },
              { label: 'Valor', value: tool.value ? `R$ ${Number(tool.value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : 'Não informado' },
              { label: 'Status', value: tool.is_connected ? 'Conectada' : 'Desconectada', color: tool.is_connected ? '#10B981' : '#EF4444' },
            ].map((item, i) => (
              <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontSize: 13, color: '#64748B' }}>{item.label}</Text>
                <Text style={{ fontSize: 13, fontWeight: '600', color: item.color ?? '#0F172A' }}>
                  {item.value}
                </Text>
              </View>
            ))}

            {/* Battery */}
            {tool.battery !== null && tool.battery !== undefined && (
              <View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <Text style={{ fontSize: 13, color: '#64748B' }}>Bateria</Text>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: batteryColor }}>
                    {tool.battery}%
                  </Text>
                </View>
                <View style={{ height: 6, backgroundColor: '#F1F5F9', borderRadius: 3, overflow: 'hidden' }}>
                  <View style={{
                    height: 6,
                    width: `${tool.battery}%`,
                    backgroundColor: batteryColor,
                    borderRadius: 3,
                  }} />
                </View>
              </View>
            )}
          </View>
        </View>

        {/* Last Location */}
        {lastLocation && (
          <View style={{
            backgroundColor: 'white',
            borderRadius: 12,
            padding: 16,
            shadowColor: '#000',
            shadowOpacity: 0.05,
            shadowRadius: 6,
            elevation: 1,
            borderLeftWidth: 3,
            borderLeftColor: '#2563EB',
          }}>
            <Text style={{ fontSize: 10, fontWeight: '700', color: '#94A3B8', letterSpacing: 1, marginBottom: 14 }}>
              ÚLTIMA LOCALIZAÇÃO
            </Text>
            <Text style={{ fontSize: 14, fontWeight: '700', color: '#1E40AF', marginBottom: 6 }}>
              {lastLocation.latitude.toFixed(5)}, {lastLocation.longitude.toFixed(5)}
            </Text>
            {lastLocation.address && (
              <Text style={{ fontSize: 12, color: '#64748B', lineHeight: 18, marginBottom: 10 }}>
                📮 {lastLocation.address}
              </Text>
            )}
            {lastLocation.timestamp && (
              <Text style={{ fontSize: 11, color: '#CBD5E1', marginBottom: 12 }}>
                {new Date(lastLocation.timestamp).toLocaleString('pt-BR')}
              </Text>
            )}
            <TouchableOpacity
              onPress={openMap}
              style={{
                backgroundColor: '#EFF6FF',
                borderRadius: 8,
                paddingVertical: 10,
                alignItems: 'center',
                borderWidth: 1,
                borderColor: '#BFDBFE',
              }}
            >
              <Text style={{ color: '#2563EB', fontWeight: '700', fontSize: 12 }}>
                🗺 Ver no Google Maps
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Recent History */}
        <View style={{
          backgroundColor: 'white',
          borderRadius: 12,
          padding: 16,
          shadowColor: '#000',
          shadowOpacity: 0.05,
          shadowRadius: 6,
          elevation: 1,
        }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <Text style={{ fontSize: 10, fontWeight: '700', color: '#94A3B8', letterSpacing: 1 }}>
              HISTÓRICO RECENTE
            </Text>
            <TouchableOpacity onPress={() => router.push('/(tabs)/history')}>
              <Text style={{ fontSize: 11, color: '#2563EB', fontWeight: '600' }}>Ver tudo →</Text>
            </TouchableOpacity>
          </View>

          {loadingHistory ? (
            <ActivityIndicator color="#2563EB" />
          ) : recentHistory.length === 0 ? (
            <Text style={{ fontSize: 12, color: '#CBD5E1', textAlign: 'center', paddingVertical: 12 }}>
              Sem histórico ainda
            </Text>
          ) : (
            <View style={{ gap: 10 }}>
              {recentHistory.map((record, i) => (
                <View key={record.id} style={{
                  flexDirection: 'row',
                  gap: 10,
                  alignItems: 'flex-start',
                  paddingBottom: i < recentHistory.length - 1 ? 10 : 0,
                  borderBottomWidth: i < recentHistory.length - 1 ? 1 : 0,
                  borderBottomColor: '#F1F5F9',
                }}>
                  <View style={{
                    width: 8, height: 8, borderRadius: 4,
                    backgroundColor: i === 0 ? '#2563EB' : '#BFDBFE',
                    marginTop: 4, flexShrink: 0,
                  }} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 12, fontWeight: '600', color: '#1E40AF' }}>
                      {record.latitude.toFixed(5)}, {record.longitude.toFixed(5)}
                    </Text>
                    {record.address && (
                      <Text style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }} numberOfLines={1}>
                        {record.address}
                      </Text>
                    )}
                    <Text style={{ fontSize: 10, color: '#CBD5E1', marginTop: 2 }}>
                      {new Date(record.recorded_at).toLocaleString('pt-BR')}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Actions */}
        <View style={{ gap: 10, marginBottom: 8 }}>
          <TouchableOpacity
            onPress={() => router.push(`/(tabs)/tool-form?toolId=${tool.id}`)}
            style={{
              backgroundColor: '#2563EB',
              borderRadius: 12,
              paddingVertical: 14,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: 'white', fontWeight: '700', fontSize: 14 }}>✏️ Editar Ferramenta</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleDelete}
            style={{
              backgroundColor: '#FEF2F2',
              borderRadius: 12,
              paddingVertical: 14,
              alignItems: 'center',
              borderWidth: 1,
              borderColor: '#FECACA',
            }}
          >
            <Text style={{ color: '#EF4444', fontWeight: '700', fontSize: 14 }}>🗑 Deletar Ferramenta</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  )
}
