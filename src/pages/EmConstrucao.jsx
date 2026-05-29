export default function EmConstrucao() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
      <h1 className="font-display" style={{ fontSize: 48, fontWeight: 500, color: 'var(--navy)', marginBottom: 8 }}>
        Polímata GRC · v2
      </h1>
      <p style={{ fontSize: 14, color: 'var(--navy)', opacity: 0.6, marginBottom: 32, maxWidth: 420 }}>
        Nova versão em construção. As telas serão migradas progressivamente.
      </p>
      <a href="/" style={{ display: 'inline-block', padding: '10px 24px', background: 'var(--navy)', color: 'var(--cream)', textDecoration: 'none', fontSize: 13, fontWeight: 500, borderRadius: 6, fontFamily: 'var(--body)' }}>
        ← Voltar pro sistema atual
      </a>
    </div>
  )
}
