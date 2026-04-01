import { supabase } from '@/lib/supabase'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { ToolMovement } from '@/types'

// ── Config ──────────────────────────────────────────────────────────────
const MIN_DISTANCE_M = 15       // distância mínima pra considerar movimento (15m filtra GPS drift)
const STOP_TIMEOUT_MS = 4 * 60 * 1000  // 4 minutos parado = registra stop
const SPEED_THRESHOLD_KMH = 10  // acima = trânsito
const SPEED_COOLDOWN_MS = 2 * 60 * 1000  // min 2min entre registros speed

// ── State ───────────────────────────────────────────────────────────────
interface LastRecord {
  latitude: number
  longitude: number
  event: string
  timestamp: number
  toolId: string
}

const lastRecords = new Map<string, LastRecord>()  // por tool_id
const LAST_RECORDS_KEY = 'movement_last_records'
let stateRestored = false
let currentCheckoutId: string | null = null
let checkoutToolIds: string[] = []
let todayCheckoutDone = false
let stopTimer: ReturnType<typeof setTimeout> | null = null
let lastStopPosition: { lat: number; lng: number } | null = null

// ── Persist/Restore state ───────────────────────────────────────────────
async function persistLastRecords() {
  const obj: Record<string, LastRecord> = {}
  lastRecords.forEach((v, k) => { obj[k] = v })
  await AsyncStorage.setItem(LAST_RECORDS_KEY, JSON.stringify(obj)).catch(() => {})
}

async function restoreLastRecords() {
  if (stateRestored) return
  stateRestored = true
  try {
    const raw = await AsyncStorage.getItem(LAST_RECORDS_KEY)
    if (raw) {
      const obj = JSON.parse(raw) as Record<string, LastRecord>
      Object.entries(obj).forEach(([k, v]) => lastRecords.set(k, v))
      console.log(`[Movement] Restored ${lastRecords.size} last records from storage`)
    }
  } catch { /* ignore */ }
}

// ── Haversine ───────────────────────────────────────────────────────────
function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ── Checkout ────────────────────────────────────────────────────────────
export async function performCheckout(
  contractorId: string,
  toolIds: string[],
  siteId: string | null,
  lat: number,
  lng: number,
  workerId?: string,
): Promise<string> {
  const { data, error } = await supabase
    .from('tool_checkouts')
    .insert({
      contractor_id: contractorId,
      worker_id: workerId || null,
      tool_ids: toolIds,
      site_id: siteId,
    })
    .select('id')
    .single()

  if (error) throw new Error(error.message)

  currentCheckoutId = data.id
  checkoutToolIds = toolIds
  todayCheckoutDone = true

  // Registra evento checkout pra cada ferramenta
  for (const toolId of toolIds) {
    await saveMovement(toolId, contractorId, 'checkout', lat, lng, null, siteId)
  }

  console.log(`✅ Checkout: ${toolIds.length} ferramentas saíram`)
  return data.id
}

export function getCheckoutToolIds(): string[] {
  return checkoutToolIds
}

export function isCheckoutDone(): boolean {
  return todayCheckoutDone
}

export function resetDaily() {
  todayCheckoutDone = false
  currentCheckoutId = null
  checkoutToolIds = []
  lastRecords.clear()
}

// ── Save movement ───────────────────────────────────────────────────────
async function saveMovement(
  toolId: string,
  contractorId: string,
  event: ToolMovement['event'],
  lat: number,
  lng: number,
  speedKmh: number | null,
  siteId: string | null,
) {
  const { error } = await supabase.from('tool_movements').insert({
    tool_id: toolId,
    contractor_id: contractorId,
    checkout_id: currentCheckoutId,
    event,
    latitude: lat,
    longitude: lng,
    speed_kmh: speedKmh,
    site_id: siteId,
  })

  if (error) { console.warn(`[Movement] Save skipped: ${error.message}`); return }
  else console.log(`[Movement] ${event} → ${toolId.slice(0, 8)} (${lat.toFixed(4)}, ${lng.toFixed(4)}) ${speedKmh ? speedKmh.toFixed(0) + 'km/h' : ''}`)

  lastRecords.set(toolId, { latitude: lat, longitude: lng, event, timestamp: Date.now(), toolId })
  persistLastRecords()
}

// ── Process detection ───────────────────────────────────────────────────
/**
 * Chamado cada vez que um beacon BLE é detectado com posição GPS.
 * Aplica as 3 regras de registro inteligente.
 */
export async function processDetection(
  toolId: string,
  contractorId: string,
  lat: number,
  lng: number,
  speedMs: number | null,  // metros por segundo do GPS
  siteId: string | null,
  detectedToolIds: string[],  // todos os tags detectáveis neste momento
) {
  // Restaurar estado persistido (sobrevive reload)
  await restoreLastRecords()

  const speedKmh = speedMs != null ? speedMs * 3.6 : 0
  const now = Date.now()
  const last = lastRecords.get(toolId)

  // Primeira detecção: salvar posição mas NÃO gravar movimento (evita falso positivo)
  if (!last) {
    lastRecords.set(toolId, { latitude: lat, longitude: lng, event: 'detected', timestamp: now, toolId })
    persistLastRecords()
    console.log(`[Movement] First detection for ${toolId.slice(0, 8)} — position saved, no record`)
    return
  }

  const distFromLast = last
    ? distanceMeters(lat, lng, last.latitude, last.longitude)
    : Infinity

  const timeSinceLast = last ? now - last.timestamp : Infinity

  // ── Regra 1: MOVEMENT — >10m, <10km/h, tag detectável ──────────────
  if (distFromLast > MIN_DISTANCE_M && speedKmh < SPEED_THRESHOLD_KMH) {
    await saveMovement(toolId, contractorId, 'movement', lat, lng, speedKmh, siteId)

    // Reset stop timer (moveu-se)
    if (stopTimer) { clearTimeout(stopTimer); stopTimer = null }
    lastStopPosition = { lat, lng }

    // Start stop timer — se ficar parado >4min registra stop
    stopTimer = setTimeout(async () => {
      // Registra stop pra TODAS as ferramentas do checkout
      const toolsToRecord = checkoutToolIds.length > 0 ? checkoutToolIds : [toolId]
      for (const tid of toolsToRecord) {
        const lastRec = lastRecords.get(tid)
        // Só registra se último não foi stop no mesmo lugar
        if (lastRec?.event === 'stop') {
          const d = distanceMeters(lat, lng, lastRec.latitude, lastRec.longitude)
          if (d < MIN_DISTANCE_M) continue
        }
        await saveMovement(tid, contractorId, 'stop', lat, lng, 0, siteId)
      }
    }, STOP_TIMEOUT_MS)

    return
  }

  // ── Regra 3: SPEED — >10km/h, >2min, último ≠ speed, tag detectável ─
  if (speedKmh >= SPEED_THRESHOLD_KMH
    && timeSinceLast > SPEED_COOLDOWN_MS
    && last?.event !== 'speed') {

    // Registra pra todos os tags detectáveis (não checkout)
    for (const tid of detectedToolIds) {
      await saveMovement(tid, contractorId, 'speed', lat, lng, speedKmh, siteId)
    }

    // Reset stop timer
    if (stopTimer) { clearTimeout(stopTimer); stopTimer = null }
    return
  }

  // ── Regra 2: STOP é tratada pelo timer acima ─────────────────────────
  // (timer de 4min após último movimento)
}
