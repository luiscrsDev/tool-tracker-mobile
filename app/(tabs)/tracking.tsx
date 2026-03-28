import { useState, useEffect, useCallback } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  Linking,
  ActivityIndicator,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect } from '@react-navigation/native'
import { useTools } from '@/context/ToolsContext'
import { useTags } from '@/context/TagsContext'
import { useLocation } from '@/context/LocationContext'
import { useAuth } from '@/context/AuthContext'
import { useBluetooth } from '@/context/BluetoothContext'
import { LocationService } from '@/lib/location'

export default function TrackingScreen() {
  const { tools, refreshTools } = useTools()
  const { getTagById } = useTags()
  const { trackedTools, startTracking, stopTracking, loadLastKnownLocations, getToolLastLocation } = useLocation()
  const { contractor } = useAuth()
  const { playTuyaSound } = useBluetooth()
  const [loading, setLoading] = useState(false)
  const [beepingId, setBeepingId] = useState<string | null>(null)

  // Atualiza ferramentas sempre que a aba recebe foco (garante tag_id atualizado)
  useFocusEffect(
    useCallback(() => {
      if (contractor?.id) {
        refreshTools(contractor.id)
      }
    }, [contractor?.id]),
  )

  // Load last known locations when screen opens or tools change
  useEffect(() => {
    if (tools.length > 0) {
      console.log(`📍 Loading last locations for ${tools.length} tools`)
      loadLastKnownLocations(tools.map(t => t.id))
    }
  }, [tools, loadLastKnownLocations])

  // Refresh BLE tool locations from Supabase every 30s
  useEffect(() => {
    if (tools.length === 0) return
    const interval = setInterval(() => {
      loadLastKnownLocations(tools.map(t => t.id))
    }, 30000)
    return () => clearInterval(interval)
  }, [tools, loadLastKnownLocations])

  const handleStartTracking = async (toolId: string, toolName: string) => {
    try {
      setLoading(true)
      console.log(`🔍 Starting tracking for: ${toolName}`)
      const tool = tools.find(t => t.id === toolId)
      const tag = tool?.assigned_tag ? getTagById(tool.assigned_tag) : null
      await startTracking(toolId, toolName, contractor?.id || '', tag?.tag_id || undefined)
      Alert.alert('Sucesso', `Rastreamento iniciado para ${toolName}`)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Erro desconhecido'
      console.error(`❌ Tracking error for ${toolName}:`, errorMsg)
      Alert.alert('Erro ao Rastrear', errorMsg || 'Falha ao iniciar rastreamento. Verifique as permissões de localização.')
    } finally {
      setLoading(false)
    }
  }

  const handleStopTracking = async (toolId: string, toolName: string) => {
    Alert.alert(
      'Parar Rastreamento?',
      `Deseja parar de rastrear ${toolName}?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Parar',
          style: 'destructive',
          onPress: async () => {
            try {
              await stopTracking(toolId)
              Alert.alert('Sucesso', 'Rastreamento parado')
            } catch {
              Alert.alert('Erro', 'Falha ao parar rastreamento')
            }
          },
        },
      ],
    )
  }

  const handleOpenMap = (toolId: string) => {
    const tool = trackedTools.find(t => t.id === toolId)
    if (tool?.location) {
      const url = LocationService.getLocationUrl(tool.location.latitude, tool.location.longitude)
      Linking.openURL(url)
    }
  }

  const renderToolCard = (tool: any) => {
    const tracked = trackedTools.find(t => t.id === tool.id)
    const lastLocation = tracked?.location || getToolLastLocation(tool.id)

    return (
      <View
        key={tool.id}
        style={{
          backgroundColor: '#fff',
          borderRadius: 8,
          padding: 16,
          marginBottom: 12,
          borderLeftWidth: 4,
          borderLeftColor: tracked ? '#10b981' : lastLocation ? '#3b82f6' : '#ccc',
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: 12,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 16, fontWeight: '600', marginBottom: 4 }}>
              {tool.name}
            </Text>
            <Text style={{ color: '#666', fontSize: 13 }}>{tool.type}</Text>
          </View>
          <View
            style={{
              paddingHorizontal: 8,
              paddingVertical: 4,
              borderRadius: 4,
              backgroundColor: tracked ? '#d1fae5' : lastLocation ? '#dbeafe' : '#f3f4f6',
            }}
          >
            <Text
              style={{
                color: tracked ? '#065f46' : lastLocation ? '#1e40af' : '#6b7280',
                fontSize: 11,
                fontWeight: '600',
              }}
            >
              {tracked ? '🟢 Rastreando' : lastLocation ? '🔵 Última Posição' : '⚪ Inativo'}
            </Text>
          </View>
        </View>

        {lastLocation && (
          <View
            style={{
              backgroundColor: tracked ? '#f0fdf4' : '#f0f9ff',
              paddingHorizontal: 12,
              paddingVertical: 10,
              borderRadius: 6,
              marginBottom: 12,
            }}
          >
            <Text style={{ fontSize: 12, color: tracked ? '#065f46' : '#1e40af', marginBottom: 4 }}>
              📍 {LocationService.formatLocation(lastLocation)}
            </Text>
            <Text style={{ fontSize: 11, color: tracked ? '#16a34a' : '#1e40af' }}>
              Precisão: {lastLocation.accuracy.toFixed(1)}m
            </Text>
            {lastLocation.speed !== null && (
              <Text style={{ fontSize: 11, color: tracked ? '#16a34a' : '#1e40af', marginTop: 2 }}>
                Velocidade: {(lastLocation.speed * 3.6).toFixed(1)} km/h
              </Text>
            )}
            <Text
              style={{ fontSize: 10, color: '#6b7280', marginTop: 4 }}>
              Atualizado em: {new Date(lastLocation.timestamp).toLocaleTimeString('pt-BR')}
            </Text>
          </View>
        )}

        <View style={{ flexDirection: 'row', gap: 8 }}>
          {!tracked ? (
            <TouchableOpacity
              onPress={() => handleStartTracking(tool.id, tool.name)}
              disabled={loading}
              style={{
                flex: 1,
                paddingVertical: 10,
                borderRadius: 6,
                backgroundColor: '#10b981',
                alignItems: 'center',
              }}
            >
              <Text style={{ color: '#fff', fontWeight: '600', fontSize: 12 }}>
                Rastrear
              </Text>
            </TouchableOpacity>
          ) : (
            <>
              <TouchableOpacity
                onPress={() => handleOpenMap(tool.id)}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  borderRadius: 6,
                  borderWidth: 1,
                  borderColor: '#10b981',
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: '#10b981', fontWeight: '600', fontSize: 12 }}>
                  Ver Mapa
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => handleStopTracking(tool.id, tool.name)}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  borderRadius: 6,
                  backgroundColor: '#ef4444',
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: '#fff', fontWeight: '600', fontSize: 12 }}>
                  Parar
                </Text>
              </TouchableOpacity>
            </>
          )}

          {/* Beep — só aparece para ferramentas com tag BLE pareado */}
          {(() => {
            const toolTag = tool.assigned_tag ? getTagById(tool.assigned_tag) : null
            if (!toolTag) return null
            const bleId = toolTag.tag_id
            return (
              <TouchableOpacity
                onPress={async () => {
                  setBeepingId(bleId)
                  await playTuyaSound(bleId)
                  setBeepingId(null)
                }}
                disabled={beepingId === bleId}
                style={{
                  width: 42,
                  paddingVertical: 10,
                  borderRadius: 6,
                  borderWidth: 1,
                  borderColor: beepingId === bleId ? '#f59e0b' : '#d1d5db',
                  backgroundColor: beepingId === bleId ? '#fef3c7' : 'transparent',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {beepingId === bleId
                  ? <ActivityIndicator size="small" color="#f59e0b" />
                  : <Ionicons name="volume-high" size={18} color="#6b7280" />
                }
              </TouchableOpacity>
            )
          })()}
        </View>
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#f5f5f5' }}>
      {/* Header */}
      <View
        style={{
          backgroundColor: '#fff',
          paddingHorizontal: 16,
          paddingVertical: 16,
          borderBottomWidth: 1,
          borderBottomColor: '#eee',
        }}
      >
        <Text style={{ fontSize: 24, fontWeight: 'bold' }}>📍 Rastreamento</Text>
        <Text style={{ color: '#666', fontSize: 13, marginTop: 4 }}>
          {trackedTools.length === 0
            ? 'Selecione uma ferramenta para começar'
            : `${trackedTools.length} ferramenta${trackedTools.length !== 1 ? 's' : ''} em rastreamento`}
        </Text>
      </View>

      {/* Content */}
      {tools.length === 0 ? (
        <View
          style={{
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
            paddingHorizontal: 32,
          }}
        >
          <Text style={{ fontSize: 40, marginBottom: 16 }}>🔨</Text>
          <Text style={{ fontSize: 16, fontWeight: '600', color: '#333', marginBottom: 8 }}>
            Nenhuma ferramenta cadastrada
          </Text>
          <Text style={{ color: '#666', fontSize: 13, textAlign: 'center', lineHeight: 20 }}>
            Cadastre ferramentas primeiro para começar a rastrear
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 16 }}>
          {tools.map(tool => renderToolCard(tool))}

          {trackedTools.length > 0 && (
            <View
              style={{
                backgroundColor: '#dbeafe',
                paddingHorizontal: 12,
                paddingVertical: 10,
                borderRadius: 8,
                marginTop: 12,
              }}
            >
              <Text style={{ fontSize: 12, color: '#1e40af', fontWeight: '600' }}>
                ℹ️ Os dados de localização são atualizados a cada 5 metros de movimento
              </Text>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  )
}
