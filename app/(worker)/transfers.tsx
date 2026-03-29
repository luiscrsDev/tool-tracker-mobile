import { useEffect, useState } from 'react'
import { View, Text, ScrollView, TouchableOpacity, TextInput, Alert, ActivityIndicator, RefreshControl } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'

interface Transfer {
  id: string
  status: 'pending' | 'accepted' | 'rejected'
  created_at: string
  message: string | null
  tool: { id: string; name: string; type: string } | null
  from_user: { id: string; name: string | null; phone: string } | null
  to_user: { id: string; name: string | null; phone: string } | null
}

export default function TransfersScreen() {
  const { worker } = useAuth()
  const params = useLocalSearchParams<{ toolId?: string; toolName?: string }>()

  const [tab, setTab] = useState<'incoming' | 'outgoing' | 'new'>('incoming')
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  // New transfer form
  const [targetPhone, setTargetPhone] = useState('')
  const [selectedToolId, setSelectedToolId] = useState(params.toolId || '')
  const [selectedToolName, setSelectedToolName] = useState(params.toolName || '')
  const [myTools, setMyTools] = useState<{ id: string; name: string }[]>([])
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (params.toolId) setTab('new')
  }, [params.toolId])

  useEffect(() => {
    if (worker?.id) loadData()
  }, [worker?.id])

  const loadData = async () => {
    if (!worker?.id) return
    try {
      const [inRes, outRes, toolsRes] = await Promise.all([
        supabase
          .from('tool_transfers')
          .select('id, status, created_at, message, tool:tool_id(id, name, type), from_user:from_user_id(id, name, phone), to_user:to_user_id(id, name, phone)')
          .eq('to_user_id', worker.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('tool_transfers')
          .select('id, status, created_at, message, tool:tool_id(id, name, type), from_user:from_user_id(id, name, phone), to_user:to_user_id(id, name, phone)')
          .eq('from_user_id', worker.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('tools')
          .select('id, name')
          .eq('current_responsible_id', worker.id),
      ])

      setTransfers([...(inRes.data || []), ...(outRes.data || [])])
      setMyTools(toolsRes.data || [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  const handleSendTransfer = async () => {
    if (!selectedToolId) return Alert.alert('Selecione uma ferramenta')
    const digits = targetPhone.replace(/\D/g, '')
    if (digits.length < 10) return Alert.alert('Telefone inválido')

    const phone = digits.length === 10 ? `+1${digits}` : `+${digits}`

    // Find or create target user
    let { data: targetUser } = await supabase
      .from('app_users')
      .select('id, name, phone')
      .eq('phone', phone)
      .maybeSingle()

    if (!targetUser) {
      return Alert.alert('Usuário não encontrado', `Nenhum worker com o telefone ${phone} encontrado no sistema.`)
    }

    try {
      setSending(true)
      const { error } = await supabase.from('tool_transfers').insert({
        tool_id: selectedToolId,
        from_user_id: worker!.id,
        to_user_id: targetUser.id,
        status: 'pending',
      })

      if (error) throw error

      Alert.alert('Transferência enviada!', `${selectedToolName || 'Ferramenta'} aguarda aceite de ${targetUser.name || phone}`)
      setTargetPhone('')
      setSelectedToolId('')
      setSelectedToolName('')
      setTab('outgoing')
      loadData()
    } catch (err) {
      Alert.alert('Erro', 'Não foi possível enviar a transferência')
    } finally {
      setSending(false)
    }
  }

  const handleRespond = async (transferId: string, accept: boolean) => {
    const { error } = await supabase
      .from('tool_transfers')
      .update({ status: accept ? 'accepted' : 'rejected', responded_at: new Date().toISOString() })
      .eq('id', transferId)

    if (accept && !error) {
      // Update tool custody
      const transfer = transfers.find(t => t.id === transferId)
      if (transfer?.tool?.id) {
        await supabase
          .from('tools')
          .update({ current_responsible_id: worker!.id })
          .eq('id', transfer.tool.id)
      }
    }

    loadData()
  }

  const incoming = transfers.filter(t => t.to_user?.id === worker?.id)
  const outgoing = transfers.filter(t => t.from_user?.id === worker?.id)
  const pendingIncoming = incoming.filter(t => t.status === 'pending')

  const statusColor = (s: string) =>
    s === 'accepted' ? '#10B981' : s === 'rejected' ? '#EF4444' : '#F59E0B'

  const statusLabel = (s: string) =>
    s === 'accepted' ? 'Aceita' : s === 'rejected' ? 'Rejeitada' : 'Pendente'

  return (
    <View style={{ flex: 1, backgroundColor: '#0F172A' }}>
      {/* Header */}
      <View style={{ paddingHorizontal: 20, paddingTop: 56, paddingBottom: 16 }}>
        <Text style={{ fontSize: 22, fontWeight: '800', color: 'white', letterSpacing: -0.5 }}>
          Transferências
        </Text>
        {pendingIncoming.length > 0 && (
          <Text style={{ fontSize: 12, color: '#F59E0B', marginTop: 4 }}>
            {pendingIncoming.length} aguardando sua resposta
          </Text>
        )}
      </View>

      {/* Tabs */}
      <View style={{ flexDirection: 'row', paddingHorizontal: 16, gap: 8, marginBottom: 16 }}>
        {(['incoming', 'outgoing', 'new'] as const).map(t => (
          <TouchableOpacity
            key={t}
            onPress={() => setTab(t)}
            style={{
              flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center',
              backgroundColor: tab === t ? '#2563EB' : '#1E293B',
              borderWidth: 1, borderColor: tab === t ? '#2563EB' : 'rgba(255,255,255,0.07)',
            }}
          >
            <Text style={{ color: tab === t ? 'white' : 'rgba(255,255,255,0.4)', fontSize: 12, fontWeight: '700' }}>
              {t === 'incoming' ? `Recebidas${pendingIncoming.length ? ` (${pendingIncoming.length})` : ''}` : t === 'outgoing' ? 'Enviadas' : 'Nova'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator color="#2563EB" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadData() }} tintColor="#2563EB" />}
        >
          {/* Incoming */}
          {tab === 'incoming' && incoming.map(t => (
            <View key={t.id} style={{
              backgroundColor: '#1E293B', borderRadius: 14, padding: 16,
              marginBottom: 12, borderWidth: 1,
              borderColor: t.status === 'pending' ? 'rgba(245,158,11,0.3)' : 'rgba(255,255,255,0.07)',
            }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
                <Text style={{ color: 'white', fontWeight: '700', fontSize: 15 }}>
                  {(t.tool as any)?.name || '—'}
                </Text>
                <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: `${statusColor(t.status)}20` }}>
                  <Text style={{ color: statusColor(t.status), fontSize: 11, fontWeight: '700' }}>
                    {statusLabel(t.status)}
                  </Text>
                </View>
              </View>
              <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>
                De: {(t.from_user as any)?.name || (t.from_user as any)?.phone || '—'}
              </Text>
              <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, marginTop: 4 }}>
                {new Date(t.created_at).toLocaleDateString('pt-BR')}
              </Text>

              {t.status === 'pending' && (
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
                  <TouchableOpacity
                    onPress={() => handleRespond(t.id, true)}
                    style={{ flex: 1, backgroundColor: '#10B981', borderRadius: 10, paddingVertical: 10, alignItems: 'center' }}
                  >
                    <Text style={{ color: 'white', fontWeight: '700', fontSize: 13 }}>Aceitar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => handleRespond(t.id, false)}
                    style={{ flex: 1, borderWidth: 1, borderColor: '#EF4444', borderRadius: 10, paddingVertical: 10, alignItems: 'center' }}
                  >
                    <Text style={{ color: '#EF4444', fontWeight: '700', fontSize: 13 }}>Rejeitar</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          ))}

          {tab === 'incoming' && incoming.length === 0 && (
            <View style={{ alignItems: 'center', paddingTop: 40 }}>
              <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>Nenhuma transferência recebida</Text>
            </View>
          )}

          {/* Outgoing */}
          {tab === 'outgoing' && outgoing.map(t => (
            <View key={t.id} style={{
              backgroundColor: '#1E293B', borderRadius: 14, padding: 16,
              marginBottom: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)',
            }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
                <Text style={{ color: 'white', fontWeight: '700', fontSize: 15 }}>
                  {(t.tool as any)?.name || '—'}
                </Text>
                <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: `${statusColor(t.status)}20` }}>
                  <Text style={{ color: statusColor(t.status), fontSize: 11, fontWeight: '700' }}>
                    {statusLabel(t.status)}
                  </Text>
                </View>
              </View>
              <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>
                Para: {(t.to_user as any)?.name || (t.to_user as any)?.phone || '—'}
              </Text>
              <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, marginTop: 4 }}>
                {new Date(t.created_at).toLocaleDateString('pt-BR')}
              </Text>
            </View>
          ))}

          {tab === 'outgoing' && outgoing.length === 0 && (
            <View style={{ alignItems: 'center', paddingTop: 40 }}>
              <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>Nenhuma transferência enviada</Text>
            </View>
          )}

          {/* New transfer */}
          {tab === 'new' && (
            <View style={{ backgroundColor: '#1E293B', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}>
              <Text style={{ color: 'white', fontWeight: '700', fontSize: 16, marginBottom: 20 }}>
                Nova transferência
              </Text>

              {/* Tool selector */}
              <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 8 }}>
                FERRAMENTA
              </Text>
              <View style={{ gap: 8, marginBottom: 20 }}>
                {myTools.length === 0 ? (
                  <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>Você não tem ferramentas sob custódia</Text>
                ) : (
                  myTools.map(tool => (
                    <TouchableOpacity
                      key={tool.id}
                      onPress={() => { setSelectedToolId(tool.id); setSelectedToolName(tool.name) }}
                      style={{
                        padding: 14, borderRadius: 10, borderWidth: 1,
                        borderColor: selectedToolId === tool.id ? '#2563EB' : 'rgba(255,255,255,0.1)',
                        backgroundColor: selectedToolId === tool.id ? 'rgba(37,99,235,0.15)' : 'transparent',
                        flexDirection: 'row', alignItems: 'center', gap: 10,
                      }}
                    >
                      <Ionicons
                        name={selectedToolId === tool.id ? 'radio-button-on' : 'radio-button-off'}
                        size={18}
                        color={selectedToolId === tool.id ? '#2563EB' : 'rgba(255,255,255,0.3)'}
                      />
                      <Text style={{ color: 'white', fontWeight: '600', fontSize: 14 }}>{tool.name}</Text>
                    </TouchableOpacity>
                  ))
                )}
              </View>

              {/* Target phone */}
              <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 8 }}>
                TELEFONE DO DESTINATÁRIO
              </Text>
              <View style={{
                flexDirection: 'row', alignItems: 'center',
                backgroundColor: '#0F172A', borderRadius: 12,
                borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
                paddingHorizontal: 16, marginBottom: 24,
              }}>
                <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 15, marginRight: 8 }}>+1</Text>
                <TextInput
                  value={targetPhone}
                  onChangeText={setTargetPhone}
                  placeholder="(305) 555-0000"
                  placeholderTextColor="rgba(255,255,255,0.2)"
                  keyboardType="phone-pad"
                  style={{ flex: 1, color: 'white', fontSize: 16, paddingVertical: 14 }}
                />
              </View>

              <TouchableOpacity
                onPress={handleSendTransfer}
                disabled={sending || !selectedToolId || targetPhone.replace(/\D/g, '').length < 10}
                style={{
                  backgroundColor: '#2563EB', borderRadius: 12,
                  paddingVertical: 14, alignItems: 'center',
                  opacity: sending || !selectedToolId || targetPhone.replace(/\D/g, '').length < 10 ? 0.4 : 1,
                }}
              >
                {sending
                  ? <ActivityIndicator color="white" />
                  : <Text style={{ color: 'white', fontWeight: '700', fontSize: 15 }}>Enviar transferência</Text>
                }
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  )
}
