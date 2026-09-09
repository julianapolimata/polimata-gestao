import { useEffect, useMemo, useState } from 'react'
import AppLayout from '../components/AppLayout'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { fmtMoney, flatten } from '../lib/finance'
import { fetchPlanoContas } from '../lib/planoContas'
import { computeDRE } from '../lib/dre'

// =====================================================================
// DRE GERENCIAL — Demonstrativo do Resultado por regime de competência
// (CPC 26). Não é migração — construído do zero (legado é placeholder).
//
// Regime: usa data.data_competencia se preenchido, senão fallback pra
// data.due. Considera todos os lançamentos do ano, independente de
// status (Pago/Recebido/Pendente) — competência olha quando o serviço
// foi prestado, não quando o caixa entrou/saiu.
//
// Estrutura DRE construída a partir do campo `classificacao` do
// plano_contas (com 91 categorias estruturadas).
// =====================================================================

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']


export default function DRE() {
  const { user } = useAuth()
  const [ano, setAno] = useState(String(new Date().getFullYear()))
  const [receivable, setReceivable] = useState([])
  const [payable, setPayable] = useState([])
  const [plano, setPlano] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandido, setExpandido] = useState(() => new Set())

  useEffect(() => {
    if (!user) return undefined
    let cancelled = false
    setLoading(true)
    Promise.all([
      supabase.from('receivable').select('id,codigo,data,created_at,updated_at'),
      supabase.from('payable').select('id,codigo,data,created_at,updated_at'),
      fetchPlanoContas(),
    ]).then(([rRec, rPay, plano]) => {
      if (cancelled) return
      setReceivable((rRec.data || []).map(flatten))
      setPayable((rPay.data || []).map(flatten))
      setPlano(plano || [])
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [user])

  // ── Anos disponíveis derivados dos dados ─────────────────────────────
  const anosDisponiveis = useMemo(() => {
    const set = new Set()
    const extrair = arr => arr.forEach(r => {
      const ref = r.data?.data_competencia || r.due || r.created
      if (ref) set.add(ref.substring(0, 4))
    })
    extrair(receivable)
    extrair(payable)
    if (!set.size) set.add(String(new Date().getFullYear()))
    return [...set].sort().reverse()
  }, [receivable, payable])
  useEffect(() => {
    if (anosDisponiveis.length && !anosDisponiveis.includes(ano)) setAno(anosDisponiveis[0])
  }, [anosDisponiveis, ano])

  // Um motor só (lib/dre.js): a tela e o PDF calculam igual. Antes eram dois
  // códigos copiados "em sincronia de propósito" e podiam divergir.
  const linhas = useMemo(() => computeDRE({ receivable, payable, plano, ano }), [receivable, payable, plano, ano])
  const fora = linhas.fora || { count: 0, total: 0, porCat: {} }
  const naoEscriturados = linhas.naoEscriturados || { count: 0, total: 0 }

  function toggleExp(id) {
    setExpandido(s => {
      const ns = new Set(s)
      if (ns.has(id)) ns.delete(id); else ns.add(id)
      return ns
    })
  }

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <AppLayout title="DRE Gerencial">
      <div style={topo}>
        <div>
          <div style={{ fontSize: 13, color: 'var(--text-mid)', marginBottom: 4 }}>
            Demonstrativo do Resultado do Exercício · Regime de Competência (CPC 26)
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-mid)', fontStyle: 'italic' }}>
            Cada lançamento entra no mês do fato gerador (data de emissão); sem essa data, no mês do vencimento. Provisões, captação/amortização de empréstimo e créditos de fatura ficam fora.
          </div>
        </div>
        <select value={ano} onChange={e => setAno(e.target.value)} style={selectAno}>
          {anosDisponiveis.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {(fora.count > 0 || naoEscriturados.count > 0) && (
        <div style={{ margin: '0 0 14px', padding: '10px 14px', background: 'rgba(204,145,94,0.10)', border: '1px solid var(--gold)', borderRadius: 8, fontSize: 12, color: 'var(--navy)', lineHeight: 1.6 }}>
          {fora.count > 0 && (
            <div>⚠️ <strong>{fora.count} lançamento(s) · {fmtMoney(fora.total)} ficaram FORA da DRE</strong> (sem categoria ou categoria fora do plano de contas): {Object.entries(fora.porCat).map(([cat, v]) => `${cat} (${v.count})`).join(' · ')}. <a href="/classificar" style={{ color: 'var(--gold-dark)', fontWeight: 700 }}>Escriturar →</a></div>
          )}
          {naoEscriturados.count > 0 && (
            <div>📋 Inclui <strong>{naoEscriturados.count} lançamento(s) · {fmtMoney(naoEscriturados.total)} ainda não escriturados</strong> (sem revisão) — os números podem mudar depois da escrituração.</div>
          )}
        </div>
      )}
      <div style={tableWrap}>
        {loading ? (
          <div style={emptyState}>Carregando…</div>
        ) : (
          <div style={{ overflowX: 'visible' }}>
            <table style={tbl}>
              <thead>
                <tr style={{ background: 'var(--navy)', color: '#fff' }}>
                  <th style={{ ...thBase, textAlign: 'left', minWidth: 280 }}>Linha</th>
                  {MESES.map(m => <th key={m} style={{ ...thBase, textAlign: 'right' }}>{m}</th>)}
                  <th style={{ ...thBase, textAlign: 'right', background: 'rgba(255,255,255,0.08)' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map(l => {
                  const isSubtotal = l.kind === 'subtotal'
                  const corBase = isSubtotal
                    ? 'var(--navy)'
                    : (l.kind === 'positivo' ? 'var(--green)' : 'var(--red)')
                  const corTot = l.total >= 0 ? 'var(--green)' : 'var(--red)'
                  const bgRow = l.strong ? 'rgba(204,145,94,0.06)' : (isSubtotal ? 'var(--cream)' : 'transparent')
                  const exp = expandido.has(l.id)
                  const podeExp = l.subItems && l.subItems.length > 0
                  return (
                    <FragmentLinha
                      key={l.id} linha={l} exp={exp} podeExp={podeExp}
                      onToggle={() => toggleExp(l.id)}
                      isSubtotal={isSubtotal} bg={bgRow} corBase={corBase} corTot={corTot}
                    />
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppLayout>
  )
}

function FragmentLinha({ linha, exp, podeExp, onToggle, isSubtotal, bg, corBase, corTot }) {
  return (
    <>
      <tr style={{ background: bg, borderBottom: isSubtotal ? '2px solid var(--cream-dark)' : '1px solid var(--cream-dark)' }}>
        <td style={{
          ...td,
          fontWeight: isSubtotal ? 700 : 600,
          color: corBase,
          cursor: podeExp ? 'pointer' : 'default',
          fontSize: linha.strong ? 13 : 12,
        }} onClick={podeExp ? onToggle : undefined}>
          {podeExp && <span style={{ marginRight: 6, color: 'var(--text-mid)', fontSize: 10 }}>{exp ? '▼' : '▶'}</span>}
          {linha.label}
        </td>
        {linha.byMes.map((v, i) => (
          <td key={i} style={{ ...td, textAlign: 'right', color: v === 0 ? 'var(--text-mid)' : corBase, fontWeight: isSubtotal ? 700 : 500 }}>
            {v === 0 ? '—' : fmtMoney(v)}
          </td>
        ))}
        <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: isSubtotal ? corTot : corBase, background: 'rgba(0,0,0,0.025)' }}>
          {linha.total === 0 ? '—' : fmtMoney(linha.total)}
        </td>
      </tr>
      {exp && linha.subItems.map(sub => (
        <tr key={`${linha.id}-${sub.label}`} style={{ background: 'var(--white)' }}>
          <td style={{ ...td, paddingLeft: 36, color: 'var(--text-mid)', fontWeight: 400, fontSize: 11 }}>
            ↳ {sub.label}
          </td>
          {sub.byMes.map((v, i) => (
            <td key={i} style={{ ...td, textAlign: 'right', color: 'var(--text-mid)', fontSize: 11 }}>
              {v === 0 ? '' : fmtMoney(v)}
            </td>
          ))}
          <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: 'var(--text-mid)', fontSize: 11, background: 'rgba(0,0,0,0.02)' }}>
            {sub.total === 0 ? '' : fmtMoney(sub.total)}
          </td>
        </tr>
      ))}
    </>
  )
}

const topo = { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 18, flexWrap: 'wrap' }
const selectAno = { fontFamily: 'var(--body)', fontSize: 12, padding: '8px 14px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, background: 'var(--white)', color: 'var(--navy)', cursor: 'pointer', outline: 'none' }
const tableWrap = { background: 'var(--white)', borderRadius: 12, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)', overflow: 'clip' }
const tbl = { width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--body)' }
const thBase = { background: 'var(--navy)', color: '#fff', padding: '10px 12px', fontSize: 9, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }
const td = { padding: '8px 12px', fontSize: 12, color: 'var(--navy)', verticalAlign: 'middle' }
const emptyState = { padding: '60px 24px', textAlign: 'center', fontFamily: 'var(--body)', color: 'var(--text-mid)', fontSize: 13 }
