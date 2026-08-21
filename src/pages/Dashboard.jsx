import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Chart } from 'chart.js/auto'
import AppLayout from '../components/AppLayout'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import {
  fmtMoney, flatten, isOverdue, getDocStatus, inMonth, monthLabels, today,
} from '../lib/finance'
import { fetchPlanoContas } from '../lib/planoContas'
import { calcMRR, calcDespesaRecorrente, calcInadimplencia, calcMargem, calcLiquidez, calcConcentracao } from '../lib/indicadores'

// =====================================================================
// PAINEL FINANCEIRO — 4 KPIs enxutos decididos na auditoria 26/abr/2026:
//
//  1. ICC               — meses de cobertura de caixa
//  2. Saldo Projetado   — 30/60/90 dias
//  3. Faturamento Mensal — vs mês passado + mini-chart 6m
//  4. Próximas a Pagar  — top 5 por vencimento
//
// + Banner de alertas (vencidos R/P + NFs pendentes)
// + Gráfico Evolução do Caixa (12 meses)
// + Tabela Mês a Mês
// =====================================================================

export default function Dashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [receivable, setReceivable] = useState([])
  const [payable, setPayable] = useState([])
  const [recurringMasters, setRecurringMasters] = useState([])
  const [plano, setPlano] = useState([])
  const [painelCfg, setPainelCfg] = useState(null)
  const [metaMeses, setMetaMeses] = useState(6)
  const [loading, setLoading] = useState(true)
  const canvasRef = useRef(null)
  const chartRef = useRef(null)
  const sparkRef = useRef(null)
  const sparkChartRef = useRef(null)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    setLoading(true)
    Promise.all([
      supabase.from('receivable').select('id,codigo,data,created_at,updated_at,anexo_path'),
      supabase.from('payable').select('id,codigo,data,created_at,updated_at,anexo_path'),
      supabase.from('recurring_masters').select('*'),
      supabase.from('painel_config').select('*').limit(1),
      fetchPlanoContas(),
    ]).then(([rRec, rPay, rRm, rCfg, planoData]) => {
      if (cancelled) return
      setReceivable((rRec.data || []).map(flatten))
      setPayable((rPay.data || []).map(flatten))
      setRecurringMasters(rRm.data || [])
      const cfg = rCfg.data?.[0] || null
      setPainelCfg(cfg)
      if (cfg?.data?.meta_icc_meses != null) setMetaMeses(Number(cfg.data.meta_icc_meses))
      setPlano(planoData || [])
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [user])

  // ── Alertas ──────────────────────────────────────────────────────────
  const alerts = useMemo(() => {
    const out = []
    const overdueRec = receivable.filter(r => r.status !== 'Recebido' && isOverdue(r.due))
    const overduePay = payable.filter(r => r.status !== 'Pago' && isOverdue(r.due))
    if (overdueRec.length) out.push({ kind: 'danger', to: '/receber?filtro=vencidos', text: `⚠️ ${overdueRec.length} recebível(is) vencido(s) — ${fmtMoney(overdueRec.reduce((a, r) => a + r.value, 0))}` })
    if (overduePay.length) out.push({ kind: 'danger', to: '/pagar?filtro=vencidos', text: `🔴 ${overduePay.length} pagamento(s) em atraso — ${fmtMoney(overduePay.reduce((a, r) => a + r.value, 0))}` })
    const semDocRec = receivable.filter(r => getDocStatus(r) === 'pendente')
    const semDocPay = payable.filter(r => getDocStatus(r) === 'pendente')
    const semDoc = [...semDocRec, ...semDocPay]
    if (semDoc.length) out.push({ kind: 'warning', to: semDocPay.length >= semDocRec.length ? '/pagar?filtro=sem_doc' : '/receber?filtro=sem_doc', text: `📎 ${semDoc.length} lançamento(s) com NF pendente — ${fmtMoney(semDoc.reduce((a, r) => a + r.value, 0))} (atenção contábil)` })
    return out
  }, [receivable, payable])

  // ── Caixa atual (base pra ICC e Saldo Projetado) ─────────────────────
  const caixaAtual = useMemo(() => {
    const totalRecebido = receivable.filter(r => r.status === 'Recebido').reduce((a, r) => a + r.value, 0)
    const totalPago = payable.filter(r => r.status === 'Pago').reduce((a, r) => a + r.value, 0)
    return totalRecebido - totalPago
  }, [receivable, payable])

  // ── KPI 1: ICC ───────────────────────────────────────────────────────
  const icc = useMemo(() => {
    const hoje = new Date()
    const tresMesesAtras = new Date(hoje.getFullYear(), hoje.getMonth() - 3, hoje.getDate())
    const pagosRecentes = payable.filter(r => {
      if (r.status !== 'Pago') return false
      const ref = r.data?.data_pagamento || r.due || r.created || hoje.toISOString().split('T')[0]
      const d = new Date(ref + 'T12:00:00')
      return d >= tresMesesAtras
    })
    const despUltimos3 = pagosRecentes.reduce((a, r) => a + r.value, 0)
    // Divide pelo nº real de meses cobertos (1 a 3), não fixo em 3: empresa
    // nova com 1 mês de operação teria o burn subestimado em 3× e o semáforo
    // mostraria verde perigosamente.
    let mesesCobertos = 3
    const refsPagos = pagosRecentes
      .map(r => r.data?.data_pagamento || r.due || r.created)
      .filter(Boolean)
      .sort()
    if (refsPagos.length) {
      const primeira = new Date(refsPagos[0] + 'T12:00:00')
      mesesCobertos = (hoje.getFullYear() - primeira.getFullYear()) * 12 + (hoje.getMonth() - primeira.getMonth()) + 1
      mesesCobertos = Math.min(3, Math.max(1, mesesCobertos))
    }
    const fixaMensal = despUltimos3 / mesesCobertos
    if (caixaAtual < 0) return { texto: 'Negativo', cor: 'var(--red)', sub: `caixa em déficit · ${fmtMoney(caixaAtual)}` }
    if (fixaMensal <= 0) return { texto: '—', cor: 'var(--text-mid)', sub: 'sem despesas pagas pra calcular' }
    const meses = caixaAtual / fixaMensal
    if (meses > 24) return { texto: '24+ meses', cor: 'var(--green)', sub: `caixa ${fmtMoney(caixaAtual)} ÷ ${fmtMoney(fixaMensal)}/mês` }
    const cor = meses >= 6 ? 'var(--green)' : (meses >= 3 ? 'var(--orange)' : 'var(--red)')
    return { texto: `${meses.toFixed(1)} meses`, cor, sub: `caixa ${fmtMoney(caixaAtual)} ÷ ${fmtMoney(fixaMensal)}/mês` }
  }, [payable, caixaAtual])

  // ── KPI 2: Saldo Projetado 30/60/90d ─────────────────────────────────
  const saldoProjetado = useMemo(() => {
    const hoje = new Date()
    function projetar(dias) {
      const limite = new Date(hoje); limite.setDate(limite.getDate() + dias)
      const limISO = limite.toISOString().slice(0, 10)
      const hojeISO = today()
      const aReceber = receivable
        .filter(r => r.status !== 'Recebido' && r.due && r.due >= hojeISO && r.due <= limISO)
        .reduce((a, r) => a + r.value, 0)
      const aPagar = payable
        .filter(r => r.status !== 'Pago' && r.due && r.due >= hojeISO && r.due <= limISO)
        .reduce((a, r) => a + r.value, 0)
      return caixaAtual + aReceber - aPagar
    }
    return { d30: projetar(30), d60: projetar(60), d90: projetar(90) }
  }, [receivable, payable, caixaAtual])

  // ── KPI 3: Faturamento Mensal (regime competência) ──────────────────
  const faturamento = useMemo(() => {
    const hoje = new Date()
    function periodoMes(deltaMeses) {
      // delta=0 → mês atual, delta=-1 → mês passado, etc
      const m = hoje.getMonth() + deltaMeses
      const y = hoje.getFullYear()
      const ini = new Date(y, m, 1)
      const fim = new Date(y, m + 1, 0)
      return { ini: ini.toISOString().slice(0, 10), fim: fim.toISOString().slice(0, 10), label: ini.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '').toLowerCase() }
    }
    function fatNo(periodo) {
      return receivable.filter(r => {
        if (r.status === 'Provisão') return false // provisão não é faturamento até a NF ser emitida
        const ref = r.data?.data_competencia || r.due
        return ref && ref >= periodo.ini && ref <= periodo.fim
      }).reduce((a, r) => a + r.value, 0)
    }
    const atual = periodoMes(0)
    const passado = periodoMes(-1)
    const valAtual = fatNo(atual)
    const valPassado = fatNo(passado)
    const variacao = valPassado > 0 ? ((valAtual - valPassado) / valPassado) * 100 : null
    const ultimos6 = []
    for (let i = 5; i >= 0; i--) {
      const p = periodoMes(-i)
      ultimos6.push({ label: p.label.charAt(0).toUpperCase() + p.label.slice(1), valor: fatNo(p) })
    }
    return { valAtual, valPassado, variacao, ultimos6, labelMesAtual: atual.label }
  }, [receivable])

  // ── Acumulado do ano (competência): faturamento e despesas até hoje ──
  const acumAno = useMemo(() => {
    const y = new Date().getFullYear()
    const mAtual = new Date().getMonth()
    const noAnoAteHoje = ref => ref && ref.startsWith(String(y)) && (parseInt(ref.substring(5, 7), 10) - 1) <= mAtual
    const fat = receivable
      .filter(r => r.status !== 'Provisão' && noAnoAteHoje(r.data?.data_competencia || r.due))
      .reduce((a, r) => a + r.value, 0)
    const desp = payable
      .filter(r => r.status !== 'Provisão' && noAnoAteHoje(r.data?.data_competencia || r.due))
      .reduce((a, r) => a + r.value, 0)
    return { fat, desp, resultado: fat - desp }
  }, [receivable, payable])

  // ── Indicadores de mercado ───────────────────────────────────────────
  const anoAtual = String(new Date().getFullYear())

  // Burn mensal (mesma regra do ICC): gasto pago médio dos últimos meses.
  const burnMensal = useMemo(() => {
    const hoje = new Date()
    const tresMesesAtras = new Date(hoje.getFullYear(), hoje.getMonth() - 3, hoje.getDate())
    const pagos = payable.filter(r => {
      if (r.status !== 'Pago') return false
      const ref = r.data?.data_pagamento || r.due || r.created || today()
      return new Date(ref + 'T12:00:00') >= tresMesesAtras
    })
    const total = pagos.reduce((a, r) => a + r.value, 0)
    let meses = 3
    const refs = pagos.map(r => r.data?.data_pagamento || r.due || r.created).filter(Boolean).sort()
    if (refs.length) {
      const primeira = new Date(refs[0] + 'T12:00:00')
      meses = Math.min(3, Math.max(1, (hoje.getFullYear() - primeira.getFullYear()) * 12 + (hoje.getMonth() - primeira.getMonth()) + 1))
    }
    return total / meses
  }, [payable])

  const resumoCaixa = useMemo(() => {
    const aReceber = receivable.filter(r => r.status !== 'Recebido' && r.status !== 'Provisão').reduce((a, r) => a + r.value, 0)
    const aPagar = payable.filter(r => r.status !== 'Pago' && r.status !== 'Provisão').reduce((a, r) => a + r.value, 0)
    return { aReceber, aPagar, resultado: caixaAtual + aReceber - aPagar }
  }, [receivable, payable, caixaAtual])

  const metaICC = useMemo(() => {
    const alvo = (Number(metaMeses) || 0) * burnMensal
    return { alvo, gap: alvo - caixaAtual, mesesAtuais: burnMensal > 0 ? caixaAtual / burnMensal : null }
  }, [metaMeses, burnMensal, caixaAtual])

  const mrr = useMemo(() => calcMRR(recurringMasters), [recurringMasters])
  const despRec = useMemo(() => calcDespesaRecorrente(recurringMasters), [recurringMasters])
  const inadimplencia = useMemo(() => calcInadimplencia(receivable), [receivable])
  const margem = useMemo(() => calcMargem(receivable, payable, plano, anoAtual), [receivable, payable, plano, anoAtual])
  const liquidez = useMemo(() => calcLiquidez(receivable, payable, 30), [receivable, payable])
  const concentracao = useMemo(() => calcConcentracao(receivable), [receivable])

  // ── Cockpit de decisão (cards do Início) ─────────────────────────────
  const despesaMes = useMemo(() => {
    const hoje = new Date()
    return payable
      .filter(r => r.status !== 'Pago' && r.status !== 'Provisão' && inMonth(r.due, hoje.getFullYear(), hoje.getMonth()))
      .reduce((a, r) => a + r.value, 0)
  }, [payable])
  const custoVariavel = Math.max(0, burnMensal - despRec)
  const necessidadeReceita = Math.max(0, despesaMes - faturamento.valAtual)

  async function salvarMeta(nova) {
    const val = Math.max(0, Number(nova) || 0)
    setMetaMeses(val)
    if (!user) return
    const data = { ...(painelCfg?.data || {}), meta_icc_meses: val }
    if (painelCfg?.id) {
      await supabase.from('painel_config').update({ data }).eq('id', painelCfg.id)
    } else {
      const { data: ins } = await supabase.from('painel_config').insert({ user_id: user.id, data }).select('*').single()
      if (ins) setPainelCfg(ins)
    }
  }

  // ── KPI 4: Próximas a Pagar (top 5) ─────────────────────────────────
  const proximasPagar = useMemo(() => {
    const hojeISO = today()
    return payable
      .filter(r => r.status !== 'Pago' && r.due && r.due >= hojeISO)
      .sort((a, b) => a.due.localeCompare(b.due))
      .slice(0, 5)
  }, [payable])

  // ── Série mensal (jan-dez do ano corrente) — pra chart + tabela ──────
  const dadosMensais = useMemo(() => {
    const hoje = new Date()
    const ano = hoje.getFullYear()
    const mesAtual = hoje.getMonth()
    const labels = monthLabels(ano)
    let acum = 0
    return labels.map((label, m) => {
      const futuro = m > mesAtual
      const atual = m === mesAtual
      let entradas, saidas
      if (futuro) {
        entradas = receivable.filter(r => r.status !== 'Recebido' && inMonth(r.due, ano, m)).reduce((a, r) => a + r.value, 0)
        saidas = payable.filter(r => r.status !== 'Pago' && inMonth(r.due, ano, m)).reduce((a, r) => a + r.value, 0)
      } else {
        entradas = receivable.filter(r => r.status === 'Recebido' && inMonth(r.data?.data_pagamento || r.due || r.created, ano, m)).reduce((a, r) => a + r.value, 0)
        saidas = payable.filter(r => r.status === 'Pago' && inMonth(r.data?.data_pagamento || r.due || r.created, ano, m)).reduce((a, r) => a + r.value, 0)
      }
      const saldoMes = entradas - saidas
      acum += saldoMes
      return { label, mes: m, futuro, atual, entradas, saidas, saldoMes, saldoAcum: acum }
    })
  }, [receivable, payable])

  // ── Chart principal (Evolução do Caixa) ──────────────────────────────
  useEffect(() => {
    if (!canvasRef.current || dadosMensais.length === 0) return
    if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null }
    const labels = dadosMensais.map(d => d.label.charAt(0).toUpperCase() + d.label.slice(1))
    const corEntrada = d => d.futuro ? 'rgba(39,174,96,0.35)' : 'rgba(39,174,96,0.85)'
    const corSaida = d => d.futuro ? 'rgba(204,145,94,0.35)' : 'rgba(204,145,94,0.85)'
    chartRef.current = new Chart(canvasRef.current, {
      data: {
        labels,
        datasets: [
          { type: 'bar', label: 'Entradas', data: dadosMensais.map(d => d.entradas), backgroundColor: dadosMensais.map(corEntrada), borderColor: 'rgba(39,174,96,1)', borderWidth: 1, order: 2 },
          { type: 'bar', label: 'Saídas', data: dadosMensais.map(d => d.saidas), backgroundColor: dadosMensais.map(corSaida), borderColor: 'rgba(204,145,94,1)', borderWidth: 1, order: 2 },
          { type: 'line', label: 'Saldo Acumulado', data: dadosMensais.map(d => d.saldoAcum), borderColor: 'rgba(0,32,62,1)', backgroundColor: 'rgba(0,32,62,0.05)', borderWidth: 2.5, tension: 0.3, pointRadius: 4, pointBackgroundColor: dadosMensais.map(d => d.futuro ? 'rgba(0,32,62,0.4)' : 'rgba(0,32,62,1)'), pointBorderColor: 'rgba(0,32,62,1)', pointBorderWidth: 1.5, fill: false, order: 1, segment: { borderDash: ctx => { const i = ctx.p1DataIndex; return (dadosMensais[i] && dadosMensais[i].futuro) ? [6, 4] : undefined } } },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: R$ ${ctx.parsed.y.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` } } },
        scales: { y: { ticks: { callback: v => 'R$ ' + (v / 1000).toFixed(1) + 'k', font: { size: 10 } }, grid: { color: 'rgba(0,0,0,0.05)' } }, x: { ticks: { font: { size: 11 } }, grid: { display: false } } },
      },
    })
    return () => { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null } }
  }, [dadosMensais])

  // ── Sparkline do faturamento (KPI 3) ─────────────────────────────────
  useEffect(() => {
    if (!sparkRef.current || faturamento.ultimos6.length === 0) return
    if (sparkChartRef.current) { sparkChartRef.current.destroy(); sparkChartRef.current = null }
    sparkChartRef.current = new Chart(sparkRef.current, {
      type: 'line',
      data: {
        labels: faturamento.ultimos6.map(p => p.label),
        datasets: [{
          data: faturamento.ultimos6.map(p => p.valor),
          borderColor: 'rgba(204,145,94,1)',
          backgroundColor: 'rgba(204,145,94,0.10)',
          borderWidth: 2, tension: 0.35, fill: true,
          pointRadius: 0, pointHoverRadius: 3,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            displayColors: false,
            callbacks: { label: ctx => fmtMoney(ctx.parsed.y), title: ctx => ctx[0].label },
          },
        },
        scales: { x: { display: false }, y: { display: false } },
        elements: { line: { borderJoinStyle: 'round' } },
      },
    })
    return () => { if (sparkChartRef.current) { sparkChartRef.current.destroy(); sparkChartRef.current = null } }
  }, [faturamento])

  if (loading) return (
    <AppLayout title="Início">
      <div style={emptyState}>Carregando…</div>
    </AppLayout>
  )

  return (
    <AppLayout title="Início">
      {alerts.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          {alerts.map((a, i) => (
            <div
              key={i}
              onClick={() => navigate(a.to)}
              role="button" tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter') navigate(a.to) }}
              style={{ ...(a.kind === 'danger' ? alertDanger : alertWarning), cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}
            >
              <span>{a.text}</span>
              <span style={{ opacity: 0.7, fontWeight: 700, whiteSpace: 'nowrap' }}>ver →</span>
            </div>
          ))}
        </div>
      )}

      {/* Resumo de caixa — linguagem natural */}
      <div style={narrativaCard}>
        <div style={narrativaLabel}>Sua situação de caixa</div>
        <div style={{ fontSize: 16, lineHeight: 1.65, color: '#fff' }}>
          Você tem <strong>{fmtMoney(caixaAtual)}</strong> em caixa,{' '}
          <strong style={{ color: 'var(--gold-light)' }}>{fmtMoney(resumoCaixa.aReceber)}</strong> a receber e{' '}
          <strong style={{ color: 'var(--gold-light)' }}>{fmtMoney(resumoCaixa.aPagar)}</strong> a pagar.{' '}
          {resumoCaixa.resultado >= 0
            ? <>Sobram <strong style={{ color: '#7fe0a8' }}>{fmtMoney(resumoCaixa.resultado)}</strong> para aplicar. 💰</>
            : <>Faltam <strong style={{ color: '#ff9b8f' }}>{fmtMoney(Math.abs(resumoCaixa.resultado))}</strong> para não ficar no negativo. ⚠️</>}
        </div>
      </div>

      {/* Cockpit de decisão — o que você olha primeiro, todo dia */}
      <div style={indGrid}>
        <IndCard label="Saldo na conta" valor={fmtMoney(caixaAtual)} sub="disponível hoje" />
        <IndCard label="Projeção de despesa (mês)" valor={fmtMoney(despesaMes)} sub="a pagar este mês" />

        <div style={{ ...indCard, ...(necessidadeReceita > 0 ? { borderTop: '3px solid var(--gold-dark)' } : {}) }}>
          <div style={indLabel}>Necessidade de receita</div>
          <div style={{ ...indValor, color: necessidadeReceita > 0 ? 'var(--gold-dark)' : 'var(--green)' }}>{fmtMoney(necessidadeReceita)}</div>
          <div style={indSub}>{necessidadeReceita > 0 ? 'falta faturar pra cobrir o mês' : 'mês coberto ✓'}</div>
          {despesaMes > 0 && <div style={barBox}><i style={{ ...barFill, width: `${Math.min(100, (faturamento.valAtual / despesaMes) * 100)}%` }} /></div>}
        </div>

        <div style={indCard}>
          <div style={indLabel}>ICC · meses de caixa</div>
          <div style={indValor}>{metaICC.mesesAtuais != null ? metaICC.mesesAtuais.toFixed(1) : '—'}<span style={{ fontSize: 13, color: 'var(--text-mid)', fontWeight: 600 }}> de {metaMeses}</span></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '2px 0 5px' }}>
            <span style={{ fontSize: 11, color: 'var(--text-mid)' }}>meta:</span>
            <input type="number" min="0" value={metaMeses} onChange={e => salvarMeta(e.target.value)} style={metaInput} aria-label="Meta de meses de caixa" />
            <span style={{ fontSize: 11, color: 'var(--text-mid)' }}>meses</span>
          </div>
          <div style={{ ...indSub, color: metaICC.gap > 0 ? 'var(--gold-dark)' : 'var(--green)', fontWeight: 700 }}>{metaICC.gap > 0 ? `faltam ${fmtMoney(metaICC.gap)} pra meta` : 'meta atingida! ✓'}</div>
        </div>

        <IndCard label="Custo fixo / mês" valor={fmtMoney(despRec)} sub="recorrentes · assinaturas, salários…" />
        <IndCard label="Custo variável / mês" valor={fmtMoney(custoVariavel)} sub="média — oscila com o movimento" />
      </div>

      {/* 4 KPIs enxutos */}
      <div style={kpiGrid}>
        {/* KPI 1: ICC */}
        <div style={{ ...kpiCard, borderTop: `3px solid ${icc.cor}` }}>
          <div style={kpiLabel}>ICC · Cobertura de Caixa</div>
          <div style={{ ...kpiBigVal, color: icc.cor }}>{icc.texto}</div>
          <div style={kpiSub}>{icc.sub}</div>
        </div>

        {/* KPI 2: Saldo Projetado 30/60/90 (com âncora "hoje") */}
        <div style={{ ...kpiCard, borderTop: '3px solid var(--navy)' }}>
          <div style={kpiLabel}>Saldo Projetado</div>
          <div style={{ fontSize: 11, color: 'var(--text-mid)', marginBottom: 9 }}>
            hoje <strong style={{ color: caixaAtual >= 0 ? 'var(--green)' : 'var(--red)', fontSize: 14 }}>{fmtMoney(caixaAtual)}</strong>
          </div>
          <div style={projGrid}>
            <ProjItem label="30d" valor={saldoProjetado.d30} />
            <ProjItem label="60d" valor={saldoProjetado.d60} />
            <ProjItem label="90d" valor={saldoProjetado.d90} />
          </div>
          <div style={{ ...kpiSub, marginTop: 9 }}>caixa de hoje + a receber − a pagar</div>
        </div>

        {/* KPI 3: Faturamento & Despesas (mês + acumulado do ano) */}
        <div style={{ ...kpiCard, borderTop: '3px solid var(--gold)' }}>
          <div style={kpiLabel}>Faturamento — {faturamento.labelMesAtual}</div>
          <div style={{ ...kpiBigVal, color: 'var(--navy)' }}>{fmtMoney(faturamento.valAtual)}</div>
          {faturamento.variacao !== null && (
            <div style={{ fontSize: 11, color: faturamento.variacao >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600, marginTop: 3 }}>
              {faturamento.variacao >= 0 ? '↑' : '↓'} {Math.abs(faturamento.variacao).toFixed(1)}% vs mês passado
            </div>
          )}
          <div style={acumRow}>
            <div style={acumItem}><span style={acumK}>Faturado {anoAtual}</span><span style={{ ...acumV, color: 'var(--green)' }}>{fmtMoney(acumAno.fat)}</span></div>
            <div style={acumItem}><span style={acumK}>Despesas {anoAtual}</span><span style={{ ...acumV, color: 'var(--red)' }}>{fmtMoney(acumAno.desp)}</span></div>
            <div style={acumItem}><span style={acumK}>Resultado</span><span style={{ ...acumV, color: acumAno.resultado >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtMoney(acumAno.resultado)}</span></div>
          </div>
          <div style={{ height: 38, marginTop: 8, position: 'relative' }}>
            <canvas ref={sparkRef} />
          </div>
        </div>

        {/* KPI 4: Próximas a Pagar (top 5) */}
        <div
          style={{ ...kpiCard, borderTop: '3px solid var(--red)', cursor: 'pointer' }}
          onClick={() => navigate('/pagar')}
          role="button" tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter') navigate('/pagar') }}
        >
          <div style={kpiLabel}>Próximas a Pagar</div>
          {proximasPagar.length === 0 ? (
            <div style={{ ...kpiSub, fontStyle: 'italic', marginTop: 8 }}>Nenhuma conta pendente.</div>
          ) : (
            <div style={proxList}>
              {proximasPagar.map(p => (
                <div key={p.id} style={proxItem}>
                  <div style={{ flex: 1, fontSize: 11, fontWeight: 500, color: 'var(--navy)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.data?.supplier || p.desc || p.codigo}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-mid)', textAlign: 'right' }}>
                    <div style={{ fontWeight: 600, color: isOverdue(p.due) ? 'var(--red)' : 'var(--navy)' }}>{fmtMoney(p.value)}</div>
                    <div>{p.due ? p.due.split('-').reverse().join('/') : '—'}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Mais indicadores — análise */}
      <div style={maisLabel}>Mais indicadores</div>
      <div style={indGrid}>
        <IndCard label="MRR · Receita recorrente/mês" valor={fmtMoney(mrr)} sub={despRec > 0 ? `− ${fmtMoney(despRec)} de despesa recorrente` : 'mensalidades ativas'} />
        <IndCard label="Inadimplência (a receber vencido)" valor={fmtMoney(inadimplencia.vencido)} sub={`${(inadimplencia.pct * 100).toFixed(0)}% do que está em aberto`} alerta={inadimplencia.vencido > 0} />
        <IndCard label={`Margem líquida · ${anoAtual}`} valor={margem.pct == null ? '—' : `${(margem.pct * 100).toFixed(1)}%`} sub={margem.pct == null ? 'sem receita ainda' : `${fmtMoney(margem.liquido)} de lucro`} />
        <IndCard label="Liquidez 30 dias" valor={liquidez.indice == null ? '—' : `${liquidez.indice.toFixed(2)}×`} sub={`${fmtMoney(liquidez.aReceber)} ÷ ${fmtMoney(liquidez.aPagar)}`} />
        <IndCard label="Maior cliente (concentração)" valor={concentracao.pct > 0 ? `${(concentracao.pct * 100).toFixed(0)}%` : '—'} sub={concentracao.maiorNome !== '—' ? concentracao.maiorNome : `${concentracao.nClientes} cliente(s)`} alerta={concentracao.pct > 0.5} />
      </div>

      {/* Gráfico Evolução */}
      <div style={chartCard}>
        <div style={chartHeader}>
          <div>
            <div style={chartTitle}>Evolução do Caixa</div>
            <div style={chartSubtitle}>Janeiro a dezembro do ano corrente · barras saturadas = realizado · claras = projetado</div>
          </div>
          <div style={legendWrap}>
            <span style={legendItem}><span style={{ ...swatch, background: 'rgba(39,174,96,0.85)' }} />Entradas</span>
            <span style={legendItem}><span style={{ ...swatch, background: 'rgba(204,145,94,0.85)' }} />Saídas</span>
            <span style={legendItem}><span style={{ ...swatchLine, background: 'var(--navy)' }} />Saldo Acumulado</span>
          </div>
        </div>
        <div style={{ height: 280, position: 'relative' }}>
          <canvas ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }} />
        </div>
      </div>

      {/* Tabela mensal */}
      <div style={tableCard}>
        <div style={tableHeader}>
          <div style={chartTitle}>Mês a Mês</div>
          <div style={chartSubtitle}>Entradas, saídas e saldo mês a mês</div>
        </div>
        <div style={{ overflowX: 'visible' }}>
          <table style={tbl}>
            <thead>
              <tr style={{ background: 'var(--navy)', color: '#fff' }}>
                <th style={{ ...thBase, textAlign: 'left' }}>Mês</th>
                <th style={{ ...thBase, textAlign: 'right' }}>Entradas</th>
                <th style={{ ...thBase, textAlign: 'right' }}>Saídas</th>
                <th style={{ ...thBase, textAlign: 'right' }}>Saldo do Mês</th>
                <th style={{ ...thBase, textAlign: 'right' }}>Saldo Acumulado</th>
                <th style={{ ...thBase, textAlign: 'center' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {dadosMensais.map(d => {
                const labelPretty = d.label.charAt(0).toUpperCase() + d.label.slice(1)
                const corSaldo = d.saldoMes >= 0 ? 'var(--green)' : 'var(--red)'
                const corAcum = d.saldoAcum >= 0 ? 'var(--green)' : 'var(--red)'
                let badge
                if (d.futuro) badge = <Badge bg="rgba(204,145,94,0.15)" color="var(--gold-dark)">Projetado</Badge>
                else if (d.atual) badge = <Badge bg="rgba(0,32,62,0.10)" color="var(--navy)">Em curso</Badge>
                else badge = <Badge bg="rgba(39,174,96,0.12)" color="var(--green)">Realizado</Badge>
                return (
                  <tr key={d.mes} style={{ borderBottom: '1px solid var(--cream-dark)', background: d.atual ? 'rgba(204,145,94,0.04)' : 'transparent' }}>
                    <td style={{ ...td, fontWeight: 600, color: 'var(--navy)' }}>{labelPretty}</td>
                    <td style={{ ...td, textAlign: 'right', color: d.entradas > 0 ? 'var(--green)' : 'var(--text-mid)' }}>{fmtMoney(d.entradas)}</td>
                    <td style={{ ...td, textAlign: 'right', color: d.saidas > 0 ? 'var(--red)' : 'var(--text-mid)' }}>{d.saidas > 0 ? '(' : ''}{fmtMoney(d.saidas)}{d.saidas > 0 ? ')' : ''}</td>
                    <td style={{ ...td, textAlign: 'right', color: corSaldo, fontWeight: 600 }}>{fmtMoney(d.saldoMes)}</td>
                    <td style={{ ...td, textAlign: 'right', color: corAcum, fontWeight: 700 }}>{fmtMoney(d.saldoAcum)}</td>
                    <td style={{ ...td, textAlign: 'center' }}>{badge}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </AppLayout>
  )
}

function ProjItem({ label, valor }) {
  const cor = valor >= 0 ? 'var(--green)' : 'var(--red)'
  return (
    <div style={{ flex: 1, textAlign: 'center' }}>
      <div style={{ fontSize: 9, color: 'var(--text-mid)', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: cor, marginTop: 4 }}>{fmtMoney(valor)}</div>
    </div>
  )
}

function Badge({ bg, color, children }) {
  return <span style={{ background: bg, color, padding: '3px 9px', borderRadius: 10, fontSize: 9, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>{children}</span>
}

// ─── styles ──────────────────────────────────────────────────────────────────
function IndCard({ label, valor, sub, alerta }) {
  return (
    <div style={{ ...indCard, ...(alerta ? { borderTop: '3px solid var(--red)' } : {}) }}>
      <div style={indLabel}>{label}</div>
      <div style={indValor}>{valor}</div>
      {sub && <div style={indSub}>{sub}</div>}
    </div>
  )
}

const narrativaCard = { background: 'linear-gradient(135deg, #00203E 0%, #1D3B5C 100%)', borderRadius: 14, padding: '22px 26px', marginBottom: 18, boxShadow: 'var(--shadow)' }
const narrativaLabel = { fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--gold-light)', marginBottom: 10 }
const indGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 24 }
const indCard = { background: 'var(--white)', borderRadius: 12, padding: 16, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)' }
const indLabel = { fontSize: 9, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-mid)', marginBottom: 6 }
const indValor = { fontSize: 22, fontWeight: 700, color: 'var(--navy)', fontFamily: 'var(--body)' }
const indSub = { fontSize: 11, color: 'var(--text-mid)', marginTop: 3 }
const metaInput = { width: 56, padding: '5px 8px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 15, fontWeight: 700, color: 'var(--navy)', textAlign: 'center' }
const barBox = { height: 6, borderRadius: 999, background: 'var(--cream)', marginTop: 9, overflow: 'hidden' }
const barFill = { display: 'block', height: '100%', borderRadius: 999, background: 'linear-gradient(90deg, var(--gold), var(--gold-dark))' }
const maisLabel = { fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-mid)', margin: '4px 2px 10px' }
const emptyState = { padding: '60px 24px', textAlign: 'center', fontFamily: 'var(--body)', color: 'var(--text-mid)', fontSize: 13 }
const kpiGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 14, marginBottom: 24 }
const kpiCard = { background: 'var(--white)', borderRadius: 12, padding: 16, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)', display: 'flex', flexDirection: 'column' }
const kpiLabel = { fontSize: 10, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--text-mid)', marginBottom: 7, fontFamily: 'var(--body)' }
const kpiBigVal = { fontSize: 24, fontWeight: 700, lineHeight: 1, fontFamily: 'var(--body)' }
const kpiSub = { fontSize: 11, color: 'var(--text-mid)', marginTop: 6 }
const projGrid = { display: 'flex', gap: 4 }
const acumRow = { display: 'flex', flexDirection: 'column', gap: 3, marginTop: 10, paddingTop: 9, borderTop: '1px solid var(--cream-dark)' }
const acumItem = { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }
const acumK = { fontSize: 11, color: 'var(--text-mid)' }
const acumV = { fontSize: 12, fontWeight: 700, fontFamily: 'var(--body)' }
const proxList = { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }
const proxItem = { display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderRadius: 4, background: 'rgba(0,32,62,0.03)' }

const chartCard = { background: 'var(--white)', borderRadius: 12, padding: 24, marginBottom: 24, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)' }
const chartHeader = { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, gap: 16, flexWrap: 'wrap' }
const chartTitle = { fontSize: 14, fontWeight: 600, color: 'var(--navy)', fontFamily: 'var(--body)' }
const chartSubtitle = { fontSize: 11, color: 'var(--text-mid)', marginTop: 2 }
const legendWrap = { display: 'flex', gap: 16, fontSize: 11, color: 'var(--text-mid)', flexWrap: 'wrap' }
const legendItem = { display: 'inline-flex', alignItems: 'center', gap: 5 }
const swatch = { display: 'inline-block', width: 12, height: 12, borderRadius: 2 }
const swatchLine = { display: 'inline-block', width: 14, height: 3 }

const tableCard = { background: 'var(--white)', borderRadius: 12, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)', overflow: 'clip' }
const tableHeader = { padding: '18px 24px 14px', borderBottom: '1px solid var(--cream-dark)' }
const tbl = { width: '100%', fontSize: 12, borderCollapse: 'collapse', fontFamily: 'var(--body)' }
const thBase = { background: 'var(--navy)', color: '#fff', padding: '10px 16px', fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }
const td = { padding: '10px 16px', verticalAlign: 'middle' }
const alertDanger = { background: 'rgba(231,76,60,0.10)', borderLeft: '3px solid var(--red)', color: 'var(--red)', padding: '10px 14px', borderRadius: 6, fontSize: 12, fontFamily: 'var(--body)', marginBottom: 8, fontWeight: 600 }
const alertWarning = { background: 'rgba(204,145,94,0.10)', borderLeft: '3px solid var(--gold)', color: 'var(--navy)', padding: '10px 14px', borderRadius: 6, fontSize: 12, fontFamily: 'var(--body)', marginBottom: 8, fontWeight: 600 }
