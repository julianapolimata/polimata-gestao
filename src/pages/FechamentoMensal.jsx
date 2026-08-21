import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import AppLayout from '../components/AppLayout'
import EstadoErro from '../components/EstadoErro'

// =====================================================================
// FECHAMENTO MENSAL — visão de "o que falta fazer em cada mês".
// Status DETECTADO automaticamente dos dados (sem marcação manual):
//   Extrato importado · Conciliação · Contas do mês · DAS/Impostos
// =====================================================================

const MESES_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
function mesLabel(ym) {
  const [y, m] = ym.split('-')
  return `${MESES_PT[Number(m) - 1] || m}/${y.slice(2)}`
}
const ym = s => (s || '').slice(0, 7)

function Pill({ tom, children }) {
  const cores = {
    ok: { bg: 'rgba(39,174,96,0.10)', cor: 'var(--green)' },
    alerta: { bg: 'rgba(204,145,94,0.14)', cor: 'var(--gold-dark)' },
    ruim: { bg: 'rgba(231,76,60,0.09)', cor: 'var(--red)' },
    vazio: { bg: 'transparent', cor: 'var(--text-mid)' },
  }[tom] || {}
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: cores.bg, color: cores.cor, whiteSpace: 'nowrap' }}>
      {children}
    </span>
  )
}

// Cada célula devolve { tom, txt }
function cExtrato(g) { return g.extTotal > 0 ? { tom: 'ok', txt: '✅ Importado' } : { tom: 'vazio', txt: '— não importado' } }
function cConcil(g) {
  if (g.extTotal === 0) return { tom: 'vazio', txt: '—' }
  const pct = Math.round((g.extResolv / g.extTotal) * 100)
  if (pct >= 100) return { tom: 'ok', txt: '✅ Conciliado' }
  if (pct > 0) return { tom: 'alerta', txt: `⚠️ ${pct}% conciliado` }
  return { tom: 'ruim', txt: '🔴 A conciliar' }
}
function cContas(g) {
  const total = g.recTotal + g.pagTotal
  const pend = (g.recTotal - g.recQuit) + (g.pagTotal - g.pagQuit)
  if (total === 0) return { tom: 'vazio', txt: '—' }
  if (pend === 0) return { tom: 'ok', txt: '✅ Tudo quitado' }
  return { tom: 'alerta', txt: `⚠️ ${pend} pendente(s)` }
}
function cFatura(g) {
  if (g.fatTotal === 0) return { tom: 'vazio', txt: '— não importada' }
  const pend = g.fatTotal - g.fatQuit
  if (pend === 0) return { tom: 'ok', txt: `✅ ${g.fatTotal} lançs` }
  return { tom: 'alerta', txt: `⚠️ ${pend} a pagar` }
}
function cDas(g) {
  if (g.impTotal === 0) return { tom: 'vazio', txt: '— sem imposto' }
  if (g.impPago >= g.impTotal) return { tom: 'ok', txt: '✅ Pago' }
  return { tom: 'alerta', txt: `⚠️ ${g.impTotal - g.impPago} a pagar` }
}

