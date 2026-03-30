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

export interface Site {
  id: string
  contractor_id: string
  label: string
  latitude: number
  longitude: number
  radius_m: number
  address?: string | null
  created_at: string
}

export interface ToolCheckout {
  id: string
  worker_id: string | null
  contractor_id: string
  tool_ids: string[]
  site_id: string | null
  checked_out_at: string
  returned_at: string | null
}

export interface ToolMovement {
  id: string
  tool_id: string
  contractor_id: string
  checkout_id: string | null
  event: 'movement' | 'stop' | 'speed' | 'checkout'
  latitude: number
  longitude: number
  address: string | null
  site_id: string | null
  speed_kmh: number | null
  detected_by: string | null
  created_at: string
}

export interface BLEDevice {
  id: string
  name: string
  rssi: number
  serialNumber?: string
}
