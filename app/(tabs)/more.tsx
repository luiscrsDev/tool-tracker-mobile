import { View, Text, TouchableOpacity, ScrollView, Alert } from 'react-native'
import { useRouter } from 'expo-router'
import { useAuth } from '@/context/AuthContext'

const menuItems = [
  {
    icon: '🕐',
    label: 'Histórico',
    desc: 'Timeline de localizações',
    path: '/(tabs)/history',
    color: '#2563EB',
  },
  {
    icon: '📡',
    label: 'AirTag Setup',
    desc: 'Parear dispositivos Bluetooth',
    path: '/(tabs)/airtag',
    color: '#8B5CF6',
  },
  {
    icon: '🏢',
    label: 'Sites',
    desc: 'Depósitos, obras e escritórios',
    path: '/(tabs)/sites',
    color: '#F97316',
  },
  {
    icon: '⚙️',
    label: 'Configurações',
    desc: 'Alertas, range e conta',
    path: '/(tabs)/settings',
    color: '#F59E0B',
  },
]

export default function MoreScreen() {
  const router = useRouter()
  const { contractor, signOut } = useAuth()

  const handleLogout = () => {
    Alert.alert('Sair?', 'Deseja encerrar a sessão?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Sair',
        style: 'destructive',
        onPress: async () => {
          await signOut()
          router.replace('/(auth)/login')
        },
      },
    ])
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#F8FAFC' }}>
      {/* Header */}
      <View style={{
        backgroundColor: '#0F172A',
        paddingHorizontal: 20,
        paddingTop: 56,
        paddingBottom: 24,
      }}>
        <Text style={{ fontSize: 22, fontWeight: '800', color: 'white', letterSpacing: -0.5 }}>
          Mais
        </Text>
        <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>
          {contractor?.name} · {contractor?.company}
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        {/* Menu items */}
        <View style={{
          backgroundColor: 'white',
          borderRadius: 12,
          overflow: 'hidden',
          shadowColor: '#000',
          shadowOpacity: 0.05,
          shadowRadius: 6,
          elevation: 1,
        }}>
          {menuItems.map((item, i) => (
            <TouchableOpacity
              key={item.path}
              onPress={() => router.push(item.path as any)}
              activeOpacity={0.7}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 14,
                padding: 16,
                borderBottomWidth: i < menuItems.length - 1 ? 1 : 0,
                borderBottomColor: '#F1F5F9',
              }}
            >
              <View style={{
                width: 42,
                height: 42,
                borderRadius: 12,
                backgroundColor: `${item.color}15`,
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <Text style={{ fontSize: 20 }}>{item.icon}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontWeight: '600', color: '#0F172A' }}>
                  {item.label}
                </Text>
                <Text style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>
                  {item.desc}
                </Text>
              </View>
              <Text style={{ fontSize: 18, color: '#CBD5E1' }}>›</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Conta */}
        <View style={{
          backgroundColor: 'white',
          borderRadius: 12,
          padding: 16,
          shadowColor: '#000',
          shadowOpacity: 0.05,
          shadowRadius: 6,
          elevation: 1,
        }}>
          <Text style={{ fontSize: 10, fontWeight: '700', color: '#94A3B8', letterSpacing: 1, marginBottom: 14 }}>
            CONTA
          </Text>
          {[
            { label: 'Nome', value: contractor?.name },
            { label: 'Email', value: contractor?.email },
            { label: 'Empresa', value: contractor?.company },
          ].map((item, i) => (
            <View key={i} style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              paddingVertical: 10,
              borderBottomWidth: i < 2 ? 1 : 0,
              borderBottomColor: '#F1F5F9',
            }}>
              <Text style={{ fontSize: 13, color: '#64748B' }}>{item.label}</Text>
              <Text style={{ fontSize: 13, fontWeight: '600', color: '#0F172A', maxWidth: '60%', textAlign: 'right' }}>
                {item.value || '—'}
              </Text>
            </View>
          ))}
        </View>

        {/* Logout */}
        <TouchableOpacity
          onPress={handleLogout}
          style={{
            backgroundColor: '#FEF2F2',
            borderRadius: 12,
            paddingVertical: 16,
            alignItems: 'center',
            borderWidth: 1,
            borderColor: '#FECACA',
            marginBottom: 8,
          }}
        >
          <Text style={{ color: '#EF4444', fontWeight: '700', fontSize: 14 }}>
            Sair da conta
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  )
}
