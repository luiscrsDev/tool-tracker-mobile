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
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '@/context/AuthContext'
import { useAlerts } from '@/context/AlertsContext'

const SEVERITY_CONFIG: Record<string, {
  color: string
  icon: keyof typeof Ionicons.glyphMap
  label: string
}> = {
  critical: { color: '#EF4444', icon: 'alert-circle', label: 'críticos' },
  warning: { color: '#F59E0B', icon: 'time', label: 'avisos' },
  info: { color: '#3B82F6', icon: 'information-circle', label: 'informativos' },
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

  const getConfig = (severity: string) => {
    return SEVERITY_CONFIG[severity] || SEVERITY_CONFIG.info
  }

  const countBySeverity = (severity: string) =>
    alerts.filter(a => a.severity === severity).length

  const renderSeverityPills = () => {
    const severities = ['critical', 'warning', 'info'] as const
    const pills = severities
      .map(sev => ({ sev, count: countBySeverity(sev) }))
      .filter(({ count }) => count > 0)

    if (pills.length === 0) return null

    return (
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
        {pills.map(({ sev, count }) => {
          const config = SEVERITY_CONFIG[sev]
          return (
            <View
              key={sev}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: `${config.color}15`,
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: 12,
              }}
            >
              <Ionicons name={config.icon} size={14} color={config.color} />
              <Text style={{ fontSize: 12, fontWeight: '600', color: config.color, marginLeft: 4 }}>
                {count} {config.label}
              </Text>
            </View>
          )
        })}
      </View>
    )
  }

  const renderAlertCard = (alert: any) => {
    const config = getConfig(alert.severity)

    return (
      <View
        key={alert.id}
        style={{
          backgroundColor: '#FFFFFF',
          borderRadius: 12,
          marginBottom: 12,
          borderLeftWidth: 4,
          borderLeftColor: config.color,
          flexDirection: 'row',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.05,
          shadowRadius: 3,
          elevation: 2,
        }}
      >
        {/* Icon strip */}
        <View
          style={{
            width: 44,
            alignItems: 'center',
            justifyContent: 'center',
            paddingVertical: 16,
          }}
        >
          <View
            style={{
              width: 32,
              height: 32,
              borderRadius: 16,
              backgroundColor: `${config.color}15`,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name={config.icon} size={18} color={config.color} />
          </View>
        </View>

        {/* Content */}
        <View style={{ flex: 1, paddingVertical: 14, paddingRight: 16 }}>
          <Text
            style={{
              fontSize: 15,
              fontWeight: '700',
              color: '#0F172A',
              marginBottom: 4,
            }}
          >
            {alert.type}
          </Text>
          <Text
            style={{
              fontSize: 13,
              color: '#64748B',
              lineHeight: 18,
              marginBottom: 12,
            }}
          >
            {alert.message}
          </Text>

          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <Text style={{ color: '#94A3B8', fontSize: 11 }}>
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
                paddingHorizontal: 14,
                paddingVertical: 6,
                borderRadius: 6,
                borderWidth: 1,
                borderColor: config.color,
                backgroundColor: 'transparent',
              }}
            >
              <Text style={{ color: config.color, fontSize: 12, fontWeight: '600' }}>
                Resolver
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#F1F5F9' }}>
      {/* Header */}
      <View
        style={{
          backgroundColor: '#fff',
          paddingHorizontal: 20,
          paddingVertical: 16,
          borderBottomWidth: 1,
          borderBottomColor: '#E2E8F0',
        }}
      >
        <Text style={{ fontSize: 24, fontWeight: 'bold', color: '#0F172A' }}>
          Alertas
        </Text>
        <Text style={{ color: '#64748B', fontSize: 13, marginTop: 4 }}>
          {alerts.length} alerta{alerts.length !== 1 ? 's' : ''} não resolvido{alerts.length !== 1 ? 's' : ''}
        </Text>
        {renderSeverityPills()}
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
          <Text style={{ color: '#64748B', marginTop: 12, fontSize: 14 }}>
            Carregando alertas...
          </Text>
        </View>
      ) : alerts.length > 0 ? (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 16 }}
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
          <Ionicons name="checkmark-circle" size={64} color="#22C55E" />
          <Text
            style={{
              fontSize: 18,
              fontWeight: '700',
              color: '#0F172A',
              marginTop: 16,
              marginBottom: 8,
            }}
          >
            Tudo em ordem!
          </Text>
          <Text
            style={{
              color: '#64748B',
              fontSize: 14,
              textAlign: 'center',
              lineHeight: 20,
            }}
          >
            Nenhum alerta ativo no momento
          </Text>
        </View>
      )}
    </View>
  )
}