export default function FechamentoMensal() {
  const { user } = useAuth()
  const [extratos, setExtratos] = useState([])
  const [receivable, setReceivable] = useState([])
  const [payable, setPayable] = useState([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState(null)

  const carregar = useCallback(() => {
    if (!user) return
    setLoading(true)
    // Seleciona só os campos necessários (evita puxar os anexos base64).
    Promise.all([
      supabase.from('transacoes_extrato').select('id, dt:data->>data, st:data->>status, rev:data->>revisar'),
      supabase.from('receivable').select('id, due:data->>due, st:data->>status'),
      supabase.from('payable').select('id, due:data->>due, st:data->>status, cat:data->>cat, fat:data->>criado_via_import_fatura'),
    ]).then(([e, r, p]) => {
      const err = e.error || r.error || p.error
      if (err) { setErro(err); setLoading(false); return }
      setErro(null)
      setExtratos(e.data || [])
      setReceivable(r.data || [])
      setPayable(p.data || [])
      setLoading(false)
    }).catch(err => { setErro(err); setLoading(false) })
  }, [user])
  useEffect(() => { carregar() }, [carregar])

  const linhas = useMemo(() => {
    const meses = {}
    const get = k => (meses[k] || (meses[k] = { extTotal: 0, extResolv: 0, recTotal: 0, recQuit: 0, pagTotal: 0, pagQuit: 0, impTotal: 0, impPago: 0, fatTotal: 0, fatQuit: 0 }))

    for (const e of extratos) {
      const k = ym(e.dt); if (!k) continue
      const g = get(k); g.extTotal++
      if (e.st === 'conciliado' || e.st === 'ignorado') g.extResolv++
    }
    for (const r of receivable) {
      const k = ym(r.due); if (!k || r.st === 'Provisão') continue
      const g = get(k); g.recTotal++
      if (r.st === 'Recebido') g.recQuit++
    }
    for (const p of payable) {
      const k = ym(p.due); if (!k || p.st === 'Provisão') continue
      const g = get(k); g.pagTotal++
      if (p.st === 'Pago') g.pagQuit++
      if (p.cat === 'Impostos') { g.impTotal++; if (p.st === 'Pago') g.impPago++ }
      if (p.fat === 'true') { g.fatTotal++; if (p.st === 'Pago') g.fatQuit++ }
    }
    return Object.entries(meses)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([k, g]) => ({ ym: k, ...g }))
  }, [extratos, receivable, payable])

  const revisarCount = useMemo(() => (extratos || []).filter(e => e.rev === 'true' || e.rev === true).length, [extratos])

  if (loading) return <AppLayout title="Fechamento Mensal"><div style={emptyState}>Carregando…</div></AppLayout>
  if (erro) return <AppLayout title="Fechamento Mensal"><EstadoErro onRetry={carregar} /></AppLayout>

  return (
    <AppLayout title="Fechamento Mensal">
      <div style={{ fontSize: 12, color: 'var(--text-mid)', marginBottom: 16, lineHeight: 1.6 }}>
        Status de cada mês, <strong>detectado automaticamente</strong> pelos dados — sem precisar marcar nada.
        Bata o olho pra ver o que ainda falta fechar. <span style={{ color: 'var(--gold-dark)' }}>⚠️ = pendente</span> · <span style={{ color: 'var(--green)' }}>✅ = ok</span> · — = sem movimento.
      </div>

      {revisarCount > 0 && (
        <div style={{ marginBottom: 16, padding: 12, borderRadius: 8, background: 'rgba(204,145,94,0.12)', borderLeft: '3px solid var(--gold-dark)', color: 'var(--gold-dark)', fontSize: 13, fontWeight: 600 }}>
          ⚠️ Ação pendente: {revisarCount} linha(s) do extrato marcada(s) para revisar (ex.: possível Pix duplicado). Resolva na tela de <strong>Conciliação</strong> — procure o selo <strong>⚠️ REVISAR</strong>.
        </div>
      )}

      <div style={tableCard}>
        {linhas.length === 0 ? (
          <div style={emptyState}>Nenhum movimento ainda. Importe um extrato ou lance contas pra ver o fechamento por mês.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={tbl}>
              <thead>
                <tr>
                  <th style={{ ...th, width: 110 }}>Mês</th>
                  <th style={th}>Extrato</th>
                  <th style={th}>Conciliação</th>
                  <th style={th}>Fatura cartão</th>
                  <th style={th}>Contas do mês</th>
                  <th style={th}>DAS / Impostos</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map(g => {
                  const cells = [cExtrato(g), cConcil(g), cFatura(g), cContas(g), cDas(g)]
                  const tudoOk = cells.every(c => c.tom === 'ok' || c.tom === 'vazio')
                  return (
                    <tr key={g.ym}>
                      <td style={{ ...td, fontWeight: 700, color: 'var(--navy)' }}>
                        {mesLabel(g.ym)}
                        {tudoOk && <span title="Mês fechado" style={{ marginLeft: 6, fontSize: 11 }}>🔒</span>}
                      </td>
                      {cells.map((c, i) => <td key={i} style={td}><Pill tom={c.tom}>{c.txt}</Pill></td>)}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={notaBox}>
        <strong>Como o sistema decide:</strong> <em>Extrato</em> = tem linhas de extrato importadas no mês · <em>Conciliação</em> = % das linhas já batidas com lançamentos · <em>Fatura cartão</em> = compras de fatura de cartão importadas com vencimento no mês (e quantas ainda a pagar) · <em>Contas do mês</em> = a receber/pagar com vencimento no mês, quantas ainda pendentes · <em>DAS/Impostos</em> = guias (categoria Impostos) do mês já pagas. Guias sem data e provisões não contam.
      </div>
    </AppLayout>
  )
}

const tableCard = { background: 'var(--white)', borderRadius: 12, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)', overflow: 'hidden' }
const tbl = { width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--body)' }
const th = { textAlign: 'left', fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--text-mid)', padding: '14px 18px', borderBottom: '1px solid var(--cream-dark)', background: 'var(--cream)' }
const td = { padding: '13px 18px', fontSize: 13, color: 'var(--navy)', borderBottom: '1px solid var(--cream-dark)' }
const emptyState = { padding: '60px 24px', textAlign: 'center', fontFamily: 'var(--body)', color: 'var(--text-mid)', fontSize: 13 }
const notaBox = { marginTop: 16, padding: 14, borderRadius: 8, background: 'rgba(0,32,62,0.03)', border: '1px solid var(--cream-dark)', fontSize: 11, color: 'var(--text-mid)', lineHeight: 1.7 }
