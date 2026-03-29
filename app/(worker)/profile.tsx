import { View, Text, TouchableOpacity, Alert } from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '@/context/AuthContext'

export default function WorkerProfileScreen() {
  const { worker, signOut } = useAuth()
  const router = useRouter()

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
    <View style={{ flex: 1, backgroundColor: '#0F172A', paddingHorizontal: 20 }}>
      <View style={{ paddingTop: 56, paddingBottom: 32 }}>
        <Text style={{ fontSize: 22, fontWeight: '800', color: 'white', letterSpacing: -0.5 }}>
          Perfil
        </Text>
      </View>

      {/* Avatar */}
      <View style={{ alignItems: 'center', marginBottom: 32 }}>
        <View style={{
          width: 80, height: 80, borderRadius: 40,
          backgroundColor: '#1E293B', borderWidth: 2,
          borderColor: '#2563EB', alignItems: 'center', justifyContent: 'center',
          marginBottom: 12,
        }}>
          <Ionicons name="person" size={36} color="#2563EB" />
        </View>
        <Text style={{ color: 'white', fontWeight: '700', fontSize: 18 }}>
          {worker?.name || 'Worker'}
        </Text>
        <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, marginTop: 4 }}>
          {worker?.phone}
        </Text>
      </View>

      {/* Info */}
      <View style={{
        backgroundColor: '#1E293B', borderRadius: 14, padding: 16,
        borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', marginBottom: 16,
      }}>
        <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 12 }}>
          CONTA
        </Text>
        {[
          { label: 'Nome', value: worker?.name || '—' },
          { label: 'Telefone', value: worker?.phone || '—' },
          { label: 'Tipo', value: 'Worker' },
        ].map((item, i, arr) => (
          <View key={item.label} style={{
            flexDirection: 'row', justifyContent: 'space-between',
            paddingVertical: 12,
            borderBottomWidth: i < arr.length - 1 ? 1 : 0,
            borderBottomColor: 'rgba(255,255,255,0.06)',
          }}>
            <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>{item.label}</Text>
            <Text style={{ color: 'white', fontSize: 13, fontWeight: '600' }}>{item.value}</Text>
          </View>
        ))}
      </View>

      {/* Logout */}
      <TouchableOpacity
        onPress={handleLogout}
        style={{
          borderWidth: 1, borderColor: 'rgba(239,68,68,0.4)',
          borderRadius: 14, paddingVertical: 16, alignItems: 'center',
          backgroundColor: 'rgba(239,68,68,0.08)',
        }}
      >
        <Text style={{ color: '#EF4444', fontWeight: '700', fontSize: 15 }}>Sair da conta</Text>
      </TouchableOpacity>
    </View>
  )
}
