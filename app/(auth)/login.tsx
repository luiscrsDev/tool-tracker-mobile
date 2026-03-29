import { useState, useRef } from 'react'
import {
  View, Text, TextInput, TouchableOpacity,
  ActivityIndicator, Alert, KeyboardAvoidingView,
  Platform, ScrollView,
} from 'react-native'
import { useAuth, normalisePhone } from '@/context/AuthContext'

export default function LoginScreen() {
  const { sendOTP, verifyOTP, completeRegistration } = useAuth()
  const [step, setStep] = useState<'phone' | 'otp' | 'profile'>('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [dob, setDob] = useState('')
  const [loading, setLoading] = useState(false)
  const codeRef = useRef<TextInput>(null)

  const handleSendOTP = async () => {
    const digits = phone.replace(/\D/g, '')
    if (digits.length < 10) {
      Alert.alert('Telefone inválido', 'Digite o número com DDD (ex: 305 555-1234)')
      return
    }
    try {
      setLoading(true)
      await sendOTP(phone)
      setStep('otp')
      setTimeout(() => codeRef.current?.focus(), 300)
    } catch (err) {
      Alert.alert('Erro', err instanceof Error ? err.message : 'Tente novamente')
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyOTP = async () => {
    if (code.length !== 6) {
      Alert.alert('Código inválido', 'O código tem 6 dígitos')
      return
    }
    try {
      setLoading(true)
      await verifyOTP(phone, code)
      // verifyOTP sets pendingPhone (new user) or userRole (existing) — navigate accordingly
      // _layout.tsx handles redirect for existing users; for new users show profile
      setStep('profile')
    } catch (err) {
      Alert.alert('Erro', err instanceof Error ? err.message : 'Código inválido')
      setCode('')
    } finally {
      setLoading(false)
    }
  }

  const handleCompleteProfile = async () => {
    if (!name.trim()) return Alert.alert('Nome obrigatório')
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(dob)) return Alert.alert('Data inválida', 'Use o formato DD/MM/AAAA')
    const [d, m, y] = dob.split('/')
    const isoDate = `${y}-${m}-${d}`
    try {
      setLoading(true)
      await completeRegistration(name, isoDate)
    } catch (err) {
      Alert.alert('Erro', err instanceof Error ? err.message : 'Tente novamente')
    } finally {
      setLoading(false)
    }
  }

  const formattedPhone = (() => {
    try { return normalisePhone(phone) } catch { return phone }
  })()

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1, backgroundColor: '#0F172A' }}
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 28, paddingVertical: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Logo */}
        <View style={{ alignItems: 'center', marginBottom: 52 }}>
          <View style={{
            width: 72, height: 72, borderRadius: 20,
            backgroundColor: '#2563EB', alignItems: 'center',
            justifyContent: 'center', marginBottom: 20,
            shadowColor: '#2563EB', shadowOpacity: 0.5, shadowRadius: 20,
          }}>
            <Text style={{ fontSize: 36 }}>📍</Text>
          </View>
          <Text style={{ fontSize: 26, fontWeight: '800', color: 'white', letterSpacing: -0.5 }}>
            LocateTool
          </Text>
          <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginTop: 6 }}>
            Rastreamento inteligente de equipamentos
          </Text>
        </View>

        {/* Card */}
        <View style={{
          backgroundColor: '#1E293B', borderRadius: 20, padding: 28,
          borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)',
        }}>
          {step === 'profile' ? (
          <>
            <Text style={{ fontSize: 18, fontWeight: '700', color: 'white', marginBottom: 6 }}>
              Criar conta
            </Text>
            <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginBottom: 28 }}>
              Primeira vez aqui — precisamos de mais alguns dados
            </Text>

            <Text style={{ fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.5)', marginBottom: 8, letterSpacing: 1 }}>
              NOME COMPLETO
            </Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="João da Silva"
              placeholderTextColor="rgba(255,255,255,0.2)"
              autoCapitalize="words"
              editable={!loading}
              style={{
                backgroundColor: '#0F172A', borderRadius: 12,
                borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
                paddingHorizontal: 16, paddingVertical: 14,
                color: 'white', fontSize: 15, marginBottom: 20,
              }}
            />

            <Text style={{ fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.5)', marginBottom: 8, letterSpacing: 1 }}>
              DATA DE NASCIMENTO
            </Text>
            <TextInput
              value={dob}
              onChangeText={t => {
                const digits = t.replace(/\D/g, '')
                let formatted = digits
                if (digits.length > 2) formatted = `${digits.slice(0, 2)}/${digits.slice(2)}`
                if (digits.length > 4) formatted = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4, 8)}`
                setDob(formatted)
              }}
              placeholder="DD/MM/AAAA"
              placeholderTextColor="rgba(255,255,255,0.2)"
              keyboardType="number-pad"
              maxLength={10}
              editable={!loading}
              style={{
                backgroundColor: '#0F172A', borderRadius: 12,
                borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
                paddingHorizontal: 16, paddingVertical: 14,
                color: 'white', fontSize: 15, marginBottom: 28,
              }}
            />

            <TouchableOpacity
              onPress={handleCompleteProfile}
              disabled={loading || !name.trim() || dob.length < 10}
              style={{
                backgroundColor: '#2563EB', borderRadius: 12,
                paddingVertical: 16, alignItems: 'center',
                opacity: loading || !name.trim() || dob.length < 10 ? 0.4 : 1,
              }}
            >
              {loading
                ? <ActivityIndicator color="white" />
                : <Text style={{ color: 'white', fontWeight: '700', fontSize: 15 }}>Criar conta e entrar</Text>
              }
            </TouchableOpacity>
          </>
        ) : step === 'phone' ? (
            <>
              <Text style={{ fontSize: 18, fontWeight: '700', color: 'white', marginBottom: 6 }}>
                Entrar
              </Text>
              <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginBottom: 28 }}>
                Vamos te enviar um código por SMS
              </Text>

              <Text style={{ fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.5)', marginBottom: 8, letterSpacing: 1 }}>
                TELEFONE
              </Text>
              <View style={{
                flexDirection: 'row', alignItems: 'center',
                backgroundColor: '#0F172A', borderRadius: 12,
                borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
                paddingHorizontal: 16, marginBottom: 24,
              }}>
                <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 15, marginRight: 8 }}>+1</Text>
                <TextInput
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="(305) 555-1234"
                  placeholderTextColor="rgba(255,255,255,0.2)"
                  keyboardType="phone-pad"
                  editable={!loading}
                  style={{ flex: 1, color: 'white', fontSize: 16, paddingVertical: 16 }}
                />
              </View>

              <TouchableOpacity
                onPress={handleSendOTP}
                disabled={loading}
                style={{
                  backgroundColor: '#2563EB', borderRadius: 12,
                  paddingVertical: 16, alignItems: 'center',
                  opacity: loading ? 0.6 : 1,
                }}
              >
                {loading
                  ? <ActivityIndicator color="white" />
                  : <Text style={{ color: 'white', fontWeight: '700', fontSize: 15 }}>Enviar código</Text>
                }
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity onPress={() => { setStep('phone'); setCode('') }} style={{ marginBottom: 20 }}>
                <Text style={{ color: '#2563EB', fontSize: 13 }}>← Trocar número</Text>
              </TouchableOpacity>

              <Text style={{ fontSize: 18, fontWeight: '700', color: 'white', marginBottom: 6 }}>
                Código SMS
              </Text>
              <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginBottom: 28 }}>
                Enviado para {formattedPhone}
              </Text>

              <Text style={{ fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.5)', marginBottom: 8, letterSpacing: 1 }}>
                CÓDIGO DE 6 DÍGITOS
              </Text>
              <TextInput
                ref={codeRef}
                value={code}
                onChangeText={t => { if (t.length <= 6) setCode(t.replace(/\D/g, '')) }}
                placeholder="• • • • • •"
                placeholderTextColor="rgba(255,255,255,0.2)"
                keyboardType="number-pad"
                maxLength={6}
                editable={!loading}
                style={{
                  backgroundColor: '#0F172A', borderRadius: 12,
                  borderWidth: 1, borderColor: code.length === 6 ? '#2563EB' : 'rgba(255,255,255,0.1)',
                  paddingHorizontal: 16, paddingVertical: 16,
                  color: 'white', fontSize: 22, fontWeight: '700',
                  letterSpacing: 8, textAlign: 'center', marginBottom: 24,
                }}
                onSubmitEditing={handleVerifyOTP}
              />

              <TouchableOpacity
                onPress={handleVerifyOTP}
                disabled={loading || code.length !== 6}
                style={{
                  backgroundColor: '#2563EB', borderRadius: 12,
                  paddingVertical: 16, alignItems: 'center',
                  opacity: loading || code.length !== 6 ? 0.4 : 1,
                }}
              >
                {loading
                  ? <ActivityIndicator color="white" />
                  : <Text style={{ color: 'white', fontWeight: '700', fontSize: 15 }}>Verificar e entrar</Text>
                }
              </TouchableOpacity>

              <TouchableOpacity onPress={handleSendOTP} disabled={loading} style={{ marginTop: 16, alignItems: 'center' }}>
                <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>Reenviar código</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        <Text style={{ textAlign: 'center', color: 'rgba(255,255,255,0.2)', fontSize: 11, marginTop: 32 }}>
          LocateTool v2.0 • Miami, FL
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
