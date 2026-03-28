import { useEffect, useState } from 'react'
import {
  View, Text, TouchableOpacity, ActivityIndicator,
  FlatList, Modal, TextInput, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useBluetooth } from '@/context/BluetoothContext'
import { useTools } from '@/context/ToolsContext'
import { useTags } from '@/context/TagsContext'
import { useAuth } from '@/context/AuthContext'

// UUIDs conhecidos para referência
const KNOWN_UUIDS: Record<string, string> = {
  '00001800-0000-1000-8000-00805f9b34fb': 'Generic Access',
  '00001801-0000-1000-8000-00805f9b34fb': 'Generic Attribute',
  '00001802-0000-1000-8000-00805f9b34fb': '✅ Immediate Alert (beep)',
  '00001803-0000-1000-8000-00805f9b34fb': 'Link Loss',
  '00001804-0000-1000-8000-00805f9b34fb': 'Tx Power',
  '0000180a-0000-1000-8000-00805f9b34fb': 'Device Information',
  '0000180f-0000-1000-8000-00805f9b34fb': 'Battery Service',
  '00002a06-0000-1000-8000-00805f9b34fb': 'Alert Level',
  '00002a19-0000-1000-8000-00805f9b34fb': 'Battery Level',
}

interface PairingDevice {
  id: string
  name: string | null
  rssi: number
  manufacturerData?: string | null
}

// Returns true for Apple Find My accessories (rotating MAC — must use mfr data as stable key)
function isAppleFindMy(mfrData?: string | null): boolean {
  if (!mfrData) return false
  try {
    const bytes = Uint8Array.from(atob(mfrData), c => c.charCodeAt(0))
    return bytes[0] === 0x4C && bytes[1] === 0x00
  } catch { return false }
}

function stableTagId(device: PairingDevice): string {
  return isAppleFindMy(device.manufacturerData) && device.manufacturerData
    ? device.manufacturerData
    : device.id
}

