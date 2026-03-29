import { useEffect, useState } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, Alert, Modal, ActivityIndicator,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '@/context/AuthContext'
import { useSites } from '@/context/SitesContext'
import * as Location from 'expo-location'

export default function SitesScreen() {
  const { contractor } = useAuth()
  const { sites, loading, refreshSites, addSite, updateSite, deleteSite } = useSites()
  const [showForm, setShowForm] = useState(false)
  const [editingSite, setEditingSite] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [address, setAddress] = useState('')
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [radius, setRadius] = useState('100')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (contractor?.id) refreshSites(contractor.id)
  }, [contractor?.id])

  const resetForm = () => {
    setLabel(''); setAddress(''); setLat(''); setLng(''); setRadius('100')
    setEditingSite(null); setShowForm(false)
  }

  const useCurrentLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== 'granted') { Alert.alert('Erro', 'Permissão de localização negada'); return }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
      setLat(loc.coords.latitude.toFixed(6))
      setLng(loc.coords.longitude.toFixed(6))
    } catch {
      Alert.alert('Erro', 'Não foi possível obter localização')
    }
  }

  const handleSave = async () => {
    if (!contractor?.id || !label.trim() || !lat || !lng) {
      Alert.alert('Validação', 'Preencha: Label, Latitude e Longitude')
      return
    }
    setSaving(true)
    try {
      if (editingSite) {
        await updateSite(editingSite, {
          label: label.trim(), address: address.trim() || null,
          latitude: parseFloat(lat), longitude: parseFloat(lng), radius_m: parseInt(radius) || 100,
        })
      } else {
        await addSite({
          contractor_id: contractor.id, label: label.trim(), address: address.trim() || null,
          latitude: parseFloat(lat), longitude: parseFloat(lng), radius_m: parseInt(radius) || 100,
        })
      }
      resetForm()
    } catch (err) {
      Alert.alert('Erro', (err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = (site: typeof sites[0]) => {
    setEditingSite(site.id)
    setLabel(site.label)
    setAddress(site.address || '')
    setLat(site.latitude.toString())
    setLng(site.longitude.toString())
    setRadius(site.radius_m.toString())
    setShowForm(true)
  }

  const handleDelete = (site: typeof sites[0]) => {
    Alert.alert('Deletar Site?', `Remover "${site.label}"?`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Deletar', style: 'destructive', onPress: () => deleteSite(site.id) },
    ])
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#F8FAFC' }}>
      <View style={{
        backgroundColor: '#0F172A', paddingHorizontal: 20, paddingTop: 56, paddingBottom: 20,
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end',
      }}>
        <View>
          <Text style={{ fontSize: 22, fontWeight: '800', color: 'white' }}>Sites</Text>
          <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>
            Locais pré-definidos
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => { resetForm(); setShowForm(true) }}
          style={{ backgroundColor: '#2563EB', borderRadius: 20, width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name="add" size={22} color="white" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator color="#2563EB" size="large" />
        </View>
      ) : sites.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 }}>
          <Ionicons name="business-outline" size={64} color="#CBD5E1" />
          <Text style={{ fontSize: 16, fontWeight: '600', color: '#64748B', marginTop: 16 }}>
            Nenhum site cadastrado
          </Text>
          <Text style={{ fontSize: 13, color: '#94A3B8', textAlign: 'center', marginTop: 8 }}>
            Adicione depósitos, obras e escritórios para identificar onde as ferramentas estão
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          {sites.map(site => (
            <View key={site.id} style={{
              backgroundColor: 'white', borderRadius: 12, padding: 16, marginBottom: 10,
              shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, elevation: 1,
            }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: '#0F172A' }}>{site.label}</Text>
                  {site.address ? (
                    <Text style={{ fontSize: 12, color: '#64748B', marginTop: 4 }}>{site.address}</Text>
                  ) : null}
                  <Text style={{ fontSize: 11, color: '#94A3B8', marginTop: 4 }}>
                    {site.latitude.toFixed(5)}, {site.longitude.toFixed(5)} · Raio: {site.radius_m}m
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity onPress={() => handleEdit(site)}>
                    <Ionicons name="create-outline" size={20} color="#2563EB" />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => handleDelete(site)}>
                    <Ionicons name="trash-outline" size={20} color="#EF4444" />
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      {/* Form Modal */}
      <Modal visible={showForm} transparent animationType="slide" onRequestClose={resetForm}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View style={{
            backgroundColor: 'white', borderTopLeftRadius: 24, borderTopRightRadius: 24,
            padding: 24, paddingBottom: 40,
          }}>
            <Text style={{ fontSize: 18, fontWeight: '800', marginBottom: 20 }}>
              {editingSite ? 'Editar Site' : 'Novo Site'}
            </Text>

            <Text style={{ fontSize: 12, fontWeight: '600', color: '#64748B', marginBottom: 6 }}>Label *</Text>
            <TextInput
              value={label} onChangeText={setLabel} placeholder="Ex: Warehouse Miami"
              style={{ borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 8, padding: 10, fontSize: 14, marginBottom: 12 }}
            />

            <Text style={{ fontSize: 12, fontWeight: '600', color: '#64748B', marginBottom: 6 }}>Endereço</Text>
            <TextInput
              value={address} onChangeText={setAddress} placeholder="Ex: 1234 NW 5th St, Miami"
              style={{ borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 8, padding: 10, fontSize: 14, marginBottom: 12 }}
            />

            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 12, fontWeight: '600', color: '#64748B', marginBottom: 6 }}>Latitude *</Text>
                <TextInput
                  value={lat} onChangeText={setLat} placeholder="25.789" keyboardType="decimal-pad"
                  style={{ borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 8, padding: 10, fontSize: 14 }}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 12, fontWeight: '600', color: '#64748B', marginBottom: 6 }}>Longitude *</Text>
                <TextInput
                  value={lng} onChangeText={setLng} placeholder="-80.193" keyboardType="decimal-pad"
                  style={{ borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 8, padding: 10, fontSize: 14 }}
                />
              </View>
            </View>

            <TouchableOpacity onPress={useCurrentLocation} style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
              paddingVertical: 10, borderRadius: 8, backgroundColor: '#EFF6FF', marginBottom: 12,
              borderWidth: 1, borderColor: '#BFDBFE',
            }}>
              <Ionicons name="navigate" size={16} color="#2563EB" />
              <Text style={{ color: '#2563EB', fontWeight: '600', fontSize: 13 }}>Usar localização atual</Text>
            </TouchableOpacity>

            <Text style={{ fontSize: 12, fontWeight: '600', color: '#64748B', marginBottom: 6 }}>Raio (metros)</Text>
            <TextInput
              value={radius} onChangeText={setRadius} placeholder="100" keyboardType="number-pad"
              style={{ borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 8, padding: 10, fontSize: 14, marginBottom: 20 }}
            />

            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity onPress={resetForm} style={{
                flex: 1, paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: '#E2E8F0', alignItems: 'center',
              }}>
                <Text style={{ fontWeight: '600', color: '#64748B' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleSave} disabled={saving} style={{
                flex: 2, paddingVertical: 12, borderRadius: 8, backgroundColor: '#2563EB', alignItems: 'center',
              }}>
                <Text style={{ fontWeight: '700', color: 'white' }}>{saving ? 'Salvando...' : 'Salvar'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  )
}
