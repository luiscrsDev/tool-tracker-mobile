import { supabase } from '@/lib/supabase'
import * as ImagePicker from 'expo-image-picker'

const BUCKET = 'tool-images'

/**
 * Pick image from camera
 */
export async function takePhoto(): Promise<string | null> {
  const { status } = await ImagePicker.requestCameraPermissionsAsync()
  if (status !== 'granted') return null

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    quality: 0.7,
    allowsEditing: true,
    aspect: [4, 3],
  })

  if (result.canceled || !result.assets[0]) return null
  return result.assets[0].uri
}

/**
 * Pick image from gallery
 */
export async function pickFromGallery(): Promise<string | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.7,
    allowsEditing: true,
    aspect: [4, 3],
  })

  if (result.canceled || !result.assets[0]) return null
  return result.assets[0].uri
}

/**
 * Upload image to Supabase Storage
 * Returns the public URL
 */
export async function uploadImage(uri: string, toolId: string, index: number): Promise<string | null> {
  try {
    const ext = uri.split('.').pop()?.toLowerCase() || 'jpg'
    const path = `${toolId}/${index}_${Date.now()}.${ext}`

    // React Native: use FormData for upload
    const formData = new FormData()
    formData.append('file', {
      uri,
      name: `${index}.${ext}`,
      type: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
    } as any)

    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, formData, { contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`, upsert: true })

    if (error) {
      console.warn('Upload error:', error.message)
      return null
    }

    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path)
    return urlData.publicUrl
  } catch (err) {
    console.warn('Upload failed:', (err as Error)?.message)
    return null
  }
}

/**
 * Search product image by barcode (UPC/EAN)
 * Uses UPC ItemDB free API
 */
export async function searchProductImage(barcode: string): Promise<{ name: string; image: string } | null> {
  try {
    // Try UPC ItemDB
    const res = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${barcode}`)
    if (res.ok) {
      const data = await res.json()
      if (data.items?.[0]) {
        const item = data.items[0]
        const image = item.images?.[0] || null
        return image ? { name: item.title || barcode, image } : null
      }
    }
  } catch { /* ignore */ }

  try {
    // Fallback: Open Food Facts
    const res = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`)
    if (res.ok) {
      const data = await res.json()
      if (data.product?.image_url) {
        return { name: data.product.product_name || barcode, image: data.product.image_url }
      }
    }
  } catch { /* ignore */ }

  return null
}
