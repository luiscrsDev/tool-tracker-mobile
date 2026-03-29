import { View, Text, TouchableOpacity, ScrollView, Alert, ActivityIndicator, RefreshControl } from 'react-native'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { useAdmin } from '@/context/AdminContext'

export default function AdminDashboardScreen() {
  const router = useRouter()
  const { admin, signOut } = useAuth()
  const { stats, loading, refreshData } = useAdmin()
  const [refreshing, setRefreshing] = useState(false)

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

  const handleRefresh = async () => {
    setRefreshing(true)
    await refreshData()
    setRefreshing(false)
  }

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
            ⚙️ Admin
          </Text>
          <Text style={{ fontSize: 14, color: '#666', marginTop: 4 }}>
            Sistema de Gerenciamento
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
          Administrador
        </Text>
        <Text style={{ fontSize: 18, fontWeight: '600' }}>
          {admin?.name || 'N/A'}
        </Text>
        <Text style={{ fontSize: 13, color: '#666', marginTop: 6 }}>
          {admin?.email || 'N/A'}
        </Text>
      </View>

      {/* Status Cards */}
      {loading && !refreshing ? (
        <View
          style={{
            backgroundColor: '#eff6ff',
            borderRadius: 8,
            padding: 24,
            alignItems: 'center',
          }}
        >
          <ActivityIndicator color="#2563eb" size="large" />
          <Text style={{ color: '#2563eb', marginTop: 12, fontSize: 13 }}>
            Carregando dados...
          </Text>
        </View>
      ) : (
        <View style={{ marginBottom: 20 }}>
          <Text style={{ fontSize: 16, fontWeight: '600', marginBottom: 12 }}>
            Resumo do Sistema
          </Text>

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
              }}
            >
              <Text style={{ color: '#666' }}>👥 Contratantes Ativos</Text>
              <Text style={{ fontSize: 24, fontWeight: 'bold', color: '#2563eb' }}>
                {stats.totalContractors}
              </Text>
            </View>
          </View>

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
              }}
            >
              <Text style={{ color: '#666' }}>🔨 Ferramentas Conectadas</Text>
              <Text style={{ fontSize: 24, fontWeight: 'bold', color: '#10b981' }}>
                {stats.activeTools}
              </Text>
            </View>
          </View>

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
              }}
            >
              <Text style={{ color: '#666' }}>🔔 Alertas Ativos</Text>
              <Text style={{ fontSize: 24, fontWeight: 'bold', color: '#ef4444' }}>
                {stats.activeAlerts}
              </Text>
            </View>
          </View>

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
              <Text style={{ color: '#666' }}>📊 Média por Contratante</Text>
              <Text style={{ fontSize: 24, fontWeight: 'bold', color: '#8b5cf6' }}>
                {stats.avgToolsPerContractor}
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* Quick Actions */}
      <View style={{ marginTop: 20 }}>
        <Text style={{ fontSize: 16, fontWeight: '600', marginBottom: 12 }}>
          Ações Rápidas
        </Text>

        <TouchableOpacity
          style={{
            backgroundColor: '#fff',
            borderRadius: 8,
            paddingHorizontal: 16,
            paddingVertical: 12,
            marginBottom: 8,
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderLeftWidth: 4,
            borderLeftColor: '#2563eb',
          }}
        >
          <Text style={{ fontWeight: '600', fontSize: 14 }}>Ver Contratantes</Text>
          <Text style={{ color: '#2563eb', fontSize: 18 }}>→</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={{
            backgroundColor: '#fff',
            borderRadius: 8,
            paddingHorizontal: 16,
            paddingVertical: 12,
            marginBottom: 8,
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderLeftWidth: 4,
            borderLeftColor: '#10b981',
          }}
        >
          <Text style={{ fontWeight: '600', fontSize: 14 }}>Monitorar Ferramentas</Text>
          <Text style={{ color: '#10b981', fontSize: 18 }}>→</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={{
            backgroundColor: '#fff',
            borderRadius: 8,
            paddingHorizontal: 16,
            paddingVertical: 12,
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderLeftWidth: 4,
            borderLeftColor: '#8b5cf6',
          }}
        >
          <Text style={{ fontWeight: '600', fontSize: 14 }}>Ver Relatórios</Text>
          <Text style={{ color: '#8b5cf6', fontSize: 18 }}>→</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  )
}
