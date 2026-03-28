import { useEffect, useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  RefreshControl,
} from 'react-native'
import { useAuth } from '@/context/AuthContext'
import { useAlerts } from '@/context/AlertsContext'

const ALERT_COLORS: Record<string, { bg: string; text: string; badge: string }> = {
  critical: { bg: '#fee2e2', text: '#991b1b', badge: '🔴' },
  warning: { bg: '#fef3c7', text: '#92400e', badge: '🟡' },
  info: { bg: '#dbeafe', text: '#1e40af', badge: '🔵' },
}

export default function AlertsScreen() {
  const { contractor } = useAuth()
  const { alerts, loading, refreshAlerts, resolveAlert } = useAlerts()
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    if (contractor?.id) {
      refreshAlerts(contractor.id)
    }
  }, [contractor?.id])

  const handleRefresh = async () => {
    if (!contractor?.id) return
    setRefreshing(true)
    await refreshAlerts(contractor.id)
    setRefreshing(false)
  }

  const handleResolveAlert = async (alertId: string) => {
    try {
      await resolveAlert(alertId)
      Alert.alert('Sucesso', 'Alerta resolvido')
    } catch {
      Alert.alert('Erro', 'Falha ao resolver alerta')
    }
  }

  const getSeverityColor = (severity: string) => {
    return ALERT_COLORS[severity] || ALERT_COLORS.info
  }

  const renderAlertCard = (alert: any) => {
    const colors = getSeverityColor(alert.severity)

    return (
      <View
        key={alert.id}
        style={{
          backgroundColor: colors.bg,
          borderRadius: 8,
          padding: 16,
          marginBottom: 12,
          borderLeftWidth: 4,
          borderLeftColor: colors.text,
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
            <Text style={{ fontSize: 16, fontWeight: '600', color: colors.text, marginBottom: 4 }}>
              {colors.badge} {alert.type}
            </Text>
            <Text style={{ color: colors.text, fontSize: 13, lineHeight: 18 }}>
              {alert.message}
            </Text>
          </View>
        </View>

        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingTop: 12,
            borderTopWidth: 1,
            borderTopColor: `${colors.text}20`,
          }}
        >
          <Text style={{ color: colors.text, fontSize: 11, opacity: 0.7 }}>
            {new Date(alert.created_at).toLocaleDateString('pt-BR')}
          </Text>

          <TouchableOpacity
            onPress={() => {
              Alert.alert('Resolver Alerta?', alert.message, [
                { text: 'Cancelar', style: 'cancel' },
                {
                  text: 'Resolver',
                  style: 'default',
                  onPress: () => handleResolveAlert(alert.id),
                },
              ])
            }}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderRadius: 4,
              backgroundColor: colors.text,
              opacity: 0.2,
            }}
          >
            <Text style={{ color: colors.text, fontSize: 11, fontWeight: '600' }}>
              Resolver
            </Text>
          </TouchableOpacity>
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
        <Text style={{ fontSize: 24, fontWeight: 'bold' }}>
          🔔 Alertas
        </Text>
        <Text style={{ color: '#666', fontSize: 13, marginTop: 4 }}>
          {alerts.length} alerta{alerts.length !== 1 ? 's' : ''} não resolvido{alerts.length !== 1 ? 's' : ''}
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
          <ActivityIndicator color="#2563eb" size="large" />
          <Text style={{ color: '#666', marginTop: 12, fontSize: 14 }}>
            Carregando alertas...
          </Text>
        </View>
      ) : alerts.length > 0 ? (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 16 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
          }
        >
          {alerts
            .sort((a, b) => {
              const order = { critical: 0, warning: 1, info: 2 }
              return (order[a.severity as keyof typeof order] || 3) -
                (order[b.severity as keyof typeof order] || 3)
            })
            .map(alert => renderAlertCard(alert))}
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
          <Text style={{ fontSize: 40, marginBottom: 16 }}>✨</Text>
          <Text style={{ fontSize: 16, fontWeight: '600', color: '#333', marginBottom: 8 }}>
            Nenhum alerta ativo
          </Text>
          <Text style={{ color: '#666', fontSize: 13, textAlign: 'center', lineHeight: 20 }}>
            Tudo está funcionando normalmente com suas ferramentas
          </Text>
        </View>
      )}
    </View>
  )
}
