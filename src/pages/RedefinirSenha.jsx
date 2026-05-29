import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

const LOGO_URL = '/v2-assets/logo-polimata.png'

export default function RedefinirSenha() {
  const navigate = useNavigate()
  const { updatePassword } = useAuth()
  const [senha, setSenha] = useState('')
  const [confirma, setConfirma] = useState('')
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [btnHover, setBtnHover] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setErro('')
    if (senha.length < 6) { setErro('Senha precisa ter pelo menos 6 caracteres.'); return }
    if (senha !== confirma) { setErro('As senhas não coincidem.'); return }
    setSalvando(true)
    const { error } = await updatePassword(senha)
    setSalvando(false)
    if (error) { setErro(error.message || 'Erro ao redefinir senha.'); return }
    // Sucesso → vai pro dashboard (já logado pela sessão de reset)
    navigate('/dashboard', { replace: true })
  }

  return (
    <div style={overlay}>
      <form onSubmit={handleSubmit} style={card}>
        <div style={brand}>
          <img src={LOGO_URL} alt="Polímata" style={{ width: 46, height: 64 }} />
          <div>
            <div style={logoName}>Polímata</div>
            <div style={logoSub}>Consultoria em GRC</div>
          </div>
        </div>
        <div style={title}>Redefinir senha</div>
        <div style={sub}>Escolha sua nova senha</div>

        <div style={field}>
          <label style={label}>Nova senha</label>
          <input type="password" required autoFocus value={senha} onChange={e => setSenha(e.target.value)} style={input}
            onFocus={e => e.target.style.borderColor = 'var(--gold)'}
            onBlur={e => e.target.style.borderColor = 'var(--cream-dark)'} />
        </div>
        <div style={field}>
          <label style={label}>Confirmar nova senha</label>
          <input type="password" required value={confirma} onChange={e => setConfirma(e.target.value)} style={input}
            onFocus={e => e.target.style.borderColor = 'var(--gold)'}
            onBlur={e => e.target.style.borderColor = 'var(--cream-dark)'} />
        </div>
        <div style={error}>{erro}</div>
        <button type="submit" disabled={salvando}
          onMouseEnter={() => setBtnHover(true)}
          onMouseLeave={() => setBtnHover(false)}
          style={{ ...btn, background: btnHover && !salvando ? 'var(--gold-dark)' : 'var(--gold)', transform: btnHover && !salvando ? 'translateY(-1px)' : 'none', boxShadow: btnHover && !salvando ? '0 4px 16px rgba(204,145,94,0.3)' : 'none', cursor: salvando ? 'wait' : 'pointer' }}>
          {salvando ? 'Salvando…' : 'Salvar nova senha'}
        </button>
      </form>
    </div>
  )
}
const overlay = { position: 'fixed', inset: 0, background: 'var(--navy)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }
const card = { background: 'var(--cream)', borderRadius: 12, padding: '40px 44px', width: 380, maxWidth: '92vw', boxShadow: '0 18px 50px rgba(0,0,0,0.35)' }
const brand = { textAlign: 'center', marginBottom: 28, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }
const logoName = { fontFamily: 'var(--display)', fontSize: 38, fontWeight: 300, color: 'var(--navy)', letterSpacing: 1, textAlign: 'center', lineHeight: 1 }
const logoSub = { fontFamily: 'var(--display)', fontSize: 10, fontWeight: 400, color: 'var(--gold)', letterSpacing: 4, textTransform: 'uppercase', marginTop: 6, textAlign: 'center' }
const title = { fontFamily: 'var(--display)', fontSize: 20, fontWeight: 400, color: 'var(--navy)', textAlign: 'center', marginBottom: 4 }
const sub = { fontSize: 11, color: 'var(--text-mid)', textAlign: 'center', marginBottom: 24, letterSpacing: 0.5 }
const field = { marginBottom: 14 }
const label = { display: 'block', fontSize: 9, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--navy)', marginBottom: 6 }
const input = { width: '100%', padding: '11px 13px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 13, color: 'var(--navy)', background: '#fff', transition: 'border-color .15s', outline: 'none' }
const error = { color: 'var(--red)', fontSize: 11, marginTop: 10, minHeight: 15, textAlign: 'center' }
const btn = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: 12, marginTop: 10, borderRadius: 4, fontFamily: 'var(--body)', fontSize: 11, fontWeight: 600, letterSpacing: 0.8, transition: 'all .2s', border: 'none', textTransform: 'uppercase', color: '#fff', width: '100%' }
