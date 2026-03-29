import { useEffect, useState } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, Alert, ActivityIndicator, Image,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { useAuth } from '@/context/AuthContext'
import { useTools } from '@/context/ToolsContext'
import { takePhoto, pickFromGallery, uploadImage, searchProductImage } from '@/lib/imageService'

const INITIAL_FORM = {
  name: '',
  type: '',
  value: '',
  status: 'active',
}

export default function ToolFormScreen() {
  const router = useRouter()
  const { contractor } = useAuth()
  const { tools, addTool, updateTool } = useTools()
  const { toolId } = useLocalSearchParams<{ toolId?: string }>()

  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({ ...INITIAL_FORM })
  const [images, setImages] = useState<(string | null)[]>([null, null, null])
  const [scanning, setScanning] = useState(false)
  const [searchingProduct, setSearchingProduct] = useState(false)
  const [permission, requestPermission] = useCameraPermissions()

  const isEditing = !!toolId
  const tool = isEditing ? tools.find(t => t.id === toolId) : null

  useEffect(() => {
    if (tool) {
      setFormData({
        name: tool.name,
        type: tool.type,
        value: tool.value.toString(),
        status: tool.status,
      })
      setImages([
        tool.images?.[0] || null,
        tool.images?.[1] || null,
        tool.images?.[2] || null,
      ])
    } else if (!isEditing) {
      setFormData({ ...INITIAL_FORM })
      setImages([null, null, null])
    }
  }, [tool, isEditing])

  const handleBarcodeScan = async (barcode: string) => {
    setScanning(false)
    setSearchingProduct(true)
    try {
      const product = await searchProductImage(barcode)
      if (product) {
        setImages(prev => [product.image, prev[1], prev[2]])
        if (!formData.name) setFormData(prev => ({ ...prev, name: product.name }))
        Alert.alert('Produto encontrado!', product.name)
      } else {
        Alert.alert('Não encontrado', `Nenhum produto encontrado para o código ${barcode}`)
      }
    } finally {
      setSearchingProduct(false)
    }
  }

  const handleAddPhoto = async (index: number) => {
    Alert.alert('Adicionar foto', 'Escolha a origem:', [
      { text: 'Câmera', onPress: async () => {
        const uri = await takePhoto()
        if (uri) setImages(prev => { const n = [...prev]; n[index] = uri; return n })
      }},
      { text: 'Galeria', onPress: async () => {
        const uri = await pickFromGallery()
        if (uri) setImages(prev => { const n = [...prev]; n[index] = uri; return n })
      }},
      { text: 'Cancelar', style: 'cancel' },
    ])
  }

  const handleSave = async () => {
    if (!contractor?.id) return
    if (!formData.name.trim() || !formData.type.trim()) {
      Alert.alert('Validação', 'Preencha os campos obrigatórios: Nome e Tipo')
      return
    }

    try {
      setLoading(true)

      // Upload local images to Supabase Storage
      const tempId = tool?.id || `new_${Date.now()}`
      const uploadedImages: (string | null)[] = []
      for (let i = 0; i < 3; i++) {
        const img = images[i]
        if (!img) { uploadedImages.push(null); continue }
        if (img.startsWith('http')) { uploadedImages.push(img); continue } // already uploaded
        const url = await uploadImage(img, tempId, i)
        uploadedImages.push(url)
      }

      const data = {
        contractor_id: contractor.id,
        name: formData.name.trim(),
        type: formData.type.trim(),
        value: formData.value ? parseFloat(formData.value) : 0,
        status: formData.status,
        images: uploadedImages.filter(Boolean) as string[],
      }

      if (isEditing && tool) {
        await updateTool(tool.id, data)
      } else {
        await addTool(data)
      }

      setFormData({ ...INITIAL_FORM })
      setImages([null, null, null])
      router.replace('/(tabs)/tools')
    } catch (err) {
      Alert.alert('Erro', 'Falha ao salvar ferramenta')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  // Barcode scanner view
  if (scanning) {
    return (
      <View style={{ flex: 1, backgroundColor: 'black' }}>
        <CameraView
          style={{ flex: 1 }}
          barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'qr'] }}
          onBarcodeScanned={({ data }) => handleBarcodeScan(data)}
        >
          <View style={{ flex: 1, justifyContent: 'space-between' }}>
            <View style={{ paddingTop: 60, paddingHorizontal: 20 }}>
              <Text style={{ color: 'white', fontSize: 18, fontWeight: '700' }}>Escanear código de barras</Text>
              <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, marginTop: 4 }}>Aponte para o código do produto</Text>
            </View>
            <TouchableOpacity
              onPress={() => setScanning(false)}
              style={{ alignSelf: 'center', marginBottom: 60, backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 20 }}
            >
              <Text style={{ color: 'white', fontWeight: '700' }}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </CameraView>
      </View>
    )
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#f5f5f5' }}>
      <View style={{ backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#eee' }}>
        <Text style={{ fontSize: 24, fontWeight: 'bold' }}>
          {isEditing ? 'Editar Ferramenta' : 'Nova Ferramenta'}
        </Text>
      </View>

      <View style={{ padding: 16 }}>

        {/* Images */}
        <Text style={{ fontSize: 13, fontWeight: '600', color: '#666', marginBottom: 8 }}>Fotos</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
          {[0, 1, 2].map(i => (
            <TouchableOpacity
              key={i}
              onPress={() => handleAddPhoto(i)}
              style={{
                flex: 1, aspectRatio: 4/3, borderRadius: 8, overflow: 'hidden',
                backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0',
                borderStyle: images[i] ? 'solid' : 'dashed',
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              {images[i] ? (
                <Image source={{ uri: images[i]! }} style={{ width: '100%', height: '100%' }} />
              ) : (
                <View style={{ alignItems: 'center' }}>
                  <Ionicons name={i === 0 ? 'camera' : 'add-circle-outline'} size={24} color="#94A3B8" />
                  <Text style={{ fontSize: 9, color: '#94A3B8', marginTop: 4 }}>
                    {i === 0 ? 'Principal' : `Foto ${i + 1}`}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>

        {/* Barcode scanner button */}
        <TouchableOpacity
          onPress={async () => {
            if (!permission?.granted) await requestPermission()
            setScanning(true)
          }}
          disabled={searchingProduct}
          style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
            paddingVertical: 10, borderRadius: 8, backgroundColor: '#EFF6FF', marginBottom: 16,
            borderWidth: 1, borderColor: '#BFDBFE',
          }}
        >
          {searchingProduct ? (
            <><ActivityIndicator size="small" color="#2563EB" /><Text style={{ color: '#2563EB', fontWeight: '600', fontSize: 13 }}>Buscando produto...</Text></>
          ) : (
            <><Ionicons name="barcode-outline" size={18} color="#2563EB" /><Text style={{ color: '#2563EB', fontWeight: '600', fontSize: 13 }}>Escanear código de barras</Text></>
          )}
        </TouchableOpacity>

        {/* Name */}
        <Text style={{ fontSize: 13, fontWeight: '600', color: '#666', marginBottom: 8 }}>Nome da Ferramenta *</Text>
        <TextInput
          style={{ borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, backgroundColor: '#fff', marginBottom: 16 }}
          placeholder="Ex: Furadeira DeWalt" value={formData.name}
          onChangeText={text => setFormData({ ...formData, name: text })} editable={!loading}
        />

        {/* Type */}
        <Text style={{ fontSize: 13, fontWeight: '600', color: '#666', marginBottom: 8 }}>Tipo de Ferramenta *</Text>
        <TextInput
          style={{ borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, backgroundColor: '#fff', marginBottom: 16 }}
          placeholder="Ex: Furadeira, Chave, Nível" value={formData.type}
          onChangeText={text => setFormData({ ...formData, type: text })} editable={!loading}
        />

        {/* Value */}
        <Text style={{ fontSize: 13, fontWeight: '600', color: '#666', marginBottom: 8 }}>Valor (R$)</Text>
        <TextInput
          style={{ borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, backgroundColor: '#fff', marginBottom: 16 }}
          placeholder="0.00" value={formData.value}
          onChangeText={text => setFormData({ ...formData, value: text })} keyboardType="decimal-pad" editable={!loading}
        />

        {/* Status */}
        <Text style={{ fontSize: 13, fontWeight: '600', color: '#666', marginBottom: 8 }}>Status</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 24 }}>
          {(['active', 'maintenance', 'inactive'] as const).map(status => (
            <TouchableOpacity
              key={status}
              onPress={() => setFormData({ ...formData, status })}
              style={{
                flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1,
                borderColor: formData.status === status ? '#2563eb' : '#ddd',
                backgroundColor: formData.status === status ? '#eff6ff' : '#fff', alignItems: 'center',
              }}
              disabled={loading}
            >
              <Text style={{ fontSize: 12, fontWeight: '600', color: formData.status === status ? '#2563eb' : '#666' }}>
                {status === 'active' ? 'Ativo' : status === 'maintenance' ? 'Manutenção' : 'Inativo'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Buttons */}
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <TouchableOpacity
            onPress={() => router.replace('/(tabs)/tools')}
            style={{ flex: 1, paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: '#ddd', alignItems: 'center' }}
            disabled={loading}
          >
            <Text style={{ fontWeight: '600', color: '#666' }}>Cancelar</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleSave}
            style={{
              flex: 1, paddingVertical: 12, borderRadius: 8, backgroundColor: loading ? '#999' : '#2563eb',
              alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8,
            }}
            disabled={loading}
          >
            {loading && <ActivityIndicator color="#fff" size="small" />}
            <Text style={{ fontWeight: '600', color: '#fff' }}>{isEditing ? 'Atualizar' : 'Adicionar'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  )
}
