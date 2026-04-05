import { useState, useEffect, useCallback, useRef } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Linking,
  RefreshControl,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect } from '@react-navigation/native'
import { useRouter } from 'expo-router'
import { useTools } from '@/context/ToolsContext'
import { useTags } from '@/context/TagsContext'
import { useSites } from '@/context/SitesContext'
import { useLocation } from '@/context/LocationContext'
import { useAuth } from '@/context/AuthContext'

export default function TrackingScreen() {
  const { tools, refreshTools } = useTools()
  const { tags, getTagById, refreshTags } = useTags()
  const { resolveLocation, refreshSites } = useSites()
  const { allToolLocations, loadLastKnownLocations } = useLocation()
  const { contractor } = useAuth()
  const router = useRouter()
  const [refreshing, setRefreshing] = useState(false)
  const [countdown, setCountdown] = useState(30)
  const countdownRef = useRef(30)

  // Refresh on focus
  useFocusEffect(
    useCallback(() => {
      if (contractor?.id) {
        refreshTools(contractor.id)
        refreshTags(contractor.id)
        refreshSites(contractor.id)
      }
    }, [contractor?.id]),
  )

  // Load locations
  const trackedTools = tools.filter(t => t.assigned_tag)

  useEffect(() => {
    if (trackedTools.length > 0) {
      loadLastKnownLocations(trackedTools.map(t => t.id))
    }
  }, [trackedTools.length, loadLastKnownLocations])

  // Countdown timer + auto-refresh every 30s
  useEffect(() => {
    if (trackedTools.length === 0) return
    countdownRef.current = 30
    setCountdown(30)
    const interval = setInterval(() => {
      countdownRef.current -= 1
      if (countdownRef.current <= 0) {
        loadLastKnownLocations(trackedTools.map(t => t.id))
        countdownRef.current = 30
      }
      setCountdown(countdownRef.current)
    }, 1000)
    return () => clearInterval(interval)
  }, [trackedTools.length, loadLastKnownLocations])

  const handleRefresh = async () => {
    if (!contractor?.id) return
    setRefreshing(true)
    await refreshTools(contractor.id)
    await loadLastKnownLocations(trackedTools.map(t => t.id))
    countdownRef.current = 30
    setCountdown(30)
    setRefreshing(false)
  }

  const formatDateTime = (timestamp?: string) => {
    if (!timestamp) return null
    return new Date(timestamp).toLocaleDateString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  }

  const getMinutesSinceLastSeen = (timestamp?: string): number | null => {
    if (!timestamp) return null
    return (Date.now() - new Date(timestamp).getTime()) / 60000
  }

  const renderProximityBadge = (timestamp?: string) => {
    const mins = getMinutesSinceLastSeen(timestamp)
    let label: string
    let bgColor: string
    let textColor: string

    if (mins == null) {
      label = 'Distante'
      bgColor = '#F1F5F9'
      textColor = '#94A3B8'
    } else if (mins < 5) {
      label = 'AQUI!'
      bgColor = '#F0FDF4'
      textColor = '#16A34A'
    } else if (mins < 30) {
      label = 'Próximo'
      bgColor = '#EFF6FF'
      textColor = '#2563EB'
    } else {
      label = 'Distante'
      bgColor = '#F1F5F9'
      textColor = '#94A3B8'
    }

    return (
      <View style={{
        backgroundColor: bgColor,
        borderRadius: 10,
        paddingHorizontal: 8,
        paddingVertical: 3,
      }}>
        <Text style={{ fontSize: 10, fontWeight: '700', color: textColor }}>
          {label}
        </Text>
      </View>
    )
  }

  const renderSignalBars = (timestamp?: string) => {
    const mins = getMinutesSinceLastSeen(timestamp)
    // Determine active bar count based on proximity
    let activeBars: number
    let activeColor: string
    if (mins == null) {
      activeBars = 0
      activeColor = '#94A3B8'
    } else if (mins < 5) {
      activeBars = 4
      activeColor = '#16A34A'
    } else if (mins < 30) {
      activeBars = 3
      activeColor = '#2563EB'
    } else if (mins < 90) {
      activeBars = 2
      activeColor = '#94A3B8'
    } else {
      activeBars = 1
      activeColor = '#94A3B8'
    }

    const barHeights = [6, 10, 14, 18]
    return (
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2 }}>
        {barHeights.map((h, i) => (
          <View
            key={i}
            style={{
              width: 4,
              height: h,
              borderRadius: 1,
              backgroundColor: i < activeBars ? activeColor : '#E2E8F0',
            }}
          />
        ))}
      </View>
    )
  }

  const renderToolCard = (tool: typeof tools[0]) => {
    const tag = tool.assigned_tag ? getTagById(tool.assigned_tag) : null
    const location = allToolLocations.get(tool.id) || tool.last_seen_location
    const locationLabel = location
      ? resolveLocation(location.latitude, location.longitude)
      : null
    const lastSeen = formatDateTime(location?.timestamp)
    const battery = tag?.battery

    return (
      <View
        key={tool.id}
        style={{
          backgroundColor: 'white',
          borderRadius: 12,
          padding: 20,
          marginBottom: 12,
          shadowColor: '#000',
          shadowOpacity: 0.05,
          shadowRadius: 6,
          elevation: 1,
        }}
      >
        {/* Header */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#0F172A' }}>
              {tool.name}
            </Text>
            <Text style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>
              {tool.type} {tag ? `· ${tag.name}` : ''}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {/* Signal bars */}
            {renderSignalBars(location?.timestamp)}
            {/* Proximity badge */}
            {renderProximityBadge(location?.timestamp)}
            {/* Battery */}
            {battery != null && (
              <View style={{
                flexDirection: 'row', alignItems: 'center', gap: 4,
                paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12,
                backgroundColor: battery < 20 ? '#FEF2F2' : battery < 50 ? '#FFFBEB' : '#F0FDF4',
              }}>
                <Ionicons
                  name="battery-half"
                  size={14}
                  color={battery < 20 ? '#EF4444' : battery < 50 ? '#F59E0B' : '#10B981'}
                />
                <Text style={{
                  fontSize: 11, fontWeight: '700',
                  color: battery < 20 ? '#EF4444' : battery < 50 ? '#F59E0B' : '#10B981',
                }}>
                  {battery}%
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Location */}
        {location ? (
          <TouchableOpacity
            onPress={() => Linking.openURL(
              `https://www.google.com/maps?q=${location.latitude},${location.longitude}`
            )}
            style={{
              backgroundColor: '#F0F9FF',
              borderRadius: 8,
              padding: 10,
              borderWidth: 1,
              borderColor: '#BFDBFE',
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="location" size={16} color="#2563EB" />
              <Text style={{ fontSize: 13, fontWeight: '600', color: '#1E40AF', flex: 1 }}>
                {locationLabel}
              </Text>
              <Ionicons name="open-outline" size={14} color="#93C5FD" />
            </View>
            {lastSeen && (
              <Text style={{ fontSize: 11, color: '#93C5FD', marginTop: 4, marginLeft: 22 }}>
                {lastSeen}
              </Text>
            )}
          </TouchableOpacity>
        ) : (
          <View style={{
            backgroundColor: '#F8FAFC',
            borderRadius: 8,
            padding: 10,
            borderWidth: 1,
            borderColor: '#E2E8F0',
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="location-outline" size={16} color="#CBD5E1" />
              <Text style={{ fontSize: 13, color: '#CBD5E1' }}>
                Sem localização registrada
              </Text>
            </View>
          </View>
        )}
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#F8FAFC' }}>
      {/* Header */}
      <View style={{
        backgroundColor: '#0F172A',
        paddingHorizontal: 20,
        paddingTop: 56,
        paddingBottom: 20,
      }}>
        <Text style={{ fontSize: 22, fontWeight: '800', color: 'white', letterSpacing: -0.5 }}>
          Rastreamento
        </Text>
        <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>
          {trackedTools.length === 0
            ? 'Vincule tags às ferramentas para rastrear'
            : `${trackedTools.length} ferramenta${trackedTools.length !== 1 ? 's' : ''} rastreada${trackedTools.length !== 1 ? 's' : ''}`}
        </Text>
      </View>

      {trackedTools.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 }}>
          <Ionicons name="navigate-circle-outline" size={72} color="#CBD5E1" />
          <Text style={{ fontSize: 16, fontWeight: '600', color: '#64748B', marginTop: 16 }}>
            Nenhuma ferramenta rastreada
          </Text>
          <Text style={{ fontSize: 13, color: '#94A3B8', textAlign: 'center', marginTop: 8, lineHeight: 20 }}>
            Vincule tags Bluetooth às ferramentas na aba AirTag Setup para começar a rastrear
          </Text>
          <TouchableOpacity
            onPress={() => router.push('/(tabs)/airtag')}
            style={{
              marginTop: 24,
              backgroundColor: '#2563EB',
              borderRadius: 12,
              paddingHorizontal: 24,
              paddingVertical: 12,
            }}
          >
            <Text style={{ fontSize: 14, fontWeight: '700', color: 'white' }}>
              Configurar Tags
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 20 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        >
          {/* Auto-refresh pill */}
          <View style={{ alignItems: 'center', marginBottom: 12 }}>
            <View style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              backgroundColor: '#EFF6FF',
              borderRadius: 20,
              paddingHorizontal: 16,
              paddingVertical: 6,
              borderWidth: 1,
              borderColor: '#BFDBFE',
            }}>
              <Ionicons name="refresh" size={14} color="#2563EB" />
              <Text style={{ fontSize: 12, fontWeight: '600', color: '#2563EB' }}>
                Auto-refresh em {countdown}s
              </Text>
            </View>
          </View>

          {trackedTools.map(tool => renderToolCard(tool))}
        </ScrollView>
      )}
    </View>
  )
}
