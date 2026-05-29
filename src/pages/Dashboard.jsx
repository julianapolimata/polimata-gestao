import AppLayout from '../components/AppLayout'

export default function Dashboard() {
  return (
    <AppLayout title="Painel Financeiro">
      <div style={{
        background: 'var(--white)', borderRadius: 12,
        padding: 48, textAlign: 'center',
        boxShadow: 'var(--shadow)',
        border: '1px solid var(--cream-dark)',
      }}>
        <div style={{ fontFamily: 'var(--display)', fontSize: 28, fontWeight: 300, color: 'var(--navy)', marginBottom: 8 }}>
          Em construção
        </div>
        <p style={{ fontFamily: 'var(--body)', color: 'var(--text-mid)', fontSize: 13, margin: 0, maxWidth: 480, marginLeft: 'auto', marginRight: 'auto' }}>
          O Painel Financeiro será migrado em breve. Por enquanto, acesse <a href="/" style={{ color: 'var(--gold)', textDecoration: 'none', fontWeight: 600 }}>o sistema atual</a> ou navegue por Contas a Receber no menu.
        </p>
      </div>
    </AppLayout>
  )
}
