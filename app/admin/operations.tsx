import { View, Text, ScrollView, TouchableOpacity } from 'react-native'

export default function AdminOperationsScreen() {
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
        <Text style={{ fontSize: 24, fontWeight: 'bold' }}>🔧 Operações</Text>
        <Text style={{ color: '#666', fontSize: 13, marginTop: 4 }}>
          Monitore ferramentas e rastreamento em tempo real
        </Text>
      </View>

      {/* Content */}
      <View style={{ paddingHorizontal: 16, paddingVertical: 16 }}>
        <Text style={{ fontSize: 16, fontWeight: '600', marginBottom: 12 }}>
          Monitoramento
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
            borderLeftColor: '#10b981',
          }}
        >
          <View>
            <Text style={{ fontWeight: '600', fontSize: 14 }}>Ferramentas em Uso</Text>
            <Text style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
              Tempo real de conexão
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
            borderLeftColor: '#3b82f6',
          }}
        >
          <View>
            <Text style={{ fontWeight: '600', fontSize: 14 }}>Rastreamento Ativo</Text>
            <Text style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
              Localização GPS em tempo real
            </Text>
          </View>
          <Text style={{ color: '#3b82f6', fontSize: 18 }}>→</Text>
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
            <Text style={{ fontWeight: '600', fontSize: 14 }}>Alertas Críticos</Text>
            <Text style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
              Desconexões e anomalias
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
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderLeftWidth: 4,
            borderLeftColor: '#8b5cf6',
          }}
        >
          <View>
            <Text style={{ fontWeight: '600', fontSize: 14 }}>Histórico de Movimentos</Text>
            <Text style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
              Rastro de localização
            </Text>
          </View>
          <Text style={{ color: '#8b5cf6', fontSize: 18 }}>→</Text>
        </TouchableOpacity>

        {/* Info Box */}
        <View
          style={{
            backgroundColor: '#dbeafe',
            borderRadius: 8,
            paddingHorizontal: 12,
            paddingVertical: 10,
            marginTop: 16,
          }}
        >
          <Text style={{ fontSize: 12, color: '#1e40af', fontWeight: '600' }}>
            ℹ️ Dados atualizados em tempo real
          </Text>
          <Text style={{ fontSize: 11, color: '#1e40af', marginTop: 4 }}>
            A localização das ferramentas é sincronizada com Supabase a cada 5 metros de movimento
          </Text>
        </View>
      </View>
    </ScrollView>
  )
}
