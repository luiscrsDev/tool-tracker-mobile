import { useEffect, useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Switch,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'

interface AlertSettings {
  id?: string
  contractor_id: string
  notify_out_of_range: boolean
  notify_low_battery: boolean
  notify_idle_2h: boolean
  notify_missing_24h: boolean
  alert_range_km: number
}

export default function SettingsScreen() {
  const { contractor } = useAuth()
  const [settings, setSettings] = useState<AlertSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (contractor?.id) fetchSettings()
  }, [contractor?.id])

  const fetchSettings = async () => {
    if (!contractor?.id) return
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('alert_settings')
        .select('*')
        .eq('contractor_id', contractor.id)
        .single()

      if (error?.code === 'PGRST116' || !data) {
        setSettings({
          contractor_id: contractor.id,
          notify_out_of_range: true,
          notify_low_battery: true,
          notify_idle_2h: true,
          notify_missing_24h: true,
          alert_range_km: 10,
        })
      } else {
        setSettings(data)
      }
    } catch (err) {
      console.error('Erro ao carregar configurações:', err)
    } finally {
      setLoading(false)
    }
  }

  const saveSettings = async () => {
    if (!settings || !contractor?.id) return
    try {
      setSaving(true)
      const { error } = await supabase
        .from('alert_settings')
        .upsert({
          contractor_id: contractor.id,
          notify_out_of_range: settings.notify_out_of_range,
          notify_low_battery: settings.notify_low_battery,
          notify_idle_2h: settings.notify_idle_2h,
          notify_missing_24h: settings.notify_missing_24h,
          alert_range_km: settings.alert_range_km,
          updated_at: new Date().toISOString(),
        })

      if (error) throw error
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch {
      Alert.alert('Erro', 'Falha ao salvar configurações')
    } finally {
      setSaving(false)
    }
  }

  const toggle = (key: keyof AlertSettings) => {
    if (!settings) return
    setSettings({ ...settings, [key]: !settings[key as keyof AlertSettings] })
  }

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F8FAFC' }}>
        <ActivityIndicator color="#2563EB" size="large" />
      </View>
    )
  }

  if (!settings) return null

  const toggleItems = [
    {
      key: 'notify_out_of_range' as keyof AlertSettings,
      title: 'Fora do range',
      desc: 'Alerta quando a ferramenta sair da zona de segurança',
      emoji: '📡',
    },
    {
      key: 'notify_low_battery' as keyof AlertSettings,
      title: 'Bateria baixa',
      desc: 'Alerta quando a bateria estiver abaixo de 10%',
      emoji: '🔋',
    },
    {
      key: 'notify_idle_2h' as keyof AlertSettings,
      title: 'Parada > 2 horas',
      desc: 'Alerta quando a ferramenta não se move por 2 horas',
      emoji: '⏱',
    },
    {
      key: 'notify_missing_24h' as keyof AlertSettings,
      title: 'Offline > 24 horas',
      desc: 'Alerta quando a ferramenta ficar offline por mais de 24h',
      emoji: '📵',
    },
  ]

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
          Configurações
        </Text>
        <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>
          {contractor?.company?.toUpperCase()}
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>

        {/* Notificações */}
        <View style={{
          backgroundColor: 'white',
          borderRadius: 12,
          padding: 16,
          shadowColor: '#000',
          shadowOpacity: 0.05,
          shadowRadius: 6,
          elevation: 1,
        }}>
          <Text style={{ fontSize: 10, fontWeight: '700', color: '#94A3B8', letterSpacing: 1, marginBottom: 16 }}>
            ALERTAS AUTOMÁTICOS
          </Text>

          <View style={{ gap: 0 }}>
            {toggleItems.map((item, i) => (
              <View key={item.key}>
                <View style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  paddingVertical: 14,
                }}>
                  <View style={{
                    width: 38,
                    height: 38,
                    borderRadius: 10,
                    backgroundColor: '#F1F5F9',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    <Text style={{ fontSize: 18 }}>{item.emoji}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: '600', color: '#0F172A', marginBottom: 2 }}>
                      {item.title}
                    </Text>
                    <Text style={{ fontSize: 11, color: '#94A3B8', lineHeight: 16 }}>
                      {item.desc}
                    </Text>
                  </View>
                  <Switch
                    value={settings[item.key] as boolean}
                    onValueChange={() => toggle(item.key)}
                    trackColor={{ false: '#E2E8F0', true: '#BFDBFE' }}
                    thumbColor={settings[item.key] ? '#2563EB' : '#CBD5E1'}
                  />
                </View>
                {i < toggleItems.length - 1 && (
                  <View style={{ height: 1, backgroundColor: '#F1F5F9' }} />
                )}
              </View>
            ))}
          </View>
        </View>

        {/* Range */}
        <View style={{
          backgroundColor: 'white',
          borderRadius: 12,
          padding: 16,
          shadowColor: '#000',
          shadowOpacity: 0.05,
          shadowRadius: 6,
          elevation: 1,
        }}>
          <Text style={{ fontSize: 10, fontWeight: '700', color: '#94A3B8', letterSpacing: 1, marginBottom: 16 }}>
            ZONA DE SEGURANÇA
          </Text>
          <Text style={{ fontSize: 14, fontWeight: '600', color: '#0F172A', marginBottom: 4 }}>
            Range de alerta
          </Text>
          <Text style={{ fontSize: 12, color: '#94A3B8', marginBottom: 12 }}>
            Distância máxima permitida para a ferramenta
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <TextInput
              value={String(settings.alert_range_km)}
              onChangeText={(v) => setSettings({ ...settings, alert_range_km: parseInt(v) || 0 })}
              keyboardType="number-pad"
              style={{
                flex: 1,
                borderWidth: 1.5,
                borderColor: '#E2E8F0',
                borderRadius: 10,
                paddingHorizontal: 14,
                paddingVertical: 12,
                fontSize: 16,
                fontWeight: '700',
                color: '#0F172A',
              }}
            />
            <View style={{
              paddingHorizontal: 14,
              paddingVertical: 12,
              backgroundColor: '#EFF6FF',
              borderRadius: 10,
            }}>
              <Text style={{ color: '#2563EB', fontWeight: '700', fontSize: 14 }}>km</Text>
            </View>
          </View>
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

        {/* Salvar */}
        <TouchableOpacity
          onPress={saveSettings}
          disabled={saving}
          style={{
            backgroundColor: saved ? '#10B981' : '#2563EB',
            borderRadius: 12,
            paddingVertical: 16,
            alignItems: 'center',
            opacity: saving ? 0.7 : 1,
            marginBottom: 8,
          }}
        >
          {saving ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text style={{ color: 'white', fontWeight: '700', fontSize: 15 }}>
              {saved ? '✓ Configurações Salvas!' : 'Salvar Configurações'}
            </Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </View>
  )
}
