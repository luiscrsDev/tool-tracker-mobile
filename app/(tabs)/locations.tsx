import { useState, useEffect } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  Linking,
  FlatList,
} from 'react-native'
import { useTools } from '@/context/ToolsContext'
import { useLocation } from '@/context/LocationContext'
import { LocationService } from '@/lib/location'

export default function LocationsScreen() {
  const { tools } = useTools()
  const { allToolLocations, loadLastKnownLocations } = useLocation()
  const [loading, setLoading] = useState(false)

  // Load last known locations when screen opens or tools change
  useEffect(() => {
    if (tools.length > 0) {
      setLoading(true)
      loadLastKnownLocations(tools.map(t => t.id))
        .finally(() => setLoading(false))
    }
  }, [tools])

  const toolsWithLocation = tools.filter(tool => {
    const location = allToolLocations.get(tool.id)
    return location !== null && location !== undefined
  })

  const handleOpenMap = (toolId: string) => {
    const location = allToolLocations.get(toolId)
    if (location) {
      const url = LocationService.getLocationUrl(location.latitude, location.longitude)
      Linking.openURL(url)
    }
  }

  const renderLocationItem = (tool: any) => {
    const location = allToolLocations.get(tool.id)
    if (!location) return null

    return (
      <View
        key={tool.id}
        style={{
          backgroundColor: '#fff',
          borderRadius: 8,
          padding: 14,
          marginBottom: 10,
          borderLeftWidth: 4,
          borderLeftColor: '#3b82f6',
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: 10,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 15, fontWeight: '600', marginBottom: 2 }}>
              {tool.name}
            </Text>
            <Text style={{ color: '#666', fontSize: 12 }}>{tool.type}</Text>
          </View>
          <View
            style={{
              paddingHorizontal: 8,
              paddingVertical: 4,
              borderRadius: 4,
              backgroundColor: '#dbeafe',
            }}
          >
            <Text style={{ color: '#1e40af', fontSize: 10, fontWeight: '600' }}>
              🔵 Localizado
            </Text>
          </View>
        </View>

        <View
          style={{
            backgroundColor: '#f0f9ff',
            paddingHorizontal: 12,
            paddingVertical: 10,
            borderRadius: 6,
            marginBottom: 10,
          }}
        >
          <Text
            style={{ fontSize: 12, color: '#1e40af', marginBottom: 4, fontWeight: '600' }}
          >
            📍 {LocationService.formatLocation(location)}
          </Text>
          {location.accuracy && (
            <Text style={{ fontSize: 11, color: '#1e40af', marginBottom: 2 }}>
              Precisão: ±{location.accuracy.toFixed(1)}m
            </Text>
          )}
          {location.address && (
            <Text style={{ fontSize: 11, color: '#1e40af', marginBottom: 2 }}>
              📮 {location.address}
            </Text>
          )}
          <Text style={{ fontSize: 10, color: '#6b7280', marginTop: 4 }}>
            {new Date(location.timestamp).toLocaleString('pt-BR')}
          </Text>
        </View>

        <TouchableOpacity
          onPress={() => handleOpenMap(tool.id)}
          style={{
            paddingVertical: 10,
            paddingHorizontal: 12,
            borderRadius: 6,
            borderWidth: 1,
            borderColor: '#3b82f6',
            alignItems: 'center',
          }}
        >
          <Text style={{ color: '#3b82f6', fontWeight: '600', fontSize: 12 }}>
            Ver no Mapa
          </Text>
        </TouchableOpacity>
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
        <Text style={{ fontSize: 24, fontWeight: 'bold' }}>📍 Últimas Localizações</Text>
        <Text style={{ color: '#666', fontSize: 13, marginTop: 4 }}>
          {toolsWithLocation.length} ferramenta{toolsWithLocation.length !== 1 ? 's' : ''} com localização
        </Text>
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
          <Text style={{ fontSize: 16, color: '#666' }}>Carregando localizações...</Text>
        </View>
      ) : toolsWithLocation.length === 0 ? (
        <View
          style={{
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
            paddingHorizontal: 32,
          }}
        >
          <Text style={{ fontSize: 40, marginBottom: 16 }}>📍</Text>
          <Text style={{ fontSize: 16, fontWeight: '600', color: '#333', marginBottom: 8 }}>
            Nenhuma localização registrada
          </Text>
          <Text style={{ color: '#666', fontSize: 13, textAlign: 'center', lineHeight: 20 }}>
            Ferramentas rastreadas aparecerão aqui
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 16 }}>
          {toolsWithLocation.map(tool => renderLocationItem(tool))}
        </ScrollView>
      )}
    </View>
  )
}
