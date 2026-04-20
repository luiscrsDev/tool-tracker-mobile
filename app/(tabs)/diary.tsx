import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, TouchableOpacity, ScrollView, RefreshControl, Alert,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as Location from 'expo-location'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'

interface DiaryEntry {
  id: string
  event: string
  latitude: number
  longitude: number
  note: string | null
  created_at: string
}

export default function DiaryScreen() {
  const { contractor } = useAuth()
  const [entries, setEntries] = useState<DiaryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)

  const loadEntries = useCallback(async () => {
    if (!contractor?.id) return
    try {
      setLoading(true)
      const { data } = await supabase
        .from('diary_entries')
        .select('*')
        .eq('contractor_id', contractor.id)
        .order('created_at', { ascending: false })
        .limit(30)
      setEntries(data || [])
    } catch (err) {
      console.error('Diary load error:', err)
    } finally {
      setLoading(false)
    }
  }, [contractor?.id])

  useEffect(() => { loadEntries() }, [loadEntries])

  const onRefresh = async () => {
    setRefreshing(true)
    await loadEntries()
    setRefreshing(false)
  }

  const addEntry = async (event: string) => {
    if (!contractor?.id || saving) return
    setSaving(true)
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
      const { latitude, longitude } = pos.coords

      const { error } = await supabase.from('diary_entries').insert({
        contractor_id: contractor.id,
        event,
        latitude,
        longitude,
      })

      if (error) throw error
      await loadEntries()
    } catch (err) {
      Alert.alert('Erro', 'Falha ao salvar entrada')
      console.error('Diary save error:', err)
    } finally {
      setSaving(false)
    }
  }

  const formatDateTime = (ts: string) => {
    const d = new Date(ts)
    return d.toLocaleDateString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  }

  const eventConfig: Record<string, { icon: string; label: string; color: string }> = {
    departed: { icon: 'car', label: 'Saiu', color: '#2563EB' },
    arrived: { icon: 'location', label: 'Chegou', color: '#10B981' },
    stopped: { icon: 'pause-circle', label: 'Parou', color: '#F59E0B' },
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#F8FAFC' }}>
      <View style={{ backgroundColor: '#0F172A', paddingHorizontal: 20, paddingTop: 56, paddingBottom: 20 }}>
        <Text style={{ fontSize: 22, fontWeight: '800', color: 'white' }}>Diario</Text>
        <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>
          Registre paradas e saidas para comparar com o tracking
        </Text>
      </View>

      {/* Action Buttons */}
      <View style={{ flexDirection: 'row', gap: 10, padding: 20, paddingBottom: 10 }}>
        <TouchableOpacity
          onPress={() => addEntry('departed')}
          disabled={saving}
          style={{
            flex: 1, paddingVertical: 16, borderRadius: 12,
            backgroundColor: '#2563EB', alignItems: 'center',
            opacity: saving ? 0.5 : 1, flexDirection: 'row', justifyContent: 'center', gap: 8,
          }}
        >
          <Ionicons name="car" size={20} color="white" />
          <Text style={{ color: 'white', fontWeight: '700', fontSize: 15 }}>Sai</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => addEntry('stopped')}
          disabled={saving}
          style={{
            flex: 1, paddingVertical: 16, borderRadius: 12,
            backgroundColor: '#F59E0B', alignItems: 'center',
            opacity: saving ? 0.5 : 1, flexDirection: 'row', justifyContent: 'center', gap: 8,
          }}
        >
          <Ionicons name="pause-circle" size={20} color="white" />
          <Text style={{ color: 'white', fontWeight: '700', fontSize: 15 }}>Parei</Text>
        </TouchableOpacity>
      </View>

      <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingBottom: 10 }}>
        <TouchableOpacity
          onPress={() => addEntry('arrived')}
          disabled={saving}
          style={{
            flex: 1, paddingVertical: 16, borderRadius: 12,
            backgroundColor: '#10B981', alignItems: 'center',
            opacity: saving ? 0.5 : 1, flexDirection: 'row', justifyContent: 'center', gap: 8,
          }}
        >
          <Ionicons name="location" size={20} color="white" />
          <Text style={{ color: 'white', fontWeight: '700', fontSize: 15 }}>Cheguei</Text>
        </TouchableOpacity>
      </View>

      {/* Entries List */}
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingTop: 10 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {entries.length === 0 && !loading && (
          <View style={{ alignItems: 'center', paddingTop: 40 }}>
            <Ionicons name="journal-outline" size={64} color="#CBD5E1" />
            <Text style={{ fontSize: 15, fontWeight: '600', color: '#64748B', marginTop: 16 }}>
              Nenhuma entrada ainda
            </Text>
            <Text style={{ fontSize: 12, color: '#94A3B8', marginTop: 4 }}>
              Toque nos botoes acima para registrar
            </Text>
          </View>
        )}

        {entries.map((entry, idx) => {
          const config = eventConfig[entry.event] || { icon: 'ellipse', label: entry.event, color: '#94A3B8' }
          return (
            <View key={entry.id} style={{
              flexDirection: 'row', gap: 12, marginBottom: 12,
              backgroundColor: 'white', borderRadius: 12, padding: 14,
              borderLeftWidth: 4, borderLeftColor: config.color,
              shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, elevation: 1,
            }}>
              <View style={{
                width: 36, height: 36, borderRadius: 18,
                backgroundColor: config.color + '15', alignItems: 'center', justifyContent: 'center',
              }}>
                <Ionicons name={config.icon as any} size={18} color={config.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: '#0F172A' }}>{config.label}</Text>
                <Text style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>
                  {formatDateTime(entry.created_at)}
                </Text>
                <Text style={{ fontSize: 10, color: '#CBD5E1', marginTop: 2 }}>
                  {entry.latitude.toFixed(5)}, {entry.longitude.toFixed(5)}
                </Text>
              </View>
            </View>
          )
        })}
      </ScrollView>
    </View>
  )
}
