import { View, Text, ScrollView, TouchableOpacity } from 'react-native'

export default function AdminAnalyticsScreen() {
  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#f5f5f5' }}>
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
        <Text style={{ fontSize: 24, fontWeight: 'bold' }}>📊 Analytics</Text>
        <Text style={{ color: '#666', fontSize: 13, marginTop: 4 }}>
          Relatórios e insights do sistema
        </Text>
      </View>

      {/* Content */}
      <View style={{ paddingHorizontal: 16, paddingVertical: 16 }}>
        <Text style={{ fontSize: 16, fontWeight: '600', marginBottom: 12 }}>
          Relatórios Disponíveis
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
          <View>
            <Text style={{ fontWeight: '600', fontSize: 14 }}>Utilização por Contratante</Text>
            <Text style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
              Ferramentas e atividade
            </Text>
          </View>
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
          <View>
            <Text style={{ fontWeight: '600', fontSize: 14 }}>Taxa de Conectividade</Text>
            <Text style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
              Uptime e disponibilidade
            </Text>
          </View>
          <Text style={{ color: '#10b981', fontSize: 18 }}>→</Text>
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
            borderLeftColor: '#ef4444',
          }}
        >
          <View>
            <Text style={{ fontWeight: '600', fontSize: 14 }}>Incidentes Registrados</Text>
            <Text style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
              Alertas e eventos críticos
            </Text>
          </View>
          <Text style={{ color: '#ef4444', fontSize: 18 }}>→</Text>
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
            borderLeftColor: '#f59e0b',
          }}
        >
          <View>
            <Text style={{ fontWeight: '600', fontSize: 14 }}>Bateria e Manutenção</Text>
            <Text style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
              Status de saúde das ferramentas
            </Text>
          </View>
          <Text style={{ color: '#f59e0b', fontSize: 18 }}>→</Text>
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
          <View>
            <Text style={{ fontWeight: '600', fontSize: 14 }}>Crescimento da Base</Text>
            <Text style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
              Contratantes e ferramentas ao longo do tempo
            </Text>
          </View>
          <Text style={{ color: '#8b5cf6', fontSize: 18 }}>→</Text>
        </TouchableOpacity>

        {/* Info Box */}
        <View
          style={{
            backgroundColor: '#f0fdf4',
            borderRadius: 8,
            paddingHorizontal: 12,
            paddingVertical: 10,
            marginTop: 16,
          }}
        >
          <Text style={{ fontSize: 12, color: '#065f46', fontWeight: '600' }}>
            ✅ Dados em tempo real
          </Text>
          <Text style={{ fontSize: 11, color: '#16a34a', marginTop: 4 }}>
            Todos os gráficos e métricas são atualizados automaticamente a cada 5 minutos
          </Text>
        </View>
      </View>
    </ScrollView>
  )
}
