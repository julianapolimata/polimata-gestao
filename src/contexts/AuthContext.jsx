import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { usuarioQueContinua } from '../lib/sessao'

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
    // ── POR QUE ESTE setUser TEM UMA GUARDA ───────────────────────────────
    //
    // O supabase chama onAuthStateChange em mais situações do que entrar e
    // sair: ele dispara quando o token é renovado e, sobretudo, quando a aba
    // volta ao foco. Nesses casos o usuário é O MESMO, mas o objeto que vem
    // na sessão é NOVO.
    //
    // Dezenove telas do sistema carregam seus dados com um efeito que depende
    // desse objeto. Objeto novo, efeito dispara, tela recarrega do banco — e
    // o que estava sendo digitado, e ainda não foi salvo, é sobrescrito pelo
    // que está gravado.
    //
    // Relato dela, 10/11/2026: "se eu mudo de tela pra pegar uma informação
    // pra inserir no sistema, ele atualiza a tela e eu perco o que estava
    // digitando". Consultar o CNPJ em outra aba e voltar é exatamente o
    // caminho que o sistema pede — e era o caminho que apagava o trabalho.
    //
    // A guarda troca o objeto só quando o usuário realmente muda. Sair e
    // entrar continua funcionando: o id muda, e todas as telas recarregam.
    supabase.auth.getSession().then(({ data }) => {
      setUser(atual => usuarioQueContinua(atual, data?.session?.user || null))
      setLoading(false)
    }).catch(() => setLoading(false)) // sem isto, uma falha travava o app em "Carregando…"
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(atual => usuarioQueContinua(atual, session?.user || null))
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  // As funções são estáveis entre renderizações pelo mesmo motivo da guarda
  // acima: uma tela que dependa de qualquer uma delas não pode recarregar só
  // porque o contexto renderizou de novo.
  const signIn = useCallback(async (email, password) => {
    return await supabase.auth.signInWithPassword({ email, password })
  }, [])
  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setUser(null)
  }, [])
  const sendPasswordReset = useCallback(async (email) => {
    // Envia link que volta pra /v2/redefinir-senha
    const redirectTo = `${window.location.origin}/v2/redefinir-senha`
    return await supabase.auth.resetPasswordForEmail(email, { redirectTo })
  }, [])
  const updatePassword = useCallback(async (newPassword) => {
    return await supabase.auth.updateUser({ password: newPassword })
  }, [])

  const valor = useMemo(
    () => ({ user, loading, signIn, signOut, sendPasswordReset, updatePassword }),
    [user, loading, signIn, signOut, sendPasswordReset, updatePassword],
  )

  return <AuthContext.Provider value={valor}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
