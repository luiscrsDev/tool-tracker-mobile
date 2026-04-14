import { requireNativeModule } from 'expo-modules-core'

interface ExpoBleTrackerModule {
  configure(url: string, key: string): void
  addTag(tagId: string, toolId: string, toolName: string, contractorId: string): void
  removeTag(tagId: string): void
  clearTags(): void
  startService(): boolean
  stopService(): boolean
  isRunning(): boolean
  getTagCount(): number
}

const NativeModule = requireNativeModule<ExpoBleTrackerModule>('ExpoBleTracker')

export function configure(supabaseUrl: string, supabaseKey: string): void {
  NativeModule.configure(supabaseUrl, supabaseKey)
}

export function addTag(tagId: string, toolId: string, toolName: string, contractorId: string): void {
  NativeModule.addTag(tagId, toolId, toolName, contractorId)
}

export function removeTag(tagId: string): void {
  NativeModule.removeTag(tagId)
}

export function clearTags(): void {
  NativeModule.clearTags()
}

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
