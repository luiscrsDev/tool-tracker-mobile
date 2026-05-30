import { Redirect } from 'expo-router'
import { ActivityIndicator, View } from 'react-native'
import { useAuth } from '@/context/AuthContext'

/**
 * Root entry point. Without this file, expo-router has no route for "/" and
 * users with a restored session would land on the built-in "Unmatched Route"
 * screen because RootLayoutNav only redirects when inAuthGroup is true.
 */
export default function Index() {
  const { userRole, loading } = useAuth()

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#2563EB" />
      </View>
    )
  }

  if (!userRole) return <Redirect href="/(auth)/login" />
  if (userRole === 'contractor') return <Redirect href="/(tabs)" />
  if (userRole === 'admin' || userRole === 'master') return <Redirect href="/admin" />
  if (userRole === 'worker') return <Redirect href="/(worker)" />
  return <Redirect href="/(auth)/login" />
}
