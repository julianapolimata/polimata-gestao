import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

// Identidade visual idêntica ao public/index.html legado
// Botão "Entrar" usa --gold (NÃO navy) — é btn-primary do legado
const LOGO_URL = '/v2-assets/logo-polimata.png'

export default function Login() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(false)
  const [btnHover, setBtnHover] = useState(false)

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
    <div style={loginOverlay}>
      <form onSubmit={handleSubmit} style={loginCard}>
        {/* Brand: logo + texto */}
        <div style={loginBrand}>
          <img src={LOGO_URL} alt="Polímata" style={{ width: 46, height: 64 }} />
          <div>
            <div style={logoName}>Polímata</div>
            <div style={logoSub}>Consultoria em GRC</div>
          </div>
        </div>

        <div style={loginTitle}>Acessar sistema</div>
        <div style={loginSub}>Entre com seu e-mail e senha</div>

        <div style={loginField}>
          <label style={loginLabel}>E-mail</label>
          <input
            type="email" required autoComplete="email" autoFocus
            value={email} onChange={e => setEmail(e.target.value)}
            style={loginInput}
            onFocus={e => e.target.style.borderColor = 'var(--gold)'}
            onBlur={e => e.target.style.borderColor = 'var(--cream-dark)'}
          />
        </div>

        <div style={loginField}>
          <label style={loginLabel}>Senha</label>
          <input
            type="password" required autoComplete="current-password"
            value={password} onChange={e => setPassword(e.target.value)}
            style={loginInput}
            onFocus={e => e.target.style.borderColor = 'var(--gold)'}
            onBlur={e => e.target.style.borderColor = 'var(--cream-dark)'}
          />
        </div>

        <div style={loginError}>{erro}</div>

        <div style={{ textAlign: 'right', marginTop: -4, marginBottom: 6 }}>
          <Link to="/esqueci-senha" style={{ fontSize: 10, color: 'var(--gold)', textDecoration: 'none', fontWeight: 600, fontFamily: 'var(--body)', letterSpacing: 0.5 }}>Esqueci a senha</Link>
        </div>

        <button
          type="submit"
          disabled={carregando}
          onMouseEnter={() => setBtnHover(true)}
          onMouseLeave={() => setBtnHover(false)}
          style={{ ...btnPrimary, ...loginBtnExtra, background: btnHover && !carregando ? 'var(--gold-dark)' : 'var(--gold)', transform: btnHover && !carregando ? 'translateY(-1px)' : 'none', boxShadow: btnHover && !carregando ? '0 4px 16px rgba(204,145,94,0.3)' : 'none', cursor: carregando ? 'wait' : 'pointer' }}
        >
          {carregando ? 'Entrando…' : 'Entrar'}
        </button>

        <div style={loginFoot}>© 2026 Polímata GRC · Acesso restrito</div>
      </form>
    </div>
  )
}

// ─── styles (idênticos ao legado) ───
const loginOverlay = {
  position: 'fixed', inset: 0, background: 'var(--navy)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
}
const loginCard = {
  background: 'var(--cream)', borderRadius: 12,
  padding: '40px 44px', width: 380, maxWidth: '92vw',
  boxShadow: '0 18px 50px rgba(0,0,0,0.35)',
}
const loginBrand = {
  textAlign: 'center', marginBottom: 28,
  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
}
const logoName = {
  fontFamily: 'var(--display)',  // Quicksand
  fontSize: 38, fontWeight: 300,
  color: 'var(--navy)', letterSpacing: 1,
  textAlign: 'center',
  lineHeight: 1,
}
const logoSub = {
  fontFamily: 'var(--display)',  // Quicksand
  fontSize: 10, fontWeight: 400,
  color: 'var(--gold)', letterSpacing: 4,
  textTransform: 'uppercase', marginTop: 6,
  textAlign: 'center',
}
const loginTitle = {
  fontFamily: 'var(--display)',  // Quicksand
  fontSize: 20, fontWeight: 400,
  color: 'var(--navy)', textAlign: 'center', marginBottom: 4,
}
const loginSub = {
  fontSize: 11, color: 'var(--text-mid)',
  textAlign: 'center', marginBottom: 24, letterSpacing: 0.5,
}
const loginField = { marginBottom: 14 }
const loginLabel = {
  display: 'block', fontSize: 9, fontWeight: 700,
  letterSpacing: 2, textTransform: 'uppercase',
  color: 'var(--navy)', marginBottom: 6,
}
const loginInput = {
  width: '100%', padding: '11px 13px',
  border: '1.5px solid var(--cream-dark)', borderRadius: 6,
  fontFamily: 'var(--body)', fontSize: 13,
  color: 'var(--navy)', background: '#fff',
  transition: 'border-color .15s', outline: 'none',
}
const loginError = {
  color: 'var(--red)', fontSize: 11, marginTop: 10,
  minHeight: 15, textAlign: 'center',
}
const btnPrimary = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7,
  padding: '8px 18px', borderRadius: 4,
  fontFamily: 'var(--body)', fontSize: 11,
  fontWeight: 600, letterSpacing: 0.8,
  cursor: 'pointer', transition: 'all .2s',
  border: 'none', textTransform: 'uppercase',
  background: 'var(--gold)', color: '#fff',
}
const loginBtnExtra = {
  width: '100%', marginTop: 10, padding: 12,
}
const loginFoot = {
  marginTop: 18, textAlign: 'center',
  fontSize: 10, color: 'var(--text-mid)', letterSpacing: 0.5,
}
