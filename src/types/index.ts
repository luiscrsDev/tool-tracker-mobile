export interface Contractor {
  id: string
  name: string
  email: string
  company?: string
  status: 'active' | 'inactive' | 'trial'
}

export interface Tag {
  id: string
  contractor_id: string
  name: string
  tag_id: string       // BLE identifier (MAC or manufacturer data)
  status: 'active' | 'inactive'
  battery: number | null
  eik: string | null       // Ephemeral Identity Key (base64) for FMDN ring
  paired_at: string
  created_at: string
}

export interface Tool {
  id: string
  contractor_id: string
  name: string
  type: string
  value: number
  assigned_tag?: string | null  // FK → tags(id)
  status: string
  battery: number | null
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
