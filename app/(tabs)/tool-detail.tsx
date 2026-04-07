import { useEffect, useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  Linking,
  ActivityIndicator,
  Image,
} from 'react-native'
// MapView disabled — needs Google Maps API key configured in app.json
// import { Platform } from 'react-native'
// let MapView: any = null
// let Marker: any = null
// if (Platform.OS !== 'web') {
//   const maps = require('react-native-maps')
//   MapView = maps.default
//   Marker = maps.Marker
// }
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useTools } from '@/context/ToolsContext'
import { useTags } from '@/context/TagsContext'
import { useSites } from '@/context/SitesContext'
import { useLocation } from '@/context/LocationContext'
import { supabase } from '@/lib/supabase'

interface LocationRecord {
  id: string
  latitude: number
  longitude: number
  event: string
  created_at: string
}

export default function ToolDetailScreen() {
  const { toolId } = useLocalSearchParams<{ toolId: string }>()
  const router = useRouter()
  const { tools, deleteTool, unlinkTag } = useTools()
  const { getTagById } = useTags()
  const { resolveLocation, resolveLocationAsync } = useSites()
  const [resolvedAddresses, setResolvedAddresses] = useState<Map<string, string>>(new Map())
  const { allToolLocations, trackedTools } = useLocation()
  const [recentHistory, setRecentHistory] = useState<LocationRecord[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)

  const tool = tools.find(t => t.id === toolId)
  const tag = tool?.assigned_tag ? getTagById(tool.assigned_tag) : null
  const lastLocation = allToolLocations.get(toolId ?? '') || tool?.last_seen_location
  const isTracking = trackedTools.some(t => t.id === toolId)
  const isConnected = !!tool?.assigned_tag

  // Resolve endereços quando histórico carrega
  useEffect(() => {
    if (recentHistory.length === 0) return
    const resolve = async () => {
      const map = new Map<string, string>()
      for (const r of recentHistory) {
        const addr = await resolveLocationAsync(r.latitude, r.longitude)
        map.set(r.id, addr)
      }
      setResolvedAddresses(map)
    }
    resolve()
  }, [recentHistory, resolveLocationAsync])

  // Resolve última localização
  useEffect(() => {
    if (!lastLocation) return
    resolveLocationAsync(lastLocation.latitude, lastLocation.longitude).then(addr => {
      setResolvedAddresses(prev => new Map(prev).set('last', addr))
    })
  }, [lastLocation, resolveLocationAsync])

  useEffect(() => {
    if (toolId) loadRecentHistory()
  }, [toolId])

  const loadRecentHistory = async () => {
    try {
      setLoadingHistory(true)
      const { data } = await supabase
        .from('tool_movements')
        .select('id, latitude, longitude, event, created_at')
        .eq('tool_id', toolId)
        .order('created_at', { ascending: false })
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
            // Fix: navega para lista de ferramentas, não dashboard
            router.replace('/(tabs)/tools')
          } catch {
            Alert.alert('Erro', 'Falha ao deletar ferramenta')
          }
        },
      },
    ])
  }

  const handleUnlink = () => {
    Alert.alert(
      'Desvincular Tag?',
      `Remover o tracker "${tag?.name || 'Tag'}" de "${tool?.name}"?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Desvincular',
          style: 'destructive',
          onPress: async () => {
            try { await unlinkTag(tool!.id) }
            catch { Alert.alert('Erro', 'Falha ao desvincular tag') }
          },
        },
      ]
    )
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

  return (
    <View style={{ flex: 1, backgroundColor: '#F8FAFC' }}>
      {/* Header */}
      <View style={{
        backgroundColor: '#0F172A',
        paddingHorizontal: 20,
        paddingTop: 56,
        paddingBottom: 24,
      }}>
        <TouchableOpacity onPress={() => router.replace('/(tabs)/tools')} style={{ marginBottom: 16 }}>
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
          {(() => {
            const statusLabel = tool.status === 'active' ? 'ATIVO' : tool.status === 'maintenance' ? 'MANUTENÇÃO' : 'INATIVO'
            const isActive = tool.status === 'active'
            return (
              <View style={{
                paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20,
                backgroundColor: isActive ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.08)',
                borderWidth: 1, borderColor: isActive ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.1)',
              }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: isActive ? '#10B981' : '#64748B' }} />
                  <Text style={{ fontSize: 10, color: isActive ? '#10B981' : '#64748B', fontWeight: '700', letterSpacing: 0.5 }}>
                    {statusLabel}
                  </Text>
                </View>
              </View>
            )
          })()}
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>

        {/* Photos */}
        {tool.images && tool.images.length > 0 && (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {tool.images.map((img, i) => (
              <View key={i} style={{
                flex: i === 0 ? 2 : 1, aspectRatio: i === 0 ? 4/3 : 1,
                borderRadius: 10, overflow: 'hidden', backgroundColor: '#F1F5F9',
              }}>
                <Image source={{ uri: img }} style={{ width: '100%', height: '100%' }} />
              </View>
            ))}
          </View>
        )}

        {/* Specs */}
        <View style={{
          backgroundColor: 'white', borderRadius: 12, padding: 16,
          shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, elevation: 1,
        }}>
          <Text style={{ fontSize: 10, fontWeight: '700', color: '#94A3B8', letterSpacing: 1, marginBottom: 14 }}>
            ESPECIFICAÇÕES
          </Text>
          <View style={{ gap: 12 }}>
            {[
              { label: 'Tipo', value: tool.type?.replace('_', ' ') },
              { label: 'Valor', value: tool.value ? `R$ ${Number(tool.value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : 'Não informado' },
            ].map((item, i) => (
              <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontSize: 13, color: '#64748B' }}>{item.label}</Text>
                <Text style={{ fontSize: 13, fontWeight: '600', color: '#0F172A' }}>{item.value}</Text>
              </View>
            ))}


            {/* Tag vinculado */}
            <View style={{ borderTopWidth: 1, borderTopColor: '#F1F5F9', paddingTop: 12, marginTop: 2 }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: '#94A3B8', letterSpacing: 0.5, marginBottom: 8 }}>
                TAG BLUETOOTH
              </Text>
              {isConnected ? (
                <View style={{
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                  backgroundColor: '#F0FDF4', borderRadius: 8, padding: 10,
                  borderWidth: 1, borderColor: '#BBF7D0',
                }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#10B981' }} />
                    <Text style={{ fontSize: 13, fontWeight: '600', color: '#065F46' }}>
                      {tag?.name || 'Tag vinculado'}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={handleUnlink}
                    style={{
                      paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6,
                      backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA',
                    }}
                  >
                    <Text style={{ fontSize: 11, color: '#EF4444', fontWeight: '700' }}>Desvincular</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <Text style={{ fontSize: 13, color: '#CBD5E1' }}>Sem tracker vinculado</Text>
              )}
            </View>
          </View>
        </View>

        {/* Last Location */}
        {lastLocation && (
          <View style={{
            backgroundColor: 'white', borderRadius: 12, padding: 16,
            shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, elevation: 1,
            borderLeftWidth: 3, borderLeftColor: '#2563EB',
          }}>
            <Text style={{ fontSize: 10, fontWeight: '700', color: '#94A3B8', letterSpacing: 1, marginBottom: 14 }}>
              ÚLTIMA LOCALIZAÇÃO
            </Text>
            {MapView && Marker && (
              <MapView
                style={{ height: 160, borderRadius: 12, overflow: 'hidden', marginBottom: 12 }}
                region={{
                  latitude: lastLocation.latitude,
                  longitude: lastLocation.longitude,
                  latitudeDelta: 0.005,
                  longitudeDelta: 0.005,
                }}
                scrollEnabled={false}
                zoomEnabled={false}
                pitchEnabled={false}
              >
                <Marker
                  coordinate={{
                    latitude: lastLocation.latitude,
                    longitude: lastLocation.longitude,
                  }}
                />
              </MapView>
            )}
            <Text style={{ fontSize: 14, fontWeight: '700', color: '#1E40AF', marginBottom: 6 }}>
              {resolvedAddresses.get('last') || resolveLocation(lastLocation.latitude, lastLocation.longitude)}
            </Text>
            {lastLocation.timestamp && (
              <Text style={{ fontSize: 11, color: '#CBD5E1', marginBottom: 12 }}>
                {new Date(lastLocation.timestamp).toLocaleString('pt-BR')}
              </Text>
            )}
            <TouchableOpacity
              onPress={openMap}
              style={{
                backgroundColor: '#EFF6FF', borderRadius: 8, paddingVertical: 10,
                alignItems: 'center', borderWidth: 1, borderColor: '#BFDBFE',
              }}
            >
              <Text style={{ color: '#2563EB', fontWeight: '700', fontSize: 12 }}>Ver no Google Maps</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Recent History */}
        <View style={{
          backgroundColor: 'white', borderRadius: 12, padding: 16,
          shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, elevation: 1,
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
              {recentHistory.map((record, i) => {
                const eventConfig = record.event === 'movement'
                  ? { color: '#2563EB', icon: '→', label: 'Movimento' }
                  : record.event === 'stop'
                  ? { color: '#EF4444', icon: '📍', label: 'Parada' }
                  : record.event === 'speed'
                  ? { color: '#F97316', icon: '🚗', label: 'Velocidade' }
                  : { color: '#94A3B8', icon: '•', label: record.event }
                return (
                  <View key={record.id} style={{
                    flexDirection: 'row', gap: 10, alignItems: 'flex-start',
                    paddingBottom: i < recentHistory.length - 1 ? 10 : 0,
                    borderBottomWidth: i < recentHistory.length - 1 ? 1 : 0,
                    borderBottomColor: '#F1F5F9',
                  }}>
                    <View style={{
                      width: 24, height: 24, borderRadius: 12,
                      backgroundColor: eventConfig.color + '20',
                      alignItems: 'center', justifyContent: 'center',
                      marginTop: 2, flexShrink: 0,
                    }}>
                      <Text style={{ fontSize: 12, color: eventConfig.color }}>
                        {eventConfig.icon}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={{ fontSize: 12, fontWeight: '600', color: '#1E40AF', flex: 1 }} numberOfLines={1}>
                          {resolvedAddresses.get(record.id) || resolveLocation(record.latitude, record.longitude)}
                        </Text>
                        <View style={{
                          backgroundColor: eventConfig.color + '15',
                          paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
                        }}>
                          <Text style={{ fontSize: 9, fontWeight: '700', color: eventConfig.color, letterSpacing: 0.3 }}>
                            {eventConfig.label.toUpperCase()}
                          </Text>
                        </View>
                      </View>
                      <Text style={{ fontSize: 10, color: '#CBD5E1', marginTop: 2 }}>
                        {new Date(record.created_at).toLocaleString('pt-BR')}
                      </Text>
                    </View>
                  </View>
                )
              })}
            </View>
          )}
        </View>

        {/* Actions */}
        <View style={{ gap: 10, marginBottom: 8 }}>
          <TouchableOpacity
            onPress={() => router.push(`/(tabs)/tool-form?toolId=${tool.id}`)}
            style={{ backgroundColor: '#2563EB', borderRadius: 12, paddingVertical: 14, alignItems: 'center' }}
          >
            <Text style={{ color: 'white', fontWeight: '700', fontSize: 14 }}>Editar Ferramenta</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleDelete}
            style={{
              backgroundColor: '#FEF2F2', borderRadius: 12, paddingVertical: 14,
              alignItems: 'center', borderWidth: 1, borderColor: '#FECACA',
            }}
          >
            <Text style={{ color: '#EF4444', fontWeight: '700', fontSize: 14 }}>Deletar Ferramenta</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  )
}
