import React, { createContext, useContext, useEffect, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '@/lib/supabase'
import type { Contractor } from '@/types'

export type UserRole = 'contractor' | 'worker' | 'master' | null

export interface AppUser {
  id: string
  name: string | null
  phone: string
}

interface AuthContextType {
  userRole: UserRole
  contractor: Contractor | null
  worker: AppUser | null
  loading: boolean
  error: string | null
  pendingPhone: string | null  // set when new phone detected — needs profile
  // Phone OTP flow
  sendOTP: (phone: string) => Promise<void>
  verifyOTP: (phone: string, code: string) => Promise<void>
  completeRegistration: (name: string, dob: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

// Normalise phone to E.164 (+1XXXXXXXXXX)
export function normalisePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.startsWith('1') && digits.length === 11) return `+${digits}`
  if (digits.length === 10) return `+1${digits}`
  return `+${digits}`
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [userRole, setUserRole] = useState<UserRole>(null)
  const [contractor, setContractor] = useState<Contractor | null>(null)
  const [worker, setWorker] = useState<AppUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pendingPhone, setPendingPhone] = useState<string | null>(null)

  useEffect(() => {
    restoreSession()
  }, [])

  const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

  const restoreSession = async () => {
    try {
      setLoading(true)
      const stored = await AsyncStorage.getItem('authSession')
      if (!stored) return

      const session = JSON.parse(stored)

      // Expire session after 7 days of inactivity
      const lastActive = session.lastActiveAt || 0
      if (Date.now() - lastActive > SESSION_TTL_MS) {
        console.log('⏰ Session expired (>7 days), requiring re-login')
        await AsyncStorage.removeItem('authSession')
        return
      }

      // Refresh lastActiveAt on every app open
      await AsyncStorage.setItem('authSession', JSON.stringify({ ...session, lastActiveAt: Date.now() }))

      setUserRole(session.userRole)
      if (session.userRole === 'contractor') setContractor(session.contractor)
      if (session.userRole === 'worker') setWorker(session.worker)
      if (session.userRole === 'master') setWorker(session.worker)
    } catch (err) {
      console.error('❌ Error restoring session:', err)
    } finally {
      setLoading(false)
    }
  }

  // Step 1: send 6-digit code via Twilio (Supabase Edge Function)
  const sendOTP = async (phone: string) => {
    setError(null)
    const normalised = normalisePhone(phone)

    const res = await supabase.functions.invoke('send-otp', {
      body: { phone: normalised },
    })

    if (res.error) throw new Error('Erro ao enviar SMS. Tente novamente.')
    console.log(`📱 OTP SMS sent to ${normalised}`)
  }

  // Step 2: verify code via Twilio Verify and detect role
  const verifyOTP = async (phone: string, code: string) => {
    setError(null)
    const normalised = normalisePhone(phone)

    // Verify via Twilio Verify (Edge Function)
    const { data, error: verifyErr } = await supabase.functions.invoke('verify-otp', {
      body: { phone: normalised, code: code.trim() },
    })

    console.log('[Auth] verify-otp response:', JSON.stringify({ data, error: verifyErr?.message }))

    if (verifyErr || !data?.success) {
      const detail = verifyErr?.message || data?.status || 'unknown'
      throw new Error(`Código inválido (${detail})`)
    }

    // Detect role by checking tables in priority order: master → contractor → worker
    const [masterResult, contractorResult, workerResult] = await Promise.all([
      supabase.from('admin_users').select('id, name, email').eq('phone', normalised).maybeSingle(),
      supabase.from('contractors').select('id, name, email, company, status').eq('phone', normalised).maybeSingle(),
      supabase.from('app_users').select('id, name, phone').eq('phone', normalised).maybeSingle(),
    ])

    if (masterResult.data) {
      const workerData: AppUser = { id: masterResult.data.id, name: masterResult.data.name, phone: normalised }
      await AsyncStorage.setItem('authSession', JSON.stringify({ userRole: 'master', worker: workerData, lastActiveAt: Date.now() }))
      setUserRole('master')
      setWorker(workerData)
      return
    }

    if (contractorResult.data) {
      const d = contractorResult.data
      const contractorData: Contractor = { id: d.id, name: d.name, email: d.email, company: d.company, status: d.status }
      await AsyncStorage.setItem('authSession', JSON.stringify({ userRole: 'contractor', contractor: contractorData, lastActiveAt: Date.now() }))
      setUserRole('contractor')
      setContractor(contractorData)
      return
    }

    if (workerResult.data) {
      const d = workerResult.data
      const workerData: AppUser = { id: d.id, name: d.name, phone: d.phone }
      await AsyncStorage.setItem('authSession', JSON.stringify({ userRole: 'worker', worker: workerData, lastActiveAt: Date.now() }))
      setUserRole('worker')
      setWorker(workerData)
      return
    }

    // Phone not registered — pause and ask for name + DOB
    setPendingPhone(normalised)
  }

  const completeRegistration = async (name: string, dob: string) => {
    if (!pendingPhone) throw new Error('Sessão expirada. Faça login novamente.')

    const { data: newUser, error: insertErr } = await supabase
      .from('app_users')
      .insert({ phone: pendingPhone, name: name.trim(), dob })
      .select('id, name, phone')
      .single()

    if (insertErr || !newUser) throw new Error('Erro ao criar conta. Tente novamente.')

    const workerData: AppUser = { id: newUser.id, name: newUser.name, phone: newUser.phone }
    await AsyncStorage.setItem('authSession', JSON.stringify({ userRole: 'worker', worker: workerData, lastActiveAt: Date.now() }))
    setPendingPhone(null)
    setUserRole('worker')
    setWorker(workerData)
  }

  const signOut = async () => {
    await AsyncStorage.removeItem('authSession')
    setUserRole(null)
    setContractor(null)
    setWorker(null)
    setPendingPhone(null)
  }

  return (
    <AuthContext.Provider value={{ userRole, contractor, worker, loading, error, pendingPhone, sendOTP, verifyOTP, completeRegistration, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
