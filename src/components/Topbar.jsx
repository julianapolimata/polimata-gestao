import { useAuth } from '../contexts/AuthContext'

export default function Topbar({ title }) {
  const { user, signOut } = useAuth()

  async function handleLogout() {
    await signOut()
    window.location.href = '/v2/login'
  }

  return (
    <div style={{
      height: 60, background: 'var(--cream)',
      borderBottom: '1px solid var(--cream-dark)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 28px',
      flexShrink: 0,
    }}>
      <h1 style={{
        margin: 0, fontFamily: 'var(--display)',
        fontSize: 22, fontWeight: 400, color: 'var(--navy)',
        letterSpacing: 0.5,
      }}>{title}</h1>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--text-mid)', fontFamily: 'var(--body)' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--gold)' }} />
          <span>{user?.email || '—'}</span>
        </div>
        <button onClick={handleLogout} style={btnOutline} title="Sair">
          <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          Sair
        </button>
      </div>
    </div>
  )
}

const btnOutline = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '6px 12px',
  background: 'transparent', color: 'var(--navy)',
  border: '1.5px solid var(--cream-dark)',
  borderRadius: 4,
  fontFamily: 'var(--body)', fontSize: 11, fontWeight: 600,
  letterSpacing: 0.8, textTransform: 'uppercase',
  cursor: 'pointer', transition: 'all .2s',
}