export default function AirTagScreen() {
  const { contractor } = useAuth()
  const { startScanning, stopScanning, devices, scanning, inspectDevice, readStableId, playSound, playTuyaSound, ringFMDN, provisionEIK, selectedDevice, error } = useBluetooth()
  const { tools, linkTag } = useTools()
  const { tags, createTag, refreshTags } = useTags()

  const [pairing, setPairing] = useState(false)
  const [beepingId, setBeepingId] = useState<string | null>(null)
  const [inspectingId, setInspectingId] = useState<string | null>(null)
  const [inspectResult, setInspectResult] = useState<{ device: string; services: { uuid: string; characteristics: string[] }[] } | null>(null)
  const [sheet, setSheet] = useState<PairingDevice | null>(null)
  const [tagName, setTagName] = useState('')
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null)
  const [toolDropdownOpen, setToolDropdownOpen] = useState(false)
  const [step, setStep] = useState<'confirm' | 'form' | 'done'>('confirm')

  useEffect(() => {
    if (contractor?.id) refreshTags(contractor.id)
  }, [contractor?.id])

  useEffect(() => {
    return () => { if (scanning) stopScanning() }
  }, [scanning, stopScanning])

  const openSheet = (device: PairingDevice) => {
    setSheet(device)
    setTagName(device.name || '')
    setSelectedToolId(null)
    setToolDropdownOpen(false)
    setStep('confirm')
  }

  const renderDeviceCard = (item: PairingDevice, isPaired: boolean, inRange = true) => {
    const signalBars = item.rssi > -60 ? 3 : item.rssi > -80 ? 2 : 1
    const proximityLabel = item.rssi > -55 ? '📍 Muito próximo' : item.rssi > -70 ? '🔵 Próximo' : '🔘 Distante'
    const tagRecord = tags.find(t => t.tag_id === item.id)
    const linkedTool = tagRecord ? tools.find(t => t.assigned_tag === tagRecord.id) : null
    const displayName = item.name && item.name !== 'Anonymous'
      ? item.name
      : isAppleFindMy(item.manufacturerData) ? 'Find Easy' : item.name ?? 'Desconhecido'

    return (
      <TouchableOpacity
        key={item.id}
        onPress={() => openSheet(item)}
        activeOpacity={0.8}
        style={{
          backgroundColor: isPaired ? 'rgba(16,185,129,0.07)' : '#1E293B',
          borderRadius: 14, padding: 16,
          borderWidth: 1,
          borderColor: isPaired ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.07)',
          flexDirection: 'row', alignItems: 'center', gap: 14,
          marginBottom: 10,
        }}
      >
        <View style={{
          width: 44, height: 44, borderRadius: 12,
          backgroundColor: isPaired ? 'rgba(16,185,129,0.15)' : 'rgba(37,99,235,0.15)',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Ionicons name="bluetooth" size={22} color={isPaired ? '#10B981' : '#60A5FA'} />
        </View>

        <View style={{ flex: 1 }}>
          <Text style={{ color: 'white', fontWeight: '700', fontSize: 15 }}>
            {displayName}
          </Text>
          {isPaired && linkedTool ? (
            <Text style={{ color: '#10B981', fontSize: 11, marginTop: 2 }}>
              🔗 {linkedTool.name}
            </Text>
          ) : (
            <Text style={{ color: 'rgba(255,255,255,0.25)', fontSize: 10, marginTop: 2 }}>
              {item.rssi} dBm · {proximityLabel}
            </Text>
          )}
        </View>

        {/* Beep */}
        <TouchableOpacity
          onPress={async e => {
            e.stopPropagation()
            setBeepingId(item.id)
            try {
              if (scanning) await stopScanning()
              // Tenta FMDN ring autenticado primeiro (se tag tem EIK)
              const tagRec = tags.find(t => t.tag_id === item.id)
              if (tagRec?.eik) {
                const ok = await ringFMDN(item.id, tagRec.eik)
                if (ok) { setBeepingId(null); return }
              }
              // Fallback: protocolos genéricos (playTuyaSound já tenta tudo incluindo Immediate Alert)
              await playTuyaSound(item.id)
            } catch { /* não suporta beep */ } finally {
              setBeepingId(null)
            }
          }}
          disabled={beepingId === item.id}
          style={{
            width: 38, height: 38, borderRadius: 10,
            backgroundColor: beepingId === item.id ? 'rgba(250,204,21,0.2)' : 'rgba(255,255,255,0.06)',
            alignItems: 'center', justifyContent: 'center',
            borderWidth: 1, borderColor: beepingId === item.id ? 'rgba(250,204,21,0.4)' : 'rgba(255,255,255,0.08)',
          }}
        >
          {beepingId === item.id
            ? <ActivityIndicator size="small" color="#FACC15" />
            : <Ionicons name="volume-high" size={16} color="rgba(255,255,255,0.5)" />
          }
        </TouchableOpacity>

        {/* Inspect */}
        <TouchableOpacity
          onPress={async e => {
            e.stopPropagation()
            setInspectingId(item.id)
            if (scanning) await stopScanning()
            const result = await inspectDevice(item.id)
            setInspectingId(null)
            if (result) setInspectResult({ device: item.name || item.id, services: result.services })
          }}
          disabled={inspectingId === item.id}
          style={{
            width: 38, height: 38, borderRadius: 10,
            backgroundColor: inspectingId === item.id ? 'rgba(139,92,246,0.2)' : 'rgba(255,255,255,0.06)',
            alignItems: 'center', justifyContent: 'center',
            borderWidth: 1, borderColor: inspectingId === item.id ? 'rgba(139,92,246,0.4)' : 'rgba(255,255,255,0.08)',
          }}
        >
          {inspectingId === item.id
            ? <ActivityIndicator size="small" color="#A78BFA" />
            : <Ionicons name="search" size={16} color="rgba(255,255,255,0.5)" />
          }
        </TouchableOpacity>

        {/* Signal */}
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          {inRange ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2 }}>
                {[1, 2, 3].map(b => (
                  <View key={b} style={{
                    width: 4, borderRadius: 2,
                    height: b === 1 ? 8 : b === 2 ? 12 : 16,
                    backgroundColor: b <= signalBars ? (isPaired ? '#10B981' : '#60A5FA') : 'rgba(255,255,255,0.15)',
                  }} />
                ))}
              </View>
              <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10 }}>{item.rssi} dBm</Text>
            </>
          ) : (
            <Text style={{ color: 'rgba(255,255,255,0.2)', fontSize: 10 }}>fora de alcance</Text>
          )}
          {isPaired && <Text style={{ color: '#10B981', fontSize: 10, fontWeight: '700' }}>PAREADO</Text>}
        </View>
      </TouchableOpacity>
    )
  }

  const closeSheet = () => {
    setSheet(null)
    setStep('confirm')
    setTagName('')
    setSelectedToolId(null)
  }

  const [pairError, setPairError] = useState<string | null>(null)

  const handlePair = async () => {
    if (!sheet || !contractor?.id) return
    if (!tagName.trim()) return

    setPairing(true)
    setPairError(null)

    try {
      // Parar scan ANTES de qualquer operação GATT (Android não permite scan + GATT simultâneo)
      if (scanning) await stopScanning()

      // Determinar o BLE identifier estável
      let bleTagId: string
      if (isAppleFindMy(sheet.manufacturerData)) {
        console.log('[Pair] Lendo stable ID via GATT...')
        const gattId = await readStableId(sheet.id)
        bleTagId = gattId ?? stableTagId(sheet)
        console.log(`[Pair] tag_id final: ${bleTagId}`)
      } else {
        bleTagId = stableTagId(sheet)
      }

      // 1. Provisionar EIK no tracker (FMDN — permite ring autenticado depois)
      let eik: string | null = null
      try {
        console.log('[Pair] Provisionando EIK no tracker...')
        eik = await provisionEIK(sheet.id)
        console.log(`[Pair] EIK: ${eik ? 'OK' : 'não suportado'}`)
      } catch {
        console.warn('[Pair] EIK provisioning failed, continuing without')
      }

      // 2. Cria/atualiza o registro na tabela tags
      const tagRecord = await createTag({
        contractor_id: contractor.id,
        name: tagName.trim(),
        tag_id: bleTagId,
        eik,
      })

      // 2. Se selecionou ferramenta, vincula
      if (selectedToolId) {
        await linkTag(selectedToolId, tagRecord.id)
      }

      setStep('done')
      if (scanning) await stopScanning()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao salvar pareamento'
      setPairError(msg)
    } finally {
      setPairing(false)
    }
  }

  const selectedToolName = tools.find(t => t.id === selectedToolId)?.name

  // Tags já registradas — BLE identifiers conhecidos
  const registeredBleIds = new Set(tags.map(t => t.tag_id))

  // Ferramentas com tag vinculado
  const pairedTools = tools.filter(t => t.assigned_tag)

  // Dispositivos encontrados no scan que ainda não estão pareados
  // Só mostra: devices com nome contendo "find" OU devices Apple Find My (mfr 4C00)
  const pairedTagIds = registeredBleIds
  const unpairedDevices = devices
    .filter(d => {
      const tagId = stableTagId(d)
      if (pairedTagIds.has(tagId) || pairedTagIds.has(d.id)) return false
      return (d.name?.toLowerCase().includes('find') ?? false) || isAppleFindMy(d.manufacturerData)
    })
    .sort((a, b) => b.rssi - a.rssi) // strongest signal (closest) first

  // Para cada ferramenta pareada, pega o sinal atual do scan (se estiver visível)
  // Indexa por device.id E por manufacturerData para achar Apple devices com MAC rotativo
  const scannedById = new Map<string, typeof devices[0]>()
  devices.forEach(d => {
    scannedById.set(d.id, d)
    if (d.manufacturerData) scannedById.set(d.manufacturerData, d)
  })

  return (
    <View style={{ flex: 1, backgroundColor: '#0F172A' }}>
      {/* Header */}
      <View style={{ paddingHorizontal: 20, paddingTop: 56, paddingBottom: 20 }}>
        <Text style={{ fontSize: 22, fontWeight: '800', color: 'white', letterSpacing: -0.5 }}>
          AirTag Setup
        </Text>
        <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>
          Parear dispositivos Bluetooth
        </Text>
      </View>

      {/* Scan button */}
      <View style={{ paddingHorizontal: 16, marginBottom: 16 }}>
        <TouchableOpacity
          onPress={scanning ? stopScanning : startScanning}
          style={{
            borderRadius: 14, paddingVertical: 14,
            alignItems: 'center', flexDirection: 'row',
            justifyContent: 'center', gap: 10,
            backgroundColor: scanning ? '#1E293B' : '#2563EB',
            borderWidth: scanning ? 1 : 0,
            borderColor: 'rgba(255,255,255,0.1)',
          }}
        >
          {scanning
            ? <><ActivityIndicator color="#60A5FA" size="small" /><Text style={{ color: '#60A5FA', fontWeight: '700' }}>Escaneando...</Text></>
            : <><Ionicons name="radio" size={18} color="white" /><Text style={{ color: 'white', fontWeight: '700', fontSize: 15 }}>Iniciar varredura</Text></>
          }
        </TouchableOpacity>
      </View>

      {/* Error */}
      {error && (
        <View style={{ marginHorizontal: 16, marginBottom: 12, backgroundColor: 'rgba(239,68,68,0.1)', borderRadius: 10, padding: 12, borderLeftWidth: 3, borderLeftColor: '#EF4444' }}>
          <Text style={{ color: '#EF4444', fontSize: 13 }}>⚠️ {error.message}</Text>
        </View>
      )}

      {/* Device list */}
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 24 }}>

        {/* Não pareados — só aparecem durante o scan */}
        {unpairedDevices.length > 0 && (
          <>
            <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 10 }}>
              DISPONÍVEIS
            </Text>
            {unpairedDevices.map(item => renderDeviceCard(item, false))}
          </>
        )}

        {/* Tags registradas — sempre visíveis, com sinal se encontrado no scan */}
        {tags.length > 0 && (
          <>
            <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, fontWeight: '700', letterSpacing: 1, marginTop: unpairedDevices.length > 0 ? 16 : 0, marginBottom: 10 }}>
              TAGS REGISTRADAS
            </Text>
            {tags.map(tag => {
              const scanned = scannedById.get(tag.tag_id)
              const fakeDevice: PairingDevice = {
                id: tag.tag_id,
                name: tag.name,
                rssi: scanned?.rssi ?? -100,
              }
              return renderDeviceCard(fakeDevice, true, scanned != null)
            })}
          </>
        )}

        {/* Empty state */}
        {unpairedDevices.length === 0 && tags.length === 0 && (
          <View style={{ alignItems: 'center', paddingTop: 60 }}>
            {scanning
              ? <><ActivityIndicator color="#2563EB" size="large" /><Text style={{ color: 'rgba(255,255,255,0.4)', marginTop: 16, fontSize: 14 }}>Procurando dispositivos...</Text></>
              : <><Text style={{ fontSize: 48, marginBottom: 16 }}>📡</Text><Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14, textAlign: 'center' }}>Toque em "Iniciar varredura" para detectar AirTags próximos</Text></>
            }
          </View>
        )}
      </ScrollView>

      {/* ── Modal de inspeção BLE ── */}
      <Modal visible={!!inspectResult} transparent animationType="fade" onRequestClose={() => setInspectResult(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 20 }}>
          <View style={{ backgroundColor: '#1E293B', borderRadius: 20, padding: 24, maxHeight: '80%', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
            {/* Header */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <Text style={{ color: 'white', fontSize: 16, fontWeight: '800' }}>Serviços BLE</Text>
              <TouchableOpacity onPress={() => setInspectResult(null)}>
                <Ionicons name="close-circle" size={24} color="rgba(255,255,255,0.4)" />
              </TouchableOpacity>
            </View>
            <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, marginBottom: 20 }}>{inspectResult?.device}</Text>

            <ScrollView showsVerticalScrollIndicator={false}>
              {inspectResult?.services.length === 0 && (
                <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>Nenhum serviço encontrado.</Text>
              )}
              {inspectResult?.services.map((svc, i) => {
                const label = KNOWN_UUIDS[svc.uuid.toLowerCase()]
                const isAlert = svc.uuid.toLowerCase() === '00001802-0000-1000-8000-00805f9b34fb'
                return (
                  <View key={i} style={{
                    marginBottom: 14, backgroundColor: isAlert ? 'rgba(16,185,129,0.08)' : 'rgba(255,255,255,0.04)',
                    borderRadius: 10, padding: 12,
                    borderWidth: 1, borderColor: isAlert ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.06)',
                  }}>
                    <Text style={{ color: label ? (isAlert ? '#10B981' : '#60A5FA') : 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: '700', marginBottom: 2 }}>
                      {label || 'Serviço proprietário'}
                    </Text>
                    <Text style={{ color: 'rgba(255,255,255,0.25)', fontSize: 10, fontFamily: 'monospace', marginBottom: 8 }}>
                      {svc.uuid}
                    </Text>
                    {svc.characteristics.map((c, j) => {
                      const cLabel = KNOWN_UUIDS[c.toLowerCase()]
                      return (
                        <View key={j} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                          <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)' }} />
                          <Text style={{ color: cLabel ? '#A78BFA' : 'rgba(255,255,255,0.3)', fontSize: 10, fontFamily: 'monospace', flex: 1 }}>
                            {cLabel ? `${cLabel}  ` : ''}{c}
                          </Text>
                        </View>
                      )
                    })}
                  </View>
                )
              })}
            </ScrollView>

            <TouchableOpacity
              onPress={() => setInspectResult(null)}
              style={{ marginTop: 16, paddingVertical: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.07)', alignItems: 'center' }}
            >
              <Text style={{ color: 'rgba(255,255,255,0.6)', fontWeight: '700' }}>Fechar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Pairing Bottom Sheet ── */}
      <Modal visible={!!sheet} transparent animationType="slide" onRequestClose={closeSheet}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
        <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' }} activeOpacity={1} onPress={closeSheet} />

        <View style={{
          backgroundColor: '#1E293B', borderTopLeftRadius: 28, borderTopRightRadius: 28,
          padding: 28, paddingBottom: 44,
          borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)',
        }}>
          {/* Handle */}
          <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.15)', alignSelf: 'center', marginBottom: 24 }} />

          {step === 'confirm' && (
            <>
              {/* Device icon */}
              <View style={{ alignItems: 'center', marginBottom: 20 }}>
                <View style={{
                  width: 72, height: 72, borderRadius: 20,
                  backgroundColor: 'rgba(37,99,235,0.15)',
                  alignItems: 'center', justifyContent: 'center',
                  borderWidth: 1, borderColor: 'rgba(37,99,235,0.3)',
                  marginBottom: 14,
                }}>
                  <Ionicons name="bluetooth" size={36} color="#60A5FA" />
                </View>
                <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: '700', letterSpacing: 1 }}>
                  NOVO DISPOSITIVO DETECTADO
                </Text>
                <Text style={{ color: 'white', fontSize: 20, fontWeight: '800', marginTop: 6 }}>
                  {sheet?.name || 'Dispositivo BLE'}
                </Text>
                <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12, marginTop: 4 }}>
                  {sheet?.id}
                </Text>
              </View>

              {/* Botão beep no sheet */}
              <TouchableOpacity
                onPress={async () => {
                  if (!sheet) return
                  setBeepingId(sheet.id)
                  await playSound(sheet.id)
                  setBeepingId(null)
                }}
                disabled={beepingId === sheet?.id}
                style={{
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                  paddingVertical: 10, paddingHorizontal: 20, borderRadius: 10,
                  backgroundColor: beepingId === sheet?.id ? 'rgba(250,204,21,0.15)' : 'rgba(255,255,255,0.06)',
                  borderWidth: 1,
                  borderColor: beepingId === sheet?.id ? 'rgba(250,204,21,0.3)' : 'rgba(255,255,255,0.08)',
                  alignSelf: 'center', marginBottom: 20,
                }}
              >
                {beepingId === sheet?.id
                  ? <><ActivityIndicator size="small" color="#FACC15" /><Text style={{ color: '#FACC15', fontSize: 13, fontWeight: '600' }}>Emitindo beep...</Text></>
                  : <><Ionicons name="volume-high" size={16} color="rgba(255,255,255,0.5)" /><Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>Testar beep</Text></>
                }
              </TouchableOpacity>

              <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, textAlign: 'center', marginBottom: 28, lineHeight: 20 }}>
                Deseja parear este dispositivo e vinculá-lo ao seu sistema de rastreamento?
              </Text>

              <View style={{ flexDirection: 'row', gap: 12 }}>
                <TouchableOpacity
                  onPress={closeSheet}
                  style={{ flex: 1, paddingVertical: 14, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', alignItems: 'center' }}
                >
                  <Text style={{ color: 'rgba(255,255,255,0.5)', fontWeight: '700' }}>Não agora</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setStep('form')}
                  style={{ flex: 2, paddingVertical: 14, borderRadius: 14, backgroundColor: '#2563EB', alignItems: 'center' }}
                >
                  <Text style={{ color: 'white', fontWeight: '700', fontSize: 15 }}>Sim, parear</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {step === 'form' && (
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={{ color: 'white', fontSize: 18, fontWeight: '800', marginBottom: 24 }}>
                Configurar AirTag
              </Text>

              {/* Tag name */}
              <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 8 }}>
                NOME DO TAG
              </Text>
              <TextInput
                value={tagName}
                onChangeText={setTagName}
                placeholder="Ex: Tag Furadeira, Tag Betoneira..."
                placeholderTextColor="rgba(255,255,255,0.2)"
                style={{
                  backgroundColor: '#0F172A', borderRadius: 12,
                  borderWidth: 1, borderColor: tagName ? '#2563EB' : 'rgba(255,255,255,0.1)',
                  paddingHorizontal: 16, paddingVertical: 14,
                  color: 'white', fontSize: 15, marginBottom: 20,
                }}
              />

              {/* Tool link (optional) */}
              <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 8 }}>
                VINCULAR À FERRAMENTA <Text style={{ color: 'rgba(255,255,255,0.3)', fontWeight: '400' }}>(opcional)</Text>
              </Text>

              <TouchableOpacity
                onPress={() => setToolDropdownOpen(o => !o)}
                style={{
                  backgroundColor: '#0F172A', borderRadius: 12,
                  borderWidth: 1, borderColor: selectedToolId ? '#2563EB' : 'rgba(255,255,255,0.1)',
                  paddingHorizontal: 16, paddingVertical: 14,
                  flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                  marginBottom: toolDropdownOpen ? 4 : 28,
                }}
              >
                <Text style={{ color: selectedToolId ? 'white' : 'rgba(255,255,255,0.25)', fontSize: 15 }}>
                  {selectedToolName || 'Selecionar ferramenta...'}
                </Text>
                <Ionicons name={toolDropdownOpen ? 'chevron-up' : 'chevron-down'} size={16} color="rgba(255,255,255,0.3)" />
              </TouchableOpacity>

              {toolDropdownOpen && (
                <View style={{
                  backgroundColor: '#0F172A', borderRadius: 12,
                  borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
                  marginBottom: 28, overflow: 'hidden',
                }}>
                  <TouchableOpacity
                    onPress={() => { setSelectedToolId(null); setToolDropdownOpen(false) }}
                    style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' }}
                  >
                    <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>Nenhuma (só parear)</Text>
                  </TouchableOpacity>
                  {tools.filter(t => !t.assigned_tag).map((tool, i, arr) => (
                    <TouchableOpacity
                      key={tool.id}
                      onPress={() => { setSelectedToolId(tool.id); setToolDropdownOpen(false) }}
                      style={{
                        paddingHorizontal: 16, paddingVertical: 12,
                        borderBottomWidth: i < arr.length - 1 ? 1 : 0,
                        borderBottomColor: 'rgba(255,255,255,0.06)',
                        backgroundColor: selectedToolId === tool.id ? 'rgba(37,99,235,0.15)' : 'transparent',
                        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                      }}
                    >
                      <View>
                        <Text style={{ color: 'white', fontSize: 14, fontWeight: '600' }}>{tool.name}</Text>
                        <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, marginTop: 2 }}>{tool.type}</Text>
                      </View>
                      {selectedToolId === tool.id && <Ionicons name="checkmark-circle" size={18} color="#2563EB" />}
                    </TouchableOpacity>
                  ))}
                  {tools.filter(t => !t.assigned_tag).length === 0 && (
                    <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
                      <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>Nenhuma ferramenta disponível</Text>
                    </View>
                  )}
                </View>
              )}

              {pairError && (
                <View style={{ backgroundColor: 'rgba(239,68,68,0.1)', borderRadius: 10, padding: 12, marginBottom: 16, borderLeftWidth: 3, borderLeftColor: '#EF4444' }}>
                  <Text style={{ color: '#EF4444', fontSize: 13 }}>⚠️ {pairError}</Text>
                </View>
              )}

              <View style={{ flexDirection: 'row', gap: 12 }}>
                <TouchableOpacity
                  onPress={() => setStep('confirm')}
                  style={{ flex: 1, paddingVertical: 14, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', alignItems: 'center' }}
                >
                  <Text style={{ color: 'rgba(255,255,255,0.5)', fontWeight: '700' }}>Voltar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handlePair}
                  disabled={pairing || (!tagName.trim() && !selectedToolId)}
                  style={{ flex: 2, paddingVertical: 14, borderRadius: 14, backgroundColor: '#2563EB', alignItems: 'center', opacity: pairing || (!tagName.trim() && !selectedToolId) ? 0.5 : 1 }}
                >
                  {pairing
                    ? <ActivityIndicator color="white" />
                    : <Text style={{ color: 'white', fontWeight: '700', fontSize: 15 }}>
                        {selectedToolId ? 'Vincular à ferramenta' : 'Confirmar pareamento'}
                      </Text>
                  }
                </TouchableOpacity>
              </View>
            </ScrollView>
          )}

          {step === 'done' && (
            <View style={{ alignItems: 'center', paddingVertical: 12 }}>
              <View style={{
                width: 72, height: 72, borderRadius: 36,
                backgroundColor: 'rgba(16,185,129,0.15)',
                alignItems: 'center', justifyContent: 'center', marginBottom: 16,
              }}>
                <Ionicons name="checkmark-circle" size={44} color="#10B981" />
              </View>
              <Text style={{ color: 'white', fontSize: 20, fontWeight: '800', marginBottom: 8 }}>Pareado!</Text>
              <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, textAlign: 'center', marginBottom: 32 }}>
                {tagName} foi configurado com sucesso
                {selectedToolName ? ` e vinculado a ${selectedToolName}` : ''}
              </Text>
              <TouchableOpacity
                onPress={closeSheet}
                style={{ backgroundColor: '#10B981', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 40 }}
              >
                <Text style={{ color: 'white', fontWeight: '700', fontSize: 15 }}>Concluir</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  )
}
