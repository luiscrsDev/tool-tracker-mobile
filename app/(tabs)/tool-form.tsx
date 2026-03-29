import { useEffect, useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { useAuth } from '@/context/AuthContext'
import { useTools } from '@/context/ToolsContext'

const INITIAL_FORM = {
  name: '',
  type: '',
  value: '',
  battery: '',
  status: 'active',
}

export default function ToolFormScreen() {
  const router = useRouter()
  const { contractor } = useAuth()
  const { tools, addTool, updateTool } = useTools()
  const { toolId } = useLocalSearchParams<{ toolId?: string }>()

  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({ ...INITIAL_FORM })

  const isEditing = !!toolId
  const tool = isEditing ? tools.find(t => t.id === toolId) : null

  useEffect(() => {
    if (tool) {
      setFormData({
        name: tool.name,
        type: tool.type,
        value: tool.value.toString(),
        battery: tool.battery?.toString() || '',
        status: tool.status,
      })
    } else if (!isEditing) {
      // Reset form when creating new tool (fix: campos não limpavam após salvar)
      setFormData({ ...INITIAL_FORM })
    }
  }, [tool, isEditing])

  const handleSave = async () => {
    if (!contractor?.id) return

    if (!formData.name.trim() || !formData.type.trim()) {
      Alert.alert('Validação', 'Preencha os campos obrigatórios: Nome e Tipo')
      return
    }

    try {
      setLoading(true)
      const data = {
        contractor_id: contractor.id,
        name: formData.name.trim(),
        type: formData.type.trim(),
        value: formData.value ? parseFloat(formData.value) : 0,
        battery: formData.battery ? parseInt(formData.battery, 10) : null,
        status: formData.status,
      }

      if (isEditing && tool) {
        await updateTool(tool.id, data)
      } else {
        await addTool(data)
      }

      setFormData({ ...INITIAL_FORM })
      router.replace('/(tabs)/tools')
    } catch (err) {
      Alert.alert('Erro', 'Falha ao salvar ferramenta')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#f5f5f5' }}>
      {/* Header */}
      <View
        style={{
          backgroundColor: '#fff',
          paddingHorizontal: 16,
          paddingVertical: 16,
          borderBottomWidth: 1,
          borderBottomColor: '#eee',
        }}
      >
        <Text style={{ fontSize: 24, fontWeight: 'bold' }}>
          {isEditing ? '✏️ Editar Ferramenta' : '➕ Nova Ferramenta'}
        </Text>
      </View>

      {/* Form */}
      <View style={{ padding: 16 }}>
        {/* Name */}
        <View style={{ marginBottom: 16 }}>
          <Text style={{ fontSize: 13, fontWeight: '600', color: '#666', marginBottom: 8 }}>
            Nome da Ferramenta *
          </Text>
          <TextInput
            style={{
              borderWidth: 1, borderColor: '#ddd', borderRadius: 8,
              paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, backgroundColor: '#fff',
            }}
            placeholder="Ex: Furadeira DeWalt"
            value={formData.name}
            onChangeText={text => setFormData({ ...formData, name: text })}
            editable={!loading}
          />
        </View>

        {/* Type */}
        <View style={{ marginBottom: 16 }}>
          <Text style={{ fontSize: 13, fontWeight: '600', color: '#666', marginBottom: 8 }}>
            Tipo de Ferramenta *
          </Text>
          <TextInput
            style={{
              borderWidth: 1, borderColor: '#ddd', borderRadius: 8,
              paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, backgroundColor: '#fff',
            }}
            placeholder="Ex: Furadeira, Chave, Nível"
            value={formData.type}
            onChangeText={text => setFormData({ ...formData, type: text })}
            editable={!loading}
          />
        </View>

        {/* Value */}
        <View style={{ marginBottom: 16 }}>
          <Text style={{ fontSize: 13, fontWeight: '600', color: '#666', marginBottom: 8 }}>
            Valor (R$)
          </Text>
          <TextInput
            style={{
              borderWidth: 1, borderColor: '#ddd', borderRadius: 8,
              paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, backgroundColor: '#fff',
            }}
            placeholder="0.00"
            value={formData.value}
            onChangeText={text => setFormData({ ...formData, value: text })}
            keyboardType="decimal-pad"
            editable={!loading}
          />
        </View>

        {/* Status */}
        <View style={{ marginBottom: 24 }}>
          <Text style={{ fontSize: 13, fontWeight: '600', color: '#666', marginBottom: 8 }}>
            Status
          </Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {(['active', 'maintenance', 'inactive'] as const).map(status => (
              <TouchableOpacity
                key={status}
                onPress={() => setFormData({ ...formData, status })}
                style={{
                  flex: 1, paddingVertical: 10, borderRadius: 8,
                  borderWidth: 1,
                  borderColor: formData.status === status ? '#2563eb' : '#ddd',
                  backgroundColor: formData.status === status ? '#eff6ff' : '#fff',
                  alignItems: 'center',
                }}
                disabled={loading}
              >
                <Text
                  style={{
                    fontSize: 12, fontWeight: '600',
                    color: formData.status === status ? '#2563eb' : '#666',
                  }}
                >
                  {status === 'active' ? 'Ativo' : status === 'maintenance' ? 'Manutenção' : 'Inativo'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Buttons */}
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <TouchableOpacity
            onPress={() => router.replace('/(tabs)/tools')}
            style={{
              flex: 1, paddingVertical: 12, borderRadius: 8,
              borderWidth: 1, borderColor: '#ddd', alignItems: 'center',
            }}
            disabled={loading}
          >
            <Text style={{ fontWeight: '600', color: '#666' }}>Cancelar</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleSave}
            style={{
              flex: 1, paddingVertical: 12, borderRadius: 8,
              backgroundColor: loading ? '#999' : '#2563eb', alignItems: 'center',
              flexDirection: 'row', justifyContent: 'center', gap: 8,
            }}
            disabled={loading}
          >
            {loading && <ActivityIndicator color="#fff" size="small" />}
            <Text style={{ fontWeight: '600', color: '#fff' }}>
              {isEditing ? 'Atualizar' : 'Adicionar'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  )
}
