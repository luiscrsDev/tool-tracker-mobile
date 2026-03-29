import { Tabs } from 'expo-router'
import React from 'react'
import { HapticTab } from '@/components/haptic-tab'
import { Ionicons } from '@expo/vector-icons'
import { Colors } from '@/constants/theme'
import { useColorScheme } from '@/hooks/use-color-scheme'

export default function TabLayout() {
  const colorScheme = useColorScheme()

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
        headerShown: true,
        tabBarButton: HapticTab,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color }) => <Ionicons size={24} name="home" color={color} />,
          headerShown: false,
        }}
      />
      <Tabs.Screen
        name="tools"
        options={{
          title: 'Ferramentas',
          tabBarIcon: ({ color }) => <Ionicons size={24} name="hammer" color={color} />,
          headerShown: false,
        }}
      />
      <Tabs.Screen
        name="tracking"
        options={{
          title: 'Rastrear',
          tabBarIcon: ({ color }) => <Ionicons size={24} name="location" color={color} />,
          headerShown: false,
        }}
      />
      <Tabs.Screen
        name="alerts"
        options={{
          title: 'Alertas',
          tabBarIcon: ({ color }) => <Ionicons size={24} name="notifications" color={color} />,
          headerShown: false,
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: 'Mais',
          tabBarIcon: ({ color }) => <Ionicons size={24} name="ellipsis-horizontal" color={color} />,
          headerShown: false,
        }}
      />

      {/* Rotas sem aba visível */}
      <Tabs.Screen name="airtag" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="locations" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="history" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="settings" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="tool-form" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="tool-detail" options={{ href: null, headerShown: false }} />
      <Tabs.Screen name="sites" options={{ href: null, headerShown: false }} />
    </Tabs>
  )
}
