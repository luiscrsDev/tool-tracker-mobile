import { Tabs } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

export default function WorkerLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#2563EB',
        tabBarInactiveTintColor: '#94A3B8',
        tabBarStyle: { backgroundColor: '#0F172A', borderTopColor: 'rgba(255,255,255,0.06)' },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        headerShown: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Minhas Ferramentas',
          tabBarIcon: ({ color }) => <Ionicons name="hammer" size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="transfers"
        options={{
          title: 'Transferências',
          tabBarIcon: ({ color }) => <Ionicons name="swap-horizontal" size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Perfil',
          tabBarIcon: ({ color }) => <Ionicons name="person" size={24} color={color} />,
        }}
      />
    </Tabs>
  )
}
