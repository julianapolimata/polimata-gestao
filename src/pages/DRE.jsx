import { useEffect, useMemo, useState } from 'react'
import AppLayout from '../components/AppLayout'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { fmtMoney, flatten } from '../lib/finance'
import { fetchPlanoContas } from '../lib/planoContas'

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

// Estrutura do DRE — cada bloco com label, sinal (positivo/negativo) e
// classificações que somam. Linhas-subtotal usam type=subtotal.
const DRE_BLOCOS = [
  { id: 'rec-bruta', label: 'Receita Bruta de Serviços', kind: 'positivo', classifs: ['Receita Bruta', 'Outras Receitas'], tipoFin: 'Entrada' },
  { id: 'deducoes', label: '(−) Impostos sobre Vendas', kind: 'negativo', classifs: ['Impostos sobre Vendas'], tipoFin: 'Saída' },
  { id: 'rec-liquida', label: '= Receita Líquida', kind: 'subtotal', formula: 'rec-bruta - deducoes' },
  { id: 'csp', label: '(−) Custo dos Serviços Prestados', kind: 'negativo', classifs: ['CSP'], tipoFin: 'Saída' },
  { id: 'lucro-bruto', label: '= Lucro Bruto', kind: 'subtotal', formula: 'rec-liquida - csp' },
  { id: 'desp-op', label: '(−) Despesas Operacionais', kind: 'negativo', classifs: ['Despesas Operacionais', 'Despesas Comerciais', 'Despesas de Viagens', 'Outras Despesas'], tipoFin: 'Saída' },
  { id: 'ebitda', label: '= EBITDA', kind: 'subtotal', formula: 'lucro-bruto - desp-op' },
  { id: 'rec-fin', label: '(+) Receita Financeira', kind: 'positivo', classifs: ['Receita Financeira'], tipoFin: 'Entrada' },
  { id: 'desp-fin', label: '(−) Despesas Financeiras', kind: 'negativo', classifs: ['Despesas Financeiras'], tipoFin: 'Saída' },
  { id: 'resul-fin', label: '= Resultado Antes de Distribuições', kind: 'subtotal', formula: 'ebitda + rec-fin - desp-fin' },
  { id: 'antec', label: '(−) Antecipação de Lucro', kind: 'negativo', classifs: ['Antecipação de Lucro'], tipoFin: 'Saída' },
  { id: 'liquido', label: '= Lucro Líquido', kind: 'subtotal', strong: true, formula: 'resul-fin - antec' },
]

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

  // ── Categoria → classificação (mapa do plano_contas) ─────────────────
  const catToClass = useMemo(() => {
    const m = new Map()
    for (const p of plano) {
      if (p.categoria && p.classificacao) m.set(`${p.tipo}|${p.categoria}`, p.classificacao)
    }
    return m
  }, [plano])

  // ── Agrupa lançamentos: { [classif]: { total, byMes[12], byCat: { [cat]: { total, byMes[12] } } } } ──
  const grupos = useMemo(() => {
    const out = {} // classif → bucket
    function bucket(classif) {
      if (!out[classif]) out[classif] = { total: 0, byMes: new Array(12).fill(0), byCat: {} }
      return out[classif]
    }
    function dataCompetenciaDe(reg) {
      return reg.data?.data_competencia || reg.due || reg.created || null
    }
    function processa(reg, tipoFin) {
      // Provisão é previsão, não fato — não entra no DRE até ser realizada (NF emitida).
      if (reg.data?.status === 'Provisão') return
      const ref = dataCompetenciaDe(reg)
      if (!ref || !ref.startsWith(ano)) return
      const m = parseInt(ref.substring(5, 7), 10) - 1
      if (m < 0 || m > 11) return
      const cat = reg.data?.cat
      if (!cat) return
      const classif = catToClass.get(`${tipoFin}|${cat}`)
      if (!classif) return
      const val = Number(reg.value || 0)
      const b = bucket(classif)
      b.total += val
      b.byMes[m] += val
      if (!b.byCat[cat]) b.byCat[cat] = { total: 0, byMes: new Array(12).fill(0) }
      b.byCat[cat].total += val
      b.byCat[cat].byMes[m] += val
    }
    receivable.forEach(r => processa(r, 'Entrada'))
    payable.forEach(r => processa(r, 'Saída'))
    return out
  }, [receivable, payable, catToClass, ano])

  // ── Calcula linhas do DRE ────────────────────────────────────────────
  const linhas = useMemo(() => {
    const valores = {}
    const out = []
    for (const blk of DRE_BLOCOS) {
      if (blk.kind === 'subtotal') {
        const v = evalFormula(blk.formula, valores)
        valores[blk.id] = v
        out.push({ ...blk, total: v.total, byMes: v.byMes, subItems: [] })
      } else {
        // Soma das classificações do bloco
        let total = 0
        const byMes = new Array(12).fill(0)
        const subItems = []
        for (const classif of blk.classifs) {
          const g = grupos[classif]
          if (!g) continue
          total += g.total
          for (let m = 0; m < 12; m++) byMes[m] += g.byMes[m]
          for (const [cat, catData] of Object.entries(g.byCat)) {
            subItems.push({ label: cat, classif, total: catData.total, byMes: catData.byMes })
          }
        }
        subItems.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))
        valores[blk.id] = { total, byMes }
        out.push({ ...blk, total, byMes, subItems })
      }
    }
    return out
  }, [grupos])

  function evalFormula(formula, valores) {
    const tokens = formula.split(/\s+/)
    let total = 0
    const byMes = new Array(12).fill(0)
    let sinal = 1
    for (const t of tokens) {
      if (t === '+') { sinal = 1; continue }
      if (t === '-') { sinal = -1; continue }
      const v = valores[t]
      if (!v) continue
      total += sinal * v.total
      for (let m = 0; m < 12; m++) byMes[m] += sinal * v.byMes[m]
    }
    return { total, byMes }
  }

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
            Agrupado por classificação do plano de contas. Valores baseados em <code>data_competencia</code>
            {' '}quando preenchido, ou em <code>vencimento</code> como fallback.
          </div>
        </div>
        <select value={ano} onChange={e => setAno(e.target.value)} style={selectAno}>
          {anosDisponiveis.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

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
