import { useEffect, useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  RefreshControl,
  Image,
} from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '@/context/AuthContext'
import { useTools } from '@/context/ToolsContext'

export default function ToolsScreen() {
  const router = useRouter()
  const { contractor } = useAuth()
  const { tools, loading, refreshTools, deleteTool } = useTools()
  const [refreshing, setRefreshing] = useState(false)
  const [filterBy, setFilterBy] = useState<'all' | 'connected' | 'disconnected'>('all')

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

  const filteredTools = tools.filter(tool => {
    if (filterBy === 'connected') return !!tool.assigned_tag
    if (filterBy === 'disconnected') return !!!tool.assigned_tag
    return true
  })

  const handleDeleteTool = (toolId: string, toolName: string) => {
    Alert.alert('Deletar Ferramenta?', `Tem certeza que deseja deletar "${toolName}"?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Deletar',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteTool(toolId)
            Alert.alert('Sucesso', 'Ferramenta deletada')
          } catch {
            Alert.alert('Erro', 'Falha ao deletar ferramenta')
          }
        },
      },
    ])
  }

  const renderToolCard = (tool: any) => (
    <TouchableOpacity
      key={tool.id}
      style={{
        backgroundColor: '#fff',
        borderRadius: 12,
        padding: 14,
        marginBottom: 10,
        borderLeftWidth: 3,
        borderLeftColor: !!tool.assigned_tag ? '#10b981' : '#ef4444',
        flexDirection: 'row',
        alignItems: 'center',
      }}
      onPress={() => router.push(`/(tabs)/tool-detail?toolId=${tool.id}`)}
    >
      {/* Thumbnail */}
      {tool.images && tool.images.length > 0 ? (
        <Image
          source={{ uri: tool.images[0] }}
          style={{ width: 48, height: 48, borderRadius: 8, marginRight: 12 }}
        />
      ) : (
        <View
          style={{
            width: 48,
            height: 48,
            borderRadius: 8,
            backgroundColor: '#f0f0f0',
            justifyContent: 'center',
            alignItems: 'center',
            marginRight: 12,
          }}
        >
          <Text style={{ fontSize: 22 }}>{'\uD83D\uDD27'}</Text>
        </View>
      )}

      {/* Info */}
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontSize: 15, fontWeight: '600', flex: 1 }}>{tool.name}</Text>
          <View style={{
            paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
            backgroundColor: !!tool.assigned_tag ? '#d1fae5' : '#fee2e2',
          }}>
            <Text style={{ color: !!tool.assigned_tag ? '#065f46' : '#991b1b', fontSize: 10, fontWeight: '600' }}>
              {!!tool.assigned_tag ? '\uD83D\uDFE2' : '\uD83D\uDD34'}
            </Text>
          </View>
        </View>
        <Text style={{ color: '#666', fontSize: 12, marginTop: 2 }}>{tool.type}</Text>
        {tool.last_seen_location?.latitude ? (
          <Text style={{ color: '#999', fontSize: 11, fontStyle: 'italic', marginTop: 2 }}>
            {`${tool.last_seen_location.latitude.toFixed(4)}, ${tool.last_seen_location.longitude.toFixed(4)}`}
          </Text>
        ) : null}
      </View>

      {/* Chevron */}
      <Ionicons name="chevron-forward" size={18} color="#ccc" style={{ marginLeft: 8 }} />
    </TouchableOpacity>
  )

  return (
    <View style={{ flex: 1, backgroundColor: '#f5f5f5' }}>
      {/* Header */}
      <View
        style={{
          backgroundColor: '#fff',
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: 12,
          borderBottomWidth: 1,
          borderBottomColor: '#eee',
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
          }}
        >
          <Text style={{ fontSize: 24, fontWeight: 'bold' }}>
            🔨 Ferramentas
          </Text>
          <TouchableOpacity
            onPress={() => {
              router.push('/(tabs)/tool-form')
            }}
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: '#2563eb',
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <Text style={{ color: '#fff', fontSize: 20, fontWeight: '600' }}>
              +
            </Text>
          </TouchableOpacity>
        </View>

        {/* Filters */}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {(['all', 'connected', 'disconnected'] as const).map(filter => (
            <TouchableOpacity
              key={filter}
              onPress={() => setFilterBy(filter)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 6,
                borderWidth: 1,
                borderColor: filterBy === filter ? '#2563eb' : '#ddd',
                backgroundColor: filterBy === filter ? '#eff6ff' : '#fff',
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {filter === 'connected' && (
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#10b981' }} />
                )}
                {filter === 'disconnected' && (
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#ef4444' }} />
                )}
                <Text
                  style={{
                    color: filterBy === filter ? '#2563eb' : '#666',
                    fontSize: 12,
                    fontWeight: '600',
                  }}
                >
                  {filter === 'all' ? 'Todas' : filter === 'connected' ? 'Conectadas' : 'Desconectadas'}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Content */}
      {loading ? (
        <View
          style={{
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <ActivityIndicator color="#2563eb" size="large" />
          <Text style={{ color: '#666', marginTop: 12, fontSize: 14 }}>
            Carregando ferramentas...
          </Text>
        </View>
      ) : filteredTools.length > 0 ? (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 16 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
          }
        >
          {filteredTools.map(tool => renderToolCard(tool))}
        </ScrollView>
      ) : (
        <View
          style={{
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
            paddingHorizontal: 32,
          }}
        >
          <Ionicons name="construct-outline" size={64} color="#cbd5e1" style={{ marginBottom: 16 }} />
          <Text style={{ fontSize: 18, fontWeight: '700', color: '#333', marginBottom: 8 }}>
            Nenhuma ferramenta encontrada
          </Text>
          <Text style={{ color: '#94a3b8', fontSize: 14, textAlign: 'center', lineHeight: 22, marginBottom: 24 }}>
            {filterBy === 'all'
              ? 'Você ainda não tem ferramentas cadastradas'
              : `Nenhuma ferramenta ${
                  filterBy === 'connected' ? 'conectada' : 'desconectada'
                } no momento`}
          </Text>
          <TouchableOpacity
            onPress={() => router.push('/(tabs)/tool-form')}
            style={{
              backgroundColor: '#2563eb',
              paddingHorizontal: 24,
              paddingVertical: 12,
              borderRadius: 8,
            }}
          >
            <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600' }}>
              Adicionar Ferramenta
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  )
}
