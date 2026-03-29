import { useState, useEffect, useCallback } from 'react'
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
  const [refreshing, setRefreshing] = useState(false)

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

  // Refresh every 30s
  useEffect(() => {
    if (trackedTools.length === 0) return
    const interval = setInterval(() => {
      loadLastKnownLocations(trackedTools.map(t => t.id))
    }, 30000)
    return () => clearInterval(interval)
  }, [trackedTools.length, loadLastKnownLocations])

  const handleRefresh = async () => {
    if (!contractor?.id) return
    setRefreshing(true)
    await refreshTools(contractor.id)
    await loadLastKnownLocations(trackedTools.map(t => t.id))
    setRefreshing(false)
  }

  const timeAgo = (timestamp?: string) => {
    if (!timestamp) return null
    const diff = Date.now() - new Date(timestamp).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'Agora'
    if (mins < 60) return `Há ${mins} min`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `Há ${hours}h`
    const days = Math.floor(hours / 24)
    return `Há ${days}d`
  }

  const renderToolCard = (tool: typeof tools[0]) => {
    const tag = tool.assigned_tag ? getTagById(tool.assigned_tag) : null
    const location = allToolLocations.get(tool.id) || tool.last_seen_location
    const locationLabel = location
      ? resolveLocation(location.latitude, location.longitude)
      : null
    const lastSeen = timeAgo(location?.timestamp)
    const battery = tag?.battery

    return (
      <View
        key={tool.id}
        style={{
          backgroundColor: 'white',
          borderRadius: 12,
          padding: 16,
          marginBottom: 10,
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
          <Ionicons name="location-outline" size={64} color="#CBD5E1" />
          <Text style={{ fontSize: 16, fontWeight: '600', color: '#64748B', marginTop: 16 }}>
            Nenhuma ferramenta rastreada
          </Text>
          <Text style={{ fontSize: 13, color: '#94A3B8', textAlign: 'center', marginTop: 8, lineHeight: 20 }}>
            Vincule tags Bluetooth às ferramentas na aba AirTag Setup para começar a rastrear
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        >
          {trackedTools.map(tool => renderToolCard(tool))}
        </ScrollView>
      )}
    </View>
  )
}
