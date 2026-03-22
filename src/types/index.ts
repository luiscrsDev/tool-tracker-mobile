export interface Contractor {
  id: string
  name: string
  email: string
  company?: string
  status: 'active' | 'inactive' | 'trial'
}

export interface Tool {
  id: string
  contractor_id: string
  name: string
  type: string
  value: number
  tag_id?: string | null
  status: string
  battery: number | null
  is_connected: boolean
  images?: string[] | null
  last_seen_location?: {
    latitude: number
    longitude: number
    address?: string
    timestamp?: string
  }
}

export interface BLEDevice {
  id: string
  name: string
  rssi: number
  serialNumber?: string
}
