import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'

const LOGO_URL = '/favicon-32x32.png' // usa o favicon como logo provisório; ideal seria importar a logo Polímata oficial

export default function Login() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setErro('')
    setCarregando(true)
    const { error } = await signIn(email, password)
    setCarregando(false)
    if (error) {
      setErro(error.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos.' : (error.message || 'Erro ao entrar.'))
      return
    }
    // Após login → redireciona pro sistema legado na raiz
    window.location.href = '/'
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'var(--navy)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <form onSubmit={handleSubmit} style={{
        background: 'var(--cream)', borderRadius: 12,
        padding: '40px 44px', width: 380, maxWidth: '92vw',
        boxShadow: '0 18px 50px rgba(0,0,0,0.35)',
      }}>
        {/* Brand */}
        <div style={{ textAlign: 'center', marginBottom: 28, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <img src={LOGO_URL} alt="Polímata" style={{ width: 48, height: 48 }} />
          <div>
            <div style={{ fontFamily: 'var(--display)', fontSize: 34, fontWeight: 300, color: 'var(--navy)', letterSpacing: 2 }}>
              Polímata
            </div>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--gold)', letterSpacing: 4, textTransform: 'uppercase', marginTop: 4 }}>
              Consultoria em GRC
            </div>
          </div>
        </div>

        <div style={{ fontFamily: 'var(--display)', fontSize: 22, fontWeight: 300, color: 'var(--navy)', textAlign: 'center', marginBottom: 4 }}>
          Acessar sistema
        </div>
        <div style={{ fontSize: 11, color: 'rgba(0,32,62,0.6)', textAlign: 'center', marginBottom: 24, letterSpacing: 0.5 }}>
          Entre com seu e-mail e senha
        </div>

        {/* Campo email */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 9, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--navy)', marginBottom: 6 }}>
            E-mail
          </label>
          <input
            type="email" required autoComplete="email" autoFocus
            value={email} onChange={e => setEmail(e.target.value)}
            style={loginInputStyle}
            onFocus={e => e.target.style.borderColor = 'var(--gold)'}
            onBlur={e => e.target.style.borderColor = '#E6DCC8'}
          />
        </div>

        {/* Campo senha */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 9, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--navy)', marginBottom: 6 }}>
            Senha
          </label>
          <input
            type="password" required autoComplete="current-password"
            value={password} onChange={e => setPassword(e.target.value)}
            style={loginInputStyle}
            onFocus={e => e.target.style.borderColor = 'var(--gold)'}
            onBlur={e => e.target.style.borderColor = '#E6DCC8'}
          />
        </div>

        {/* Erro */}
        <div style={{ color: '#C0392B', fontSize: 11, marginTop: 10, minHeight: 15, textAlign: 'center' }}>
          {erro}
        </div>

        {/* Botão */}
        <button type="submit" disabled={carregando} style={{
          width: '100%', marginTop: 10, padding: 12,
          background: carregando ? 'rgba(0,32,62,0.6)' : 'var(--navy)',
          color: 'var(--cream)', border: 'none', borderRadius: 6,
          fontSize: 13, fontWeight: 600, letterSpacing: 0.5,
          cursor: carregando ? 'wait' : 'pointer',
          fontFamily: 'var(--body)',
          transition: 'background .15s',
        }}>
          {carregando ? 'Entrando…' : 'Entrar'}
        </button>

        <div style={{ marginTop: 18, textAlign: 'center', fontSize: 10, color: 'rgba(0,32,62,0.5)', letterSpacing: 0.5 }}>
          © 2026 Polímata GRC · Acesso restrito
        </div>
      </form>
    </div>
  )
}

const loginInputStyle = {
  width: '100%', padding: '11px 13px',
  border: '1.5px solid #E6DCC8', borderRadius: 6,
  fontFamily: 'var(--body)', fontSize: 13,
  color: 'var(--navy)', background: '#fff',
  transition: 'border-color .15s',
  outline: 'none',
}
