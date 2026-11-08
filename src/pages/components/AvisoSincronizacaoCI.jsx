import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

// =============================================================================
// O AVISO DE QUE O CADASTRO NÃO CHEGOU AO POLÍMATA APP.
//
// O cadastro de clientes alimenta dois sistemas: este e o Polímata App (o CI).
// Quem avisa o outro lado é um gatilho no banco, e ele é assíncrono — dispara
// e segue. Até 08/11/2026, se o aviso falhasse, o registro ia para o log do
// servidor e ninguém via. Um cliente podia existir aqui e não lá, ou ser
// desativado aqui e continuar ativo lá, por tempo indeterminado.
//
// Divergência silenciosa entre dois sistemas é furo de controle — e é
// justamente o que esta consultoria audita nos clientes dela.
//
// O que esta faixa faz: confere as entregas pendentes ao abrir a tela e mostra
// o que não chegou. Ela NÃO aparece quando está tudo entregue: aviso que fica
// sempre na tela deixa de ser aviso.
// =============================================================================
export default function AvisoSincronizacaoCI() {
  const [problemas, setProblemas] = useState([])
  const [erro, setErro] = useState(false)

  const conferir = useCallback(async () => {
    try {
      // Primeiro casa o que o pg_net já respondeu; depois lê o que sobrou.
      // Falhar aqui não pode derrubar a tela de cadastro: na pior hipótese, a
      // faixa não aparece, e a tela funciona como funcionava.
      await supabase.rpc('conferir_entregas_webhook')
      const { data, error } = await supabase
        .from('webhook_entregas')
        .select('id, criado_em, operacao, registro_nome, status, http_status, detalhe')
        .in('status', ['sem_token', 'erro_no_envio', 'recusado', 'sem_resposta'])
        .order('criado_em', { ascending: false })
        .limit(20)
      if (error) { setErro(true); return }
      setErro(false)
      setProblemas(data || [])
    } catch { setErro(true) }
  }, [])

  useEffect(() => { conferir() }, [conferir])

  if (erro || !problemas.length) return null

  const semToken = problemas.some(p => p.status === 'sem_token')
  const mudas = problemas.filter(p => p.status === 'sem_resposta')
  const falhas = problemas.filter(p => p.status !== 'sem_resposta')

  return (
    <div style={caixa}>
      <div style={titulo}>
        {falhas.length > 0
          ? `${falhas.length} cadastro(s) não chegaram ao Polímata App`
          : `${mudas.length} cadastro(s) sem confirmação do Polímata App`}
      </div>

      {semToken && (
        <p style={texto}>
          <strong>O token do webhook não está configurado.</strong> Enquanto não estiver,
          nenhuma mudança de cadastro chega ao outro sistema — nem as próximas.
        </p>
      )}

      {falhas.length > 0 && (
        <p style={texto}>
          Estes clientes existem aqui e podem não existir lá, ou estar com dados diferentes.
          O cadastro não foi desfeito: travar o cadastro por causa do outro sistema seria pior
          que a divergência. Mas ela precisa ser resolvida.
        </p>
      )}

      {mudas.length > 0 && falhas.length === 0 && (
        <p style={texto}>
          O envio aconteceu e a resposta não foi encontrada dentro da janela de conferência.
          <strong> Não dá para afirmar que chegou nem que falhou</strong> — confira no Polímata App
          se estes clientes estão lá.
        </p>
      )}

      <ul style={lista}>
        {problemas.slice(0, 6).map(p => (
          <li key={p.id} style={item}>
            <strong>{p.registro_nome || '(sem nome)'}</strong>
            {' · '}{rotuloOperacao(p.operacao)}
            {' · '}{dataHora(p.criado_em)}
            {' — '}<span style={{ color: 'var(--red)' }}>{rotuloStatus(p.status, p.http_status)}</span>
          </li>
        ))}
        {problemas.length > 6 && (
          <li style={{ ...item, color: 'var(--text-mid)' }}>e mais {problemas.length - 6}…</li>
        )}
      </ul>

      <button onClick={conferir} style={botao}>Conferir de novo</button>
    </div>
  )
}

function rotuloOperacao(op) {
  return { INSERT: 'cadastro novo', UPDATE: 'alteração', DELETE: 'exclusão' }[op] || op
}
function rotuloStatus(status, http) {
  if (status === 'sem_token') return 'não foi enviado: falta o token'
  if (status === 'erro_no_envio') return 'o envio falhou'
  if (status === 'recusado') return `o Polímata App recusou${http ? ` (código ${http})` : ''}`
  return 'sem confirmação'
}
function dataHora(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const caixa = {
  background: 'rgba(231,76,60,0.06)', border: '1px solid rgba(231,76,60,0.35)',
  borderRadius: 9, padding: '13px 15px', marginBottom: 14,
}
const titulo = {
  fontFamily: 'var(--body)', fontSize: 13, fontWeight: 700,
  color: 'var(--red)', marginBottom: 6,
}
const texto = { fontSize: 12, color: 'var(--navy)', margin: '0 0 8px', lineHeight: 1.6 }
const lista = { margin: '0 0 10px', padding: '0 0 0 16px' }
const item = { fontSize: 11.5, color: 'var(--navy)', lineHeight: 1.7 }
const botao = {
  padding: '5px 11px', borderRadius: 5, border: '1px solid var(--cream-dark)',
  background: 'var(--white)', color: 'var(--navy)', fontFamily: 'var(--body)',
  fontSize: 11, fontWeight: 700, cursor: 'pointer',
}
