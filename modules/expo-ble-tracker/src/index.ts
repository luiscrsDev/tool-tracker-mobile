import { requireNativeModule, EventEmitter, type Subscription } from 'expo-modules-core'

interface ExpoBleTrackerModule {
  configure(url: string, key: string): void
  addTag(tagId: string, toolId: string, toolName: string, contractorId: string): void
  removeTag(tagId: string): void
  clearTags(): void
  startService(): boolean
  stopService(): boolean
  isRunning(): boolean
  getTagCount(): number
  startForegroundScan(): boolean
  stopForegroundScan(): boolean
  ringTag(deviceId: string, command: string): Promise<boolean>
  pairTag(deviceId: string, tagName: string): Promise<boolean>
  getServiceStatus(): { isRunning: boolean; tagCount: number; lastScanTime: number }
}

const NativeModule = requireNativeModule<ExpoBleTrackerModule>('ExpoBleTracker')
const emitter = new EventEmitter(NativeModule)

// ─── Config ──────────────────────────────────────────────────────────────

export function configure(supabaseUrl: string, supabaseKey: string): void {
  NativeModule.configure(supabaseUrl, supabaseKey)
}

// ─── Tag Management ──────────────────────────────────────────────────────

export function addTag(tagId: string, toolId: string, toolName: string, contractorId: string): void {
  NativeModule.addTag(tagId, toolId, toolName, contractorId)
}

export function removeTag(tagId: string): void {
  NativeModule.removeTag(tagId)
}

export function clearTags(): void {
  NativeModule.clearTags()
}

// ─── Background Service ─────────────────────────────────────────────────

export function startService(): boolean {
  return NativeModule.startService()
}

export function stopService(): boolean {
  return NativeModule.stopService()
}

export function isRunning(): boolean {
  return NativeModule.isRunning()
}

export function getTagCount(): number {
  return NativeModule.getTagCount()
}

export function getServiceStatus(): { isRunning: boolean; tagCount: number; lastScanTime: number } {
  return NativeModule.getServiceStatus()
}

// ─── Foreground Scan ─────────────────────────────────────────────────────

export function startForegroundScan(): boolean {
  return NativeModule.startForegroundScan()
}

export function stopForegroundScan(): boolean {
  return NativeModule.stopForegroundScan()
}

// ─── Ring (LED/Buzzer) ───────────────────────────────────────────────────

export function ringTag(deviceId: string, command: 'led' | 'buzzer' | 'both'): Promise<boolean> {
  return NativeModule.ringTag(deviceId, command)
}

// ─── Pair ────────────────────────────────────────────────────────────────

export function pairTag(deviceId: string, tagName: string): Promise<boolean> {
  return NativeModule.pairTag(deviceId, tagName)
}

// ─── Events ──────────────────────────────────────────────────────────────

export type ScannedDevice = {
  id: string
  name: string
  rssi: number
  manufacturerData: string
}

export type TagDetection = {
  tagId: string
  toolId: string
  toolName: string
  lat: number
  lng: number
  event: string
}

export type ScanState = {
  scanning: boolean
}

export type PairResult = {
  success: boolean
  deviceId: string
  message: string
}

export type RingResult = {
  success: boolean
  deviceId: string
  message: string
}

export function addDeviceFoundListener(cb: (device: ScannedDevice) => void): Subscription {
  return emitter.addListener('onDeviceFound', cb)
}

export function addTagDetectedListener(cb: (detection: TagDetection) => void): Subscription {
  return emitter.addListener('onTagDetected', cb)
}

export function addScanStateListener(cb: (state: ScanState) => void): Subscription {
  return emitter.addListener('onScanStateChange', cb)
}

export function addPairResultListener(cb: (result: PairResult) => void): Subscription {
  return emitter.addListener('onPairResult', cb)
}

export function addRingResultListener(cb: (result: RingResult) => void): Subscription {
  return emitter.addListener('onRingResult', cb)
}
