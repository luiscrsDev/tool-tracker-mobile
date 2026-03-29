import { View, Text, ActivityIndicator, RefreshControl, FlatList } from 'react-native'
import { useState } from 'react'
import { useAdmin } from '@/context/AdminContext'

export default function AdminCRMScreen() {
  const { contractors, loading, refreshData } = useAdmin()
  const [refreshing, setRefreshing] = useState(false)

  const handleRefresh = async () => {
    setRefreshing(true)
    await refreshData()
    setRefreshing(false)
  }

  const renderContractor = ({ item }: { item: any }) => (
    <View
      style={{
        backgroundColor: '#fff',
        borderRadius: 8,
        padding: 16,
        marginBottom: 12,
        borderLeftWidth: 4,
        borderLeftColor: item.status === 'active' ? '#10b981' : '#ccc',
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 8,
        }}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 16, fontWeight: '600', marginBottom: 4 }}>
            {item.name}
          </Text>
          <Text style={{ color: '#666', fontSize: 12 }}>{item.email}</Text>
        </View>
        <View
          style={{
            paddingHorizontal: 8,
            paddingVertical: 4,
            borderRadius: 4,
            backgroundColor: item.status === 'active' ? '#d1fae5' : '#f3f4f6',
          }}
        >
          <Text
            style={{
              color: item.status === 'active' ? '#065f46' : '#6b7280',
              fontSize: 11,
              fontWeight: '600',
            }}
          >
            {item.status === 'active' ? '🟢 Ativo' : '⚪ Inativo'}
          </Text>
        </View>
      </View>

      {item.company && (
        <Text style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>
          🏢 {item.company}
        </Text>
      )}

      <View
        style={{
          paddingHorizontal: 12,
          paddingVertical: 8,
          backgroundColor: '#f3f4f6',
          borderRadius: 6,
        }}
      >
        <Text style={{ fontSize: 11, color: '#6b7280' }}>
          ID: {item.id.substring(0, 8)}...
        </Text>
      </View>
    </View>
  )

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
        <Text style={{ fontSize: 24, fontWeight: 'bold' }}>👥 CRM</Text>
        <Text style={{ color: '#666', fontSize: 13, marginTop: 4 }}>
          {contractors.length} contratante{contractors.length !== 1 ? 's' : ''} cadastrado{contractors.length !== 1 ? 's' : ''}
        </Text>
      </View>

      {/* Content */}
      {loading && !refreshing ? (
        <View
          style={{
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <ActivityIndicator color="#2563eb" size="large" />
          <Text style={{ color: '#666', marginTop: 12, fontSize: 14 }}>
            Carregando contratantes...
          </Text>
        </View>
      ) : contractors.length > 0 ? (
        <FlatList
          data={contractors}
          renderItem={renderContractor}
          keyExtractor={item => item.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 16 }}
          scrollEnabled={true}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
          }
        />
      ) : (
        <View
          style={{
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
            paddingHorizontal: 32,
          }}
        >
          <Text style={{ fontSize: 40, marginBottom: 16 }}>👥</Text>
          <Text style={{ fontSize: 16, fontWeight: '600', color: '#333', marginBottom: 8 }}>
            Nenhum contratante encontrado
          </Text>
          <Text style={{ color: '#666', fontSize: 13, textAlign: 'center', lineHeight: 20 }}>
            Contratantes ativos aparecerão aqui
          </Text>
        </View>
      )}
    </View>
  )
}
