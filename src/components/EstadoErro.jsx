// Estado visual de erro de carregamento, compartilhado pelas telas de lista.
// Usado quando a leitura no Supabase falha (rede caiu, sessão expirou, RLS),
// para NUNCA confundir "falha ao carregar" com "nada cadastrado".
export default function EstadoErro({ onRetry, mensagem }) {
  return (
    <div style={wrap}>
      <div style={{ fontSize: 30, marginBottom: 10 }}>⚠️</div>
      <div style={{ fontWeight: 700, color: 'var(--navy)', marginBottom: 4 }}>
        {mensagem || 'Não foi possível carregar os dados.'}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-mid)', marginBottom: 18 }}>
        Verifique sua conexão e tente novamente. Seus dados não foram perdidos.
      </div>
      {onRetry && (
        <button type="button" onClick={onRetry} style={btn}>Tentar novamente</button>
      )}
    </div>
  )
}

const wrap = { padding: '60px 24px', textAlign: 'center', fontFamily: 'var(--body)', color: 'var(--text-mid)', fontSize: 13 }
const btn = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 6, border: 'none', background: 'var(--gold)', color: '#fff', fontFamily: 'var(--body)', fontSize: 12, fontWeight: 700, letterSpacing: 0.5, cursor: 'pointer', textTransform: 'uppercase' }
