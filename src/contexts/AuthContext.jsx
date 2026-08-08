import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext({
  user: null, loading: true,
  signIn: async () => {}, signOut: async () => {},
  sendPasswordReset: async () => {},
  updatePassword: async () => {},
})

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data?.session?.user || null)
      setLoading(false)
    }).catch(() => setLoading(false)) // sem isto, uma falha travava o app em "Carregando…"
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  async function signIn(email, password) {
    return await supabase.auth.signInWithPassword({ email, password })
  }
  async function signOut() {
    await supabase.auth.signOut()
    setUser(null)
  }
  async function sendPasswordReset(email) {
    // Envia link que volta pra /v2/redefinir-senha
    const redirectTo = `${window.location.origin}/v2/redefinir-senha`
    return await supabase.auth.resetPasswordForEmail(email, { redirectTo })
  }
  async function updatePassword(newPassword) {
    return await supabase.auth.updateUser({ password: newPassword })
  }

  return <AuthContext.Provider value={{ user, loading, signIn, signOut, sendPasswordReset, updatePassword }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
