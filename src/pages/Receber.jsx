import AppLayout from '../components/AppLayout'

export default function Receber() {
  return (
    <AppLayout title="Contas a Receber">
      <div style={{
        background: 'var(--white)', borderRadius: 12,
        padding: 48, textAlign: 'center',
        boxShadow: 'var(--shadow)',
        border: '1px solid var(--cream-dark)',
      }}>
        <div style={{ fontFamily: 'var(--display)', fontSize: 28, fontWeight: 300, color: 'var(--navy)', marginBottom: 8 }}>
          Contas a Receber — em construção
        </div>
        <p style={{ fontFamily: 'var(--body)', color: 'var(--text-mid)', fontSize: 13, margin: 0 }}>
          A listagem será migrada no próximo PR.
        </p>
      </div>
    </AppLayout>
  )
}
