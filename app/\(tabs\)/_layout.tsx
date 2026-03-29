import { Tabs } from 'expo-router'
import React from 'react'
import { HapticTab } from '@/components/haptic-tab'
import { IconSymbol } from '@/components/ui/icon-symbol'
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
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="house.fill" color={color} />,
          headerShown: false,
        }}
      />
      <Tabs.Screen
        name="tools"
        options={{
          title: 'Ferramentas',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="hammer.fill" color={color} />,
          headerShown: false,
        }}
      />
      <Tabs.Screen
        name="airtag"
        options={{
          title: 'AirTag',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="bluetooth" color={color} />,
          headerShown: false,
        }}
      />
      <Tabs.Screen
        name="tracking"
        options={{
          title: 'Rastrear',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="location.fill" color={color} />,
          headerShown: false,
        }}
      />
      <Tabs.Screen
        name="locations"
        options={{
          title: 'Localizações',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="map.fill" color={color} />,
          headerShown: false,
        }}
      />
      <Tabs.Screen
        name="alerts"
        options={{
          title: 'Alertas',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="bell.fill" color={color} />,
          headerShown: false,
        }}
      />
      <Tabs.Screen
        name="tool-form"
        options={{
          title: 'Ferramenta',
          headerShown: true,
          href: null,
        }}
      />
    </Tabs>
  )
}
