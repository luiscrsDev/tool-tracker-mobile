import { useEffect, useState } from 'react'
import { View, Text, TouchableOpacity, ScrollView, Alert, ActivityIndicator, RefreshControl } from 'react-native'
import { useRouter } from 'expo-router'
import { useAuth } from '@/context/AuthContext'
import { useTools } from '@/context/ToolsContext'

export default function DashboardScreen() {
  const router = useRouter()
  const { contractor, admin, signOut } = useAuth()
  const { tools, loading, refreshTools } = useTools()
  const [refreshing, setRefreshing] = useState(false)

  // Load tools on mount
  useEffect(() => {
    if (contractor?.id) {
      refreshTools(contractor.id)
    }
  }, [contractor?.id])

  const handleRefresh = async () => {
    if (!contractor?.id) return
    setRefreshing(true)
    await refreshTools(contractor.id)
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

  // Calculate stats
  const connectedCount = tools.filter(t => t.is_connected).length
  const lowBatteryCount = tools.filter(t => t.battery && t.battery < 20).length

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: '#f5f5f5' }}
      contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 24 }}
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
            🔨 Tool Tracker
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
          marginBottom: 20,
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

      {/* Status Cards */}
      <View style={{ marginBottom: 20 }}>
        <Text style={{ fontSize: 16, fontWeight: '600', marginBottom: 12 }}>
          Estatísticas
        </Text>

        {/* Total */}
        <View
          style={{
            backgroundColor: '#fff',
            borderRadius: 8,
            padding: 16,
            marginBottom: 12,
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
            marginBottom: 12,
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

      {/* Recent Tools */}
      {!loading && tools.length > 0 && (
        <View style={{ marginBottom: 20 }}>
          <Text style={{ fontSize: 16, fontWeight: '600', marginBottom: 12 }}>
            Ferramentas Recentes
          </Text>

          {tools.slice(0, 3).map(tool => (
            <View
              key={tool.id}
              style={{
                backgroundColor: '#fff',
                borderRadius: 8,
                padding: 12,
                marginBottom: 8,
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '600', fontSize: 14 }}>
                  {tool.name}
                </Text>
                <Text style={{ color: '#666', fontSize: 12, marginTop: 2 }}>
                  {tool.type}
                </Text>
              </View>

              <View style={{ alignItems: 'flex-end' }}>
                <View
                  style={{
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                    borderRadius: 4,
                    backgroundColor: tool.is_connected ? '#d1fae5' : '#fee2e2',
                    marginBottom: 4,
                  }}
                >
                  <Text
                    style={{
                      color: tool.is_connected ? '#065f46' : '#991b1b',
                      fontSize: 11,
                      fontWeight: '600',
                    }}
                  >
                    {tool.is_connected ? '🟢 Conectada' : '🔴 Desconectada'}
                  </Text>
                </View>

                {tool.battery && (
                  <Text
                    style={{
                      color: tool.battery < 20 ? '#991b1b' : '#666',
                      fontSize: 11,
                    }}
                  >
                    🔋 {tool.battery}%
                  </Text>
                )}
              </View>
            </View>
          ))}

          {tools.length > 3 && (
            <TouchableOpacity
              onPress={() => router.push('/(tabs)/tools')}
              style={{
                paddingVertical: 12,
                paddingHorizontal: 16,
                borderRadius: 8,
                backgroundColor: '#eff6ff',
                alignItems: 'center',
              }}
            >
              <Text style={{ color: '#2563eb', fontWeight: '600', fontSize: 13 }}>
                Ver todas as {tools.length} ferramentas →
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Empty State */}
      {!loading && tools.length === 0 && (
        <View
          style={{
            backgroundColor: '#eff6ff',
            borderRadius: 8,
            padding: 24,
            alignItems: 'center',
          }}
        >
          <Text style={{ fontSize: 32, marginBottom: 8 }}>🔨</Text>
          <Text style={{ fontSize: 16, fontWeight: '600', color: '#2563eb', marginBottom: 4 }}>
            Nenhuma ferramenta cadastrada
          </Text>
          <Text style={{ color: '#1e40af', fontSize: 13, textAlign: 'center' }}>
            Vá para a aba Ferramentas para adicionar sua primeira ferramenta
          </Text>
        </View>
      )}
    </ScrollView>
  )
}
