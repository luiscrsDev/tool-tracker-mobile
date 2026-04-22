import { useEffect, useState, useCallback } from 'react'
import { View, Text, TouchableOpacity, ScrollView, Alert, ActivityIndicator, RefreshControl, Linking, Platform } from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import * as Location from 'expo-location'
import { BleManager } from 'react-native-ble-plx'
import { useAuth } from '@/context/AuthContext'
import { useTools } from '@/context/ToolsContext'
import { useTags } from '@/context/TagsContext'
import { startBackgroundTracking } from '@/lib/backgroundTracking'
import { addTrackerToMonitor } from '@/lib/bleMonitoring'
import { supabase } from '@/lib/supabase'
import { useSites } from '@/context/SitesContext'
import * as BleTracker from '@/modules/expo-ble-tracker/src'

type Movement = {
  id: string
  tool_id: string
  event: string
  latitude: number
  longitude: number
  created_at: string
}

const EVENT_CONFIG: Record<string, { icon: string; label: string }> = {
  movement: { icon: '➡️', label: 'Em movimento' },
  stop: { icon: '📍', label: 'Parou' },
  speed: { icon: '🚗', label: 'Em trânsito' },
  checkout: { icon: '🚪', label: 'Saiu' },
}

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function DashboardScreen() {
  const router = useRouter()
  const { contractor, admin, signOut } = useAuth()
  const { tools, loading, refreshTools } = useTools()
  const { tags, refreshTags, getTagById } = useTags()
  const { resolveLocationAsync } = useSites()
  const [refreshing, setRefreshing] = useState(false)
  const [recentMovements, setRecentMovements] = useState<Movement[]>([])
  const [movementAddresses, setMovementAddresses] = useState<Map<string, string>>(new Map())
  const [missingPermissions, setMissingPermissions] = useState<string[]>([])

  // Check permissions on mount
  useEffect(() => {
    const checkPermissions = async () => {
      const missing: string[] = []

      // Check foreground location
      const { status: fgStatus } = await Location.getForegroundPermissionsAsync()
      if (fgStatus !== 'granted') {
        missing.push('Localização')
      } else {
        // Check background location
        const { status: bgStatus } = await Location.getBackgroundPermissionsAsync()
        if (bgStatus !== 'granted') {
          missing.push('Localização em segundo plano')
        }
      }

      // Check Bluetooth
      try {
        const ble = new BleManager()
        const state = await ble.state()
        if (state !== 'PoweredOn') {
          missing.push('Bluetooth')
        }
        ble.destroy()
      } catch {
        missing.push('Bluetooth')
      }

      setMissingPermissions(missing)
    }
    checkPermissions()

    // Re-check when app returns from settings
    const interval = setInterval(checkPermissions, 5000)
    return () => clearInterval(interval)
  }, [])

  const fetchRecentMovements = useCallback(async () => {
    const cid = contractor?.id
    if (!cid) return
    const { data } = await supabase
      .from('tool_movements')
      .select('id, tool_id, event, latitude, longitude, created_at')
      .eq('contractor_id', cid)
      .order('created_at', { ascending: false })
      .limit(3)
    if (data) {
      setRecentMovements(data)
      // Resolve addresses
      const map = new Map<string, string>()
      for (const m of data) {
        const addr = await resolveLocationAsync(m.latitude, m.longitude)
        map.set(m.id, addr)
      }
      setMovementAddresses(map)
    }
  }, [resolveLocationAsync])

  // Load tools and tags on mount + start background tracking
  useEffect(() => {
    if (contractor?.id) {
      refreshTools(contractor.id)
      refreshTags(contractor.id)
      fetchRecentMovements()
      // Auto-start background tracking (foreground service + BLE)
      startBackgroundTracking().then(ok => {
        if (ok) console.log('[Dashboard] Background tracking ativo')
      })
    }
  }, [contractor?.id])

  // Auto-refresh activity feed every 30s
  useEffect(() => {
    if (!contractor?.id) return
    const interval = setInterval(fetchRecentMovements, 30000)
    return () => clearInterval(interval)
  }, [contractor?.id, fetchRecentMovements])

  // Auto-register tagged tools in BLE monitor + native service
  useEffect(() => {
    if (tools.length === 0 || tags.length === 0) return
    let count = 0

    // Configure native BLE tracker service
    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
    if (supabaseUrl && supabaseKey) {
      try {
        BleTracker.configure(supabaseUrl, supabaseKey)
        BleTracker.clearTags()
      } catch (e) {
        console.warn('[Dashboard] Native BLE tracker not available:', (e as Error)?.message)
      }
    }

    for (const tool of tools) {
      if (!tool.assigned_tag) continue
      const tag = getTagById(tool.assigned_tag)
      if (!tag) continue

      // JS-level BLE monitor (works when app is open)
      addTrackerToMonitor(tag.tag_id, {
        toolId: tool.id,
        toolName: tool.name,
        contractorId: tool.contractor_id,
      })

      // Native-level BLE tracker (works in background)
      try {
        BleTracker.addTag(tag.tag_id, tool.id, tool.name, tool.contractor_id)
      } catch { /* native module not available */ }

      count++
    }

    // Start native service
    if (count > 0) {
      try {
        BleTracker.startService()
        console.log(`[Dashboard] Native BLE service started with ${count} tags`)
      } catch (e) {
        console.warn('[Dashboard] Native BLE service failed:', (e as Error)?.message)
      }
      console.log(`[Dashboard] Auto-registered ${count} tagged tools for BLE monitoring`)
    }
  }, [tools, tags])

  const handleRefresh = async () => {
    if (!contractor?.id) return
    setRefreshing(true)
    await Promise.all([refreshTools(contractor.id), fetchRecentMovements()])
    setRefreshing(false)
  }

  const handleLogout = async () => {
    Alert.alert('Sair', 'Tem certeza que deseja sair?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Sair',
        style: 'destructive',
        onPress: async () => {
          try {
            await signOut()
            router.replace('/(auth)/login')
          } catch {
            Alert.alert('Erro', 'Falha ao sair')
          }
        },
      },
    ])
  }

  const getToolName = (toolId: string): string => {
    const tool = tools.find(t => t.id === toolId)
    return tool?.name || 'Ferramenta desconhecida'
  }

  // Calculate stats
  const connectedCount = tools.filter(t => t.assigned_tag).length
  const lowBatteryCount = tools.filter(t => t.battery && t.battery < 20).length

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: '#f5f5f5' }}
      contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 24 }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
      }
    >
      {/* Header */}
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 24,
        }}
      >
        <View>
          <Text style={{ fontSize: 28, fontWeight: 'bold' }}>
            🔨 Locate Tool
          </Text>
          <Text style={{ fontSize: 14, color: '#666', marginTop: 4 }}>
            {contractor?.company?.toUpperCase() || 'Admin'}
          </Text>
        </View>

        <TouchableOpacity
          onPress={handleLogout}
          style={{
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: 6,
            backgroundColor: '#fee2e2',
          }}
        >
          <Text style={{ color: '#991b1b', fontWeight: '600', fontSize: 12 }}>
            Sair
          </Text>
        </TouchableOpacity>
      </View>

      {/* User Info */}
      <View
        style={{
          backgroundColor: '#fff',
          borderRadius: 8,
          padding: 16,
          marginBottom: 16,
          borderLeftWidth: 4,
          borderLeftColor: '#2563eb',
        }}
      >
        <Text style={{ fontSize: 12, color: '#999', marginBottom: 4 }}>
          Usuário
        </Text>
        <Text style={{ fontSize: 18, fontWeight: '600' }}>
          {contractor?.name || admin?.name || 'N/A'}
        </Text>
        <Text style={{ fontSize: 13, color: '#666', marginTop: 6 }}>
          {contractor?.email || admin?.email || 'N/A'}
        </Text>
      </View>

      {/* Permission Warning Banner */}
      {missingPermissions.length > 0 && (
        <TouchableOpacity
          onPress={() => {
            Alert.alert(
              'Permissoes Necessarias',
              `Para rastrear suas ferramentas, o app precisa de:\n\n${missingPermissions.map(p => `• ${p}`).join('\n')}\n\nDeseja abrir as configuracoes?`,
              [
                { text: 'Depois', style: 'cancel' },
                { text: 'Abrir Configuracoes', onPress: () => Linking.openSettings() },
              ],
            )
          }}
          style={{
            backgroundColor: '#FEF2F2',
            borderRadius: 12,
            padding: 14,
            marginBottom: 16,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            borderWidth: 1,
            borderColor: '#FECACA',
          }}
        >
          <Ionicons name="warning" size={24} color="#EF4444" />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: '#991B1B' }}>
              Permissoes pendentes
            </Text>
            <Text style={{ fontSize: 11, color: '#DC2626', marginTop: 2 }}>
              {missingPermissions.join(', ')} — toque para configurar
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color="#EF4444" />
        </TouchableOpacity>
      )}

      {/* Quick Action Buttons */}
      <View
        style={{
          flexDirection: 'row',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <TouchableOpacity
          onPress={() => router.push('/tool-form')}
          style={{
            flex: 1,
            backgroundColor: '#2563eb',
            borderRadius: 8,
            paddingVertical: 14,
            alignItems: 'center',
          }}
        >
          <Text style={{ color: '#fff', fontWeight: '600', fontSize: 14 }}>
            ＋ Adicionar Ferramenta
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => router.push('/airtag')}
          style={{
            flex: 1,
            backgroundColor: '#fff',
            borderRadius: 8,
            paddingVertical: 14,
            alignItems: 'center',
            borderWidth: 2,
            borderColor: '#10b981',
          }}
        >
          <Text style={{ color: '#10b981', fontWeight: '600', fontSize: 14 }}>
            📡 Escanear Tags
          </Text>
        </TouchableOpacity>
      </View>

      {/* Status Cards */}
      <View style={{ marginBottom: 16, gap: 12 }}>
        <Text style={{ fontSize: 16, fontWeight: '600', marginBottom: 4 }}>
          Estatísticas
        </Text>

        {/* Total */}
        <View
          style={{
            backgroundColor: '#fff',
            borderRadius: 8,
            padding: 16,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <Text style={{ color: '#666' }}>Total de Ferramentas</Text>
            <Text style={{ fontSize: 24, fontWeight: 'bold', color: '#2563eb' }}>
              {tools.length}
            </Text>
          </View>
        </View>

        {/* Conexão */}
        <View
          style={{
            backgroundColor: '#fff',
            borderRadius: 8,
            padding: 16,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12,
            }}
          >
            <Text style={{ color: '#666' }}>Status de Conexão</Text>
            <Text style={{ fontSize: 14, fontWeight: '600', color: '#666' }}>
              {connectedCount} de {tools.length}
            </Text>
          </View>
          <View
            style={{
              height: 8,
              backgroundColor: '#f0f0f0',
              borderRadius: 4,
              overflow: 'hidden',
            }}
          >
            <View
              style={{
                height: '100%',
                backgroundColor: '#10b981',
                width: `${tools.length > 0 ? (connectedCount / tools.length) * 100 : 0}%`,
              }}
            />
          </View>
        </View>

        {/* Bateria */}
        <View
          style={{
            backgroundColor: '#fff',
            borderRadius: 8,
            padding: 16,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12,
            }}
          >
            <Text style={{ color: '#666' }}>Ferramentas com Bateria Baixa</Text>
            <Text
              style={{
                fontSize: 14,
                fontWeight: '600',
                color: lowBatteryCount > 0 ? '#ef4444' : '#666',
              }}
            >
              {lowBatteryCount}
            </Text>
          </View>
          {lowBatteryCount > 0 && (
            <View
              style={{
                backgroundColor: '#fee2e2',
                paddingVertical: 8,
                paddingHorizontal: 10,
                borderRadius: 6,
              }}
            >
              <Text style={{ fontSize: 12, color: '#991b1b' }}>
                ⚠️ {lowBatteryCount} ferramenta{lowBatteryCount !== 1 ? 's' : ''} com bateria menor que 20%
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Activity Feed */}
      {recentMovements.length > 0 && (
        <View style={{ marginBottom: 16 }}>
          <Text style={{ fontSize: 16, fontWeight: '600', marginBottom: 12 }}>
            Atividade Recente
          </Text>
          <View style={{ backgroundColor: '#fff', borderRadius: 8, overflow: 'hidden' }}>
            {recentMovements.map((mov, idx) => (
              <View
                key={mov.id}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  padding: 14,
                  borderBottomWidth: idx < recentMovements.length - 1 ? 1 : 0,
                  borderBottomColor: '#f0f0f0',
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '600' }}>
                    {getToolName(mov.tool_id)}
                  </Text>
                  <Text style={{ fontSize: 12, color: '#666', marginTop: 2 }} numberOfLines={1}>
                    {movementAddresses.get(mov.id) || `${mov.latitude.toFixed(4)}, ${mov.longitude.toFixed(4)}`}
                  </Text>
                </View>
                <Text style={{ fontSize: 11, color: '#999' }}>
                  {formatDateTime(mov.created_at)}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Loading State */}
      {loading && !refreshing && (
        <View
          style={{
            backgroundColor: '#eff6ff',
            borderRadius: 8,
            padding: 16,
            alignItems: 'center',
          }}
        >
          <ActivityIndicator color="#2563eb" size="small" />
          <Text style={{ color: '#2563eb', marginTop: 8, fontSize: 13 }}>
            Carregando ferramentas...
          </Text>
        </View>
      )}

      {/* Empty State */}
      {!loading && tools.length === 0 && (
        <View
          style={{
            backgroundColor: '#eff6ff',
            borderRadius: 12,
            padding: 40,
            alignItems: 'center',
          }}
        >
          <View
            style={{
              width: 80,
              height: 80,
              borderRadius: 40,
              backgroundColor: '#dbeafe',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 16,
            }}
          >
            <Text style={{ fontSize: 40 }}>🔧</Text>
          </View>
          <Text
            style={{
              fontSize: 18,
              fontWeight: '700',
              color: '#1e40af',
              marginBottom: 8,
              textAlign: 'center',
            }}
          >
            Nenhuma ferramenta cadastrada
          </Text>
          <Text
            style={{
              color: '#3b82f6',
              fontSize: 14,
              textAlign: 'center',
              lineHeight: 20,
              marginBottom: 20,
              paddingHorizontal: 20,
            }}
          >
            Comece adicionando suas ferramentas para rastrear a localização em tempo real.
          </Text>
          <TouchableOpacity
            onPress={() => router.push('/tool-form')}
            style={{
              backgroundColor: '#2563eb',
              borderRadius: 8,
              paddingVertical: 12,
              paddingHorizontal: 24,
            }}
          >
            <Text style={{ color: '#fff', fontWeight: '600', fontSize: 15 }}>
              Adicionar Primeira Ferramenta
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  )
}
