import { useState, useEffect } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '@/lib/supabase'
import type { Contractor } from '@/types'

export function useContractorAuth() {
  const [contractor, setContractor] = useState<Contractor | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    restoreSession()
  }, [])

  const restoreSession = async () => {
    try {
      const storedSession = await AsyncStorage.getItem('contractorSession')
      if (storedSession) {
        const session = JSON.parse(storedSession)
        setContractor(session)
        console.log('✅ Contractor session restored')
      }
    } catch (err) {
      console.error('❌ Error restoring session:', err)
    } finally {
      setLoading(false)
    }
  }

  const signIn = async (email: string, password: string) => {
    try {
      setError(null)

      const { data, error: queryError } = await supabase
        .from('contractors')
        .select('id, name, email, company, status, temp_password')
        .eq('email', email.toLowerCase().trim())
        .single()

      if (queryError || !data) {
        throw new Error('Email ou senha inválido')
      }

      if (data.temp_password !== password.trim()) {
        throw new Error('Email ou senha inválido')
      }

      const session: Contractor = {
        id: data.id,
        name: data.name,
        email: data.email,
        company: data.company,
        status: data.status
      }

      await AsyncStorage.setItem('contractorSession', JSON.stringify(session))
      setContractor(session)
      return session
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Erro ao fazer login'))
      throw err
    }
  }

  const signOut = async () => {
    try {
      setError(null)
      await AsyncStorage.removeItem('contractorSession')
      setContractor(null)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Erro ao sair'))
      throw err
    }
  }

  return { contractor, loading, error, signIn, signOut }
}
