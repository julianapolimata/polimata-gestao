import AppLayout from '../components/AppLayout'

export default function EmConstrucaoModulo({ titulo, descricao, hashLegado }) {
  const linkLegado = hashLegado ? `/#${hashLegado}` : '/'
  return (
    <AppLayout title={titulo}>
      <div style={{
        background: 'var(--white)', borderRadius: 12,
        padding: 56, textAlign: 'center',
        boxShadow: 'var(--shadow)',
        border: '1px solid var(--cream-dark)',
        maxWidth: 640, margin: '40px auto 0',
      }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>🚧</div>
        <div style={{ fontFamily: 'var(--display)', fontSize: 26, fontWeight: 400, color: 'var(--navy)', marginBottom: 10, letterSpacing: 0.3 }}>
          {titulo}
        </div>
        <p style={{ fontFamily: 'var(--body)', fontSize: 13, color: 'var(--text-mid)', maxWidth: 460, margin: '0 auto 28px', lineHeight: 1.6 }}>
          {descricao || 'Esta tela ainda não foi migrada para a nova versão. Use o sistema atual por enquanto — todos os seus dados estão lá.'}
        </p>
        <a href={linkLegado} style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '11px 22px', borderRadius: 4,
          background: 'var(--gold)', color: '#fff',
          fontFamily: 'var(--body)', fontSize: 11, fontWeight: 600,
          letterSpacing: 0.8, textTransform: 'uppercase',
          textDecoration: 'none', transition: 'all .2s',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--gold-dark)'; e.currentTarget.style.transform = 'translateY(-1px)' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'var(--gold)'; e.currentTarget.style.transform = 'none' }}
        >
          Acessar no sistema atual
          <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
          </svg>
        </a>
      </div>
    </AppLayout>
  )
}
