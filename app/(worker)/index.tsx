import { useEffect, useState } from 'react'
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, Linking } from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'

interface Tool {
  id: string
  name: string
  type: string
  serial_number: string | null
  last_seen_location: {
    latitude: number
    longitude: number
    address?: string
    timestamp: string
  } | null
  contractor: { name: string; company: string } | null
}

export default function WorkerHomeScreen() {
  const { worker, signOut } = useAuth()
  const router = useRouter()
  const [tools, setTools] = useState<Tool[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    if (worker?.id) loadData()
  }, [worker?.id])

  const loadData = async () => {
    if (!worker?.id) return
    try {
      const [toolsRes, pendingRes] = await Promise.all([
        supabase
          .from('tools')
          .select('id, name, type, serial_number, last_seen_location, contractor:contractor_id(name, company)')
          .eq('current_responsible_id', worker.id),
        supabase
          .from('tool_transfers')
          .select('id', { count: 'exact' })
          .eq('to_user_id', worker.id)
          .eq('status', 'pending'),
      ])

      setTools(toolsRes.data || [])
      setPendingCount(pendingRes.count || 0)
    } catch (err) {
      console.error('Error loading worker data:', err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  const handleRefresh = () => {
    setRefreshing(true)
    loadData()
  }

  const openMap = (lat: number, lon: number) => {
    Linking.openURL(`https://maps.google.com/?q=${lat},${lon}`)
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#0F172A' }}>
      {/* Header */}
      <View style={{ paddingHorizontal: 20, paddingTop: 56, paddingBottom: 20 }}>
        <Text style={{ fontSize: 22, fontWeight: '800', color: 'white', letterSpacing: -0.5 }}>
          Minhas Ferramentas
        </Text>
        <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>
          {worker?.name || worker?.phone} · {tools.length} sob custódia
        </Text>
      </View>

      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator color="#2563EB" size="large" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#2563EB" />}
        >
          {/* Pending transfers banner */}
          {pendingCount > 0 && (
            <TouchableOpacity
              onPress={() => router.push('/(worker)/transfers')}
              style={{
                backgroundColor: '#1D4ED8', borderRadius: 12, padding: 14,
                flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16,
              }}
            >
              <View style={{
                width: 28, height: 28, borderRadius: 14,
                backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center',
              }}>
                <Text style={{ color: 'white', fontWeight: '800', fontSize: 13 }}>{pendingCount}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: 'white', fontWeight: '700', fontSize: 14 }}>
                  Transferência pendente
                </Text>
                <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>
                  Toque para aceitar ou rejeitar
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.6)" />
            </TouchableOpacity>
          )}

          {tools.length === 0 ? (
            <View style={{ alignItems: 'center', paddingTop: 60 }}>
              <Text style={{ fontSize: 40, marginBottom: 16 }}>🔨</Text>
              <Text style={{ color: 'white', fontWeight: '700', fontSize: 16, marginBottom: 8 }}>
                Nenhuma ferramenta
              </Text>
              <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, textAlign: 'center', lineHeight: 20 }}>
                Aguarde um contratante transferir ferramentas para você
              </Text>
            </View>
          ) : (
            tools.map(tool => (
              <View
                key={tool.id}
                style={{
                  backgroundColor: '#1E293B', borderRadius: 14, padding: 18,
                  marginBottom: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)',
                }}
              >
                {/* Tool header */}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: 'white', fontWeight: '700', fontSize: 16 }}>{tool.name}</Text>
                    <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, marginTop: 2 }}>
                      {tool.type}{tool.serial_number ? ` · #${tool.serial_number}` : ''}
                    </Text>
                  </View>
                  {tool.contractor && (
                    <View style={{
                      paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8,
                      backgroundColor: 'rgba(37,99,235,0.15)',
                    }}>
                      <Text style={{ color: '#60A5FA', fontSize: 11, fontWeight: '600' }}>
                        {tool.contractor.company}
                      </Text>
                    </View>
                  )}
                </View>

                {/* Last location */}
                {tool.last_seen_location ? (
                  <TouchableOpacity
                    onPress={() => openMap(tool.last_seen_location!.latitude, tool.last_seen_location!.longitude)}
                    style={{
                      backgroundColor: '#0F172A', borderRadius: 10, padding: 12,
                      flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12,
                    }}
                  >
                    <Ionicons name="location" size={16} color="#2563EB" />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, lineHeight: 18 }}>
                        {tool.last_seen_location.address || `${tool.last_seen_location.latitude.toFixed(5)}, ${tool.last_seen_location.longitude.toFixed(5)}`}
                      </Text>
                    </View>
                    <Ionicons name="open-outline" size={14} color="rgba(255,255,255,0.3)" />
                  </TouchableOpacity>
                ) : (
                  <View style={{
                    backgroundColor: '#0F172A', borderRadius: 10, padding: 12,
                    flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12,
                  }}>
                    <Ionicons name="location-outline" size={16} color="rgba(255,255,255,0.2)" />
                    <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>Sem localização registrada</Text>
                  </View>
                )}

                {/* Transfer button */}
                <TouchableOpacity
                  onPress={() => router.push({ pathname: '/(worker)/transfers', params: { toolId: tool.id, toolName: tool.name } })}
                  style={{
                    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
                    borderRadius: 10, paddingVertical: 10, alignItems: 'center',
                    flexDirection: 'row', justifyContent: 'center', gap: 6,
                  }}
                >
                  <Ionicons name="swap-horizontal" size={15} color="rgba(255,255,255,0.5)" />
                  <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, fontWeight: '600' }}>
                    Transferir custódia
                  </Text>
                </TouchableOpacity>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </View>
  )
}
