import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native'
import { Stack, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import * as SplashScreen from 'expo-splash-screen'
import { ActivityIndicator, View } from 'react-native'
import { useEffect } from 'react'
import 'react-native-reanimated'
// Register background location task before any component renders
import '@/lib/backgroundTracking'

import { useColorScheme } from '@/hooks/use-color-scheme'
import { AuthProvider, useAuth } from '@/context/AuthContext'
import { ToolsProvider } from '@/context/ToolsContext'
import { AlertsProvider } from '@/context/AlertsContext'
import { BluetoothProvider } from '@/context/BluetoothContext'
import { LocationProvider } from '@/context/LocationContext'
import { TagsProvider } from '@/context/TagsContext'
import { SitesProvider } from '@/context/SitesContext'
import { AdminProvider } from '@/context/AdminContext'

function RootLayoutNav() {
  const colorScheme = useColorScheme()
  const { userRole, loading } = useAuth()
  const router = useRouter()
  const segments = useSegments()

  useEffect(() => {
    if (loading) return

    SplashScreen.hideAsync().catch(() => {})

    const inAuthGroup = segments[0] === '(auth)'

    if (!userRole && !inAuthGroup) {
      router.replace('/(auth)/login')
    } else if (userRole === 'contractor' && inAuthGroup) {
      router.replace('/(tabs)')
    } else if (userRole === 'admin' && inAuthGroup) {
      router.replace('/admin')
    } else if (userRole === 'worker' && inAuthGroup) {
      router.replace('/(worker)')
    } else if (userRole === 'master' && inAuthGroup) {
      router.replace('/admin')
    }
  }, [userRole, loading, segments])

  // While the auth session is being restored, keep the splash visible by
  // returning a covering view. Removing this allowed expo-router to mount
  // an unmatched route briefly and freeze users with a stored session.
  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#ffffff' }}>
        <ActivityIndicator size="large" color="#2563EB" />
      </View>
    )
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(auth)" options={{ headerShown: false, animationEnabled: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false, animationEnabled: false }} />
        <Stack.Screen name="(worker)" options={{ headerShown: false, animationEnabled: false }} />
        <Stack.Screen name="admin" options={{ headerShown: false, animationEnabled: false }} />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  )
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <ToolsProvider>
        <TagsProvider>
          <SitesProvider>
          <AlertsProvider>
            <BluetoothProvider>
              <LocationProvider>
                <AdminProvider>
                  <RootLayoutNav />
                </AdminProvider>
              </LocationProvider>
            </BluetoothProvider>
          </AlertsProvider>
          </SitesProvider>
        </TagsProvider>
      </ToolsProvider>
    </AuthProvider>
  )
}
