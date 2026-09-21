import AppLayout from '../components/AppLayout'

// Tela de recurso ainda não construído. Antes ela mandava a usuária para o
// sistema legado (/legado.html); esse arquivo saiu do ar — ele não passava
// pelas regras novas (escrituração, conciliação, fechamento) e podia
// desfazer em silêncio o que o sistema garante.
export default function EmConstrucaoModulo({ titulo, descricao, comoFazerAgora }) {
  return (
    <AppLayout title={titulo}>
      <div style={card}>
        <div style={{ fontSize: 34, marginBottom: 14 }}>🚧</div>
        <div style={tituloStyle}>{titulo}</div>
        <p style={texto}>
          {descricao || 'Esta parte do sistema ainda está sendo construída.'}
        </p>
        {comoFazerAgora && (
          <div style={comoBox}>
            <strong style={{ display: 'block', marginBottom: 4, color: 'var(--navy)' }}>Enquanto isso</strong>
            {comoFazerAgora}
          </div>
        )}
      </div>
    </AppLayout>
  )
}

const card = { background: 'var(--white)', borderRadius: 12, padding: 48, textAlign: 'center', boxShadow: 'var(--shadow)', border: '1px solid var(--cream-dark)', maxWidth: 640, margin: '40px auto 0' }
const tituloStyle = { fontFamily: 'var(--display)', fontSize: 24, fontWeight: 400, color: 'var(--navy)', marginBottom: 10, letterSpacing: 0.3 }
const texto = { fontFamily: 'var(--body)', fontSize: 13, color: 'var(--text-mid)', maxWidth: 460, margin: '0 auto', lineHeight: 1.6 }
const comoBox = { marginTop: 22, padding: '12px 16px', borderRadius: 8, background: 'rgba(0,32,62,0.04)', borderLeft: '3px solid var(--navy)', fontFamily: 'var(--body)', fontSize: 12, color: 'var(--text-mid)', lineHeight: 1.6, textAlign: 'left', maxWidth: 460, margin: '22px auto 0' }
