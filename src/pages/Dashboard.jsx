import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Chart } from 'chart.js/auto'
import AppLayout from '../components/AppLayout'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import {
  fmtMoney, flatten, isOverdue, getDocStatus, inMonth, monthLabels, today,
  ehOperacional,
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
  const [contas, setContas] = useState([]) // saldo inicial das contas ancora o caixa
  const [extratos, setExtratos] = useState([])        // linhas leves: conta, status, tipo, valor, data
  const [saldosBanco, setSaldosBanco] = useState({})  // conta_id → { saldo, em } (último OFX importado)
  const [transferencias, setTransferencias] = useState([])
  const [fechamentos, setFechamentos] = useState([])
  const [nfsCaixa, setNfsCaixa] = useState(0)
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
      supabase.from('payable').select('id,codigo,data,created_at,updated_at,anexo_path,cartao_id'),
      supabase.from('recurring_masters').select('*'),
      supabase.from('painel_config').select('*').limit(1),
      fetchPlanoContas(),
      supabase.from('contas_bancarias').select('id,data'),
      supabase.from('transacoes_extrato').select('conta_id,status,tipo:data->>tipo,valor:data->>valor,dt:data->>data'),
      supabase.from('importacoes').select('metadata,created_at').eq('tipo', 'ofx_extrato').order('created_at', { ascending: false }),
      supabase.from('transferencias').select('de_conta_id,para_conta_id,valor,data'),
      supabase.from('fechamentos').select('competencia,status'),
      supabase.from('nf_pending').select('id', { count: 'exact', head: true }).eq('status', 'pendente'),
    ]).then(([rRec, rPay, rRm, rCfg, planoData, rCt, rEx, rImp, rTr, rFe, rNf]) => {
      if (cancelled) return
      setExtratos(rEx.data || [])
      // Saldo no banco = BALAMT do último OFX de cada conta (guardado em importacoes.metadata.saldo_final)
      const sb = {}
      for (const imp of rImp.data || []) {
        const cid = imp.metadata?.conta_id
        if (cid && !sb[cid] && imp.metadata?.saldo_final != null) sb[cid] = { saldo: Number(imp.metadata.saldo_final), em: imp.created_at }
      }
      setSaldosBanco(sb)
      setTransferencias(rTr.data || [])
      setFechamentos(rFe.data || [])
      setNfsCaixa(rNf.count || 0)
      setReceivable((rRec.data || []).map(flatten))
      setPayable((rPay.data || []).map(r => ({ ...flatten(r), cartao_id: r.cartao_id })))
      setRecurringMasters(rRm.data || [])
      setContas((rCt.data || []).filter(c => c.data?.ativo !== false))
      const cfg = rCfg.data?.[0] || null
      setPainelCfg(cfg)
      if (cfg?.data?.meta_icc_meses != null) setMetaMeses(Number(cfg.data.meta_icc_meses))
      setPlano(planoData || [])
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [user])

  // ── Alertas ──────────────────────────────────────────────────────────
  // ── Contas hoje: saldo no banco × saldo no sistema, e o que falta fazer ──
  // (bench: QuickBooks/Xero/Conta Azul mostram por conta "banco × sistema" e a fila.)
  const painelContas = useMemo(() => {
    const porConta = {}
    for (const e of extratos) {
      const g = porConta[e.conta_id] || (porConta[e.conta_id] = { pend: 0, inConc: 0, outConc: 0, ultimo: '' })
      if (e.status === 'pendente') g.pend++
      if (e.status === 'conciliado') { if (e.tipo === 'entrada') g.inConc += Number(e.valor || 0); else g.outConc += Number(e.valor || 0) }
      if ((e.dt || '') > g.ultimo) g.ultimo = e.dt
    }
    return contas.map(c => {
      const g = porConta[c.id] || { pend: 0, inConc: 0, outConc: 0, ultimo: '' }
      const sIni = Number(c.data?.saldo_inicial) || 0
      const cartao = c.data?.tipo === 'cartao'
      let sistema
      if (cartao) {
        const compras = payable.filter(p => p.cartao_id === c.id).filter(p => p.status === 'Pago').reduce((a, p) => a + Number(p.value || 0), 0)
        const recebidas = transferencias.filter(t => t.para_conta_id === c.id).reduce((a, t) => a + Number(t.valor || 0), 0)
        const enviadas = transferencias.filter(t => t.de_conta_id === c.id).reduce((a, t) => a + Number(t.valor || 0), 0)
        sistema = sIni - compras + recebidas - enviadas
      } else {
        sistema = sIni + g.inConc - g.outConc
      }
      const banco = saldosBanco[c.id] || null
      return { id: c.id, nome: c.data?.nome || '(sem nome)', cartao, sistema, banco: banco?.saldo ?? null, bancoEm: banco?.em || null, pendentes: g.pend, ultimo: g.ultimo }
    })
  }, [contas, extratos, saldosBanco, transferencias, payable])

  const paraFazer = useMemo(() => {
    const aEscriturar = [...receivable, ...payable].filter(r => r.status !== 'Provisão' && r.data?.escriturado !== true).length
    const aConciliar = extratos.filter(e => e.status === 'pendente').length
    const fechados = fechamentos.filter(f => f.status === 'fechado').map(f => f.competencia).sort()
    const ultimoFechado = fechados[fechados.length - 1] || null
    const agora = new Date()
    const mesAnterior = new Date(agora.getFullYear(), agora.getMonth() - 1, 1)
    const mesAnteriorISO = `${mesAnterior.getFullYear()}-${String(mesAnterior.getMonth() + 1).padStart(2, '0')}`
    let aFechar = null
    if (ultimoFechado) {
      const [fy, fm] = ultimoFechado.split('-').map(Number)
      const prox = new Date(fy, fm, 1) // mês seguinte ao último fechado
      const proxISO = `${prox.getFullYear()}-${String(prox.getMonth() + 1).padStart(2, '0')}`
      if (proxISO <= mesAnteriorISO) aFechar = proxISO
    } else aFechar = mesAnteriorISO
    return { aEscriturar, aConciliar, nfsCaixa, ultimoFechado, aFechar }
  }, [receivable, payable, extratos, fechamentos, nfsCaixa])

  const alerts = useMemo(() => {
    const out = []
    // Mesma regra do Receber/Pagar (ehOperacional): sem Provisão, sem empréstimo, sem
    // crédito de fatura. Antes o Início dizia "3 vencidos" e a lista mostrava 2.
    const overdueRec = receivable.filter(r => ehOperacional(r) && r.status !== 'Recebido' && isOverdue(r.due))
    const overduePay = payable.filter(r => ehOperacional(r) && r.status !== 'Pago' && isOverdue(r.due))
    if (overdueRec.length) out.push({ kind: 'danger', to: '/receber?filtro=vencidos', text: `⚠️ ${overdueRec.length} recebível(is) vencido(s) — ${fmtMoney(overdueRec.reduce((a, r) => a + r.value, 0))}` })
    if (overduePay.length) out.push({ kind: 'danger', to: '/pagar?filtro=vencidos', text: `🔴 ${overduePay.length} pagamento(s) em atraso — ${fmtMoney(overduePay.reduce((a, r) => a + r.value, 0))}` })
    // NF pendente: um alerta por tela (o link levava a uma só e o número não batia).
    const semDocRec = receivable.filter(r => ehOperacional(r) && getDocStatus(r) === 'pendente')
    const semDocPay = payable.filter(r => ehOperacional(r) && getDocStatus(r) === 'pendente')
    if (semDocPay.length) out.push({ kind: 'warning', to: '/pagar?filtro=sem_doc', text: `📎 ${semDocPay.length} conta(s) a pagar com NF pendente — ${fmtMoney(semDocPay.reduce((a, r) => a + r.value, 0))}` })
    if (semDocRec.length) out.push({ kind: 'warning', to: '/receber?filtro=sem_doc', text: `📎 ${semDocRec.length} recebível(is) com NF pendente — ${fmtMoney(semDocRec.reduce((a, r) => a + r.value, 0))}` })
    // A escriturar: a porta que trava tudo o resto — sempre visível quando há fila.
    const aEscriturar = [...receivable, ...payable].filter(r => ehOperacional(r) && r.data?.escriturado !== true && !r.data?.conciliado_em)
    if (aEscriturar.length) out.push({ kind: 'warning', to: '/classificar', text: `📋 ${aEscriturar.length} lançamento(s) aguardando escrituração — não entram na conciliação até serem revisados` })
    return out
  }, [receivable, payable])

  // ── Caixa atual (base pra ICC e Saldo Projetado) ─────────────────────
  // Ancorado no saldo inicial das contas + tudo que entrou/saiu de fato (inclusive
  // financiamento — é caixa). Antes era Σ recebido − Σ pago desde sempre, sem o
  // saldo com que a conta começou — nunca batia com o banco.
  const caixaAtual = useMemo(() => {
    const saldoInicial = contas.reduce((a, c) => a + (Number(c.data?.saldo_inicial) || 0), 0)
    const totalRecebido = receivable.filter(r => r.status === 'Recebido').reduce((a, r) => a + r.value, 0)
    const totalPago = payable.filter(r => r.status === 'Pago').reduce((a, r) => a + r.value, 0)
    return saldoInicial + totalRecebido - totalPago
  }, [receivable, payable, contas])

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
        if (!ehOperacional(r)) return false // provisão não é faturamento; captação de empréstimo não é receita
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
      .filter(r => ehOperacional(r) && noAnoAteHoje(r.data?.data_competencia || r.due))
      .reduce((a, r) => a + r.value, 0)
    const desp = payable
      .filter(r => ehOperacional(r) && noAnoAteHoje(r.data?.data_competencia || r.due))
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

      {/* Contas hoje + o que falta fazer — banco × sistema por conta e a fila do mês */}
      <div style={painelGrid}>
        <div style={{ ...indCard, gridColumn: 'span 2' }}>
          <div style={indLabel}>Contas hoje · banco × sistema</div>
          {painelContas.length === 0 ? <div style={indSub}>Nenhuma conta cadastrada.</div> : (
            <table style={painelTbl}>
              <thead><tr><th style={painelTh}>Conta</th><th style={{ ...painelTh, textAlign: 'right' }}>No banco</th><th style={{ ...painelTh, textAlign: 'right' }}>No sistema</th><th style={{ ...painelTh, textAlign: 'right' }}>Diferença</th><th style={{ ...painelTh, textAlign: 'right' }}>A conciliar</th></tr></thead>
              <tbody>
                {painelContas.map(c => {
                  const dif = c.banco == null ? null : c.banco - c.sistema
                  return (
                    <tr key={c.id} onClick={() => navigate('/conciliacao')} style={{ cursor: 'pointer' }} title="Abrir a conciliação">
                      <td style={painelTd}>{c.cartao ? '💳 ' : '🏦 '}{c.nome}{c.ultimo && <span style={{ color: 'var(--text-mid)', fontSize: 10 }}> · extrato até {c.ultimo.split('-').reverse().join('/')}</span>}</td>
                      <td style={{ ...painelTd, textAlign: 'right', color: c.banco == null ? 'var(--text-mid)' : 'var(--navy)' }}>{c.banco == null ? (c.cartao ? '—' : 'importe OFX') : fmtMoney(c.banco)}</td>
                      <td style={{ ...painelTd, textAlign: 'right', fontWeight: 700, color: c.sistema < 0 ? 'var(--red)' : 'var(--navy)' }}>{fmtMoney(c.sistema)}</td>
                      <td style={{ ...painelTd, textAlign: 'right', fontWeight: 700, color: dif == null ? 'var(--text-mid)' : (Math.abs(dif) < 0.01 ? 'var(--green)' : 'var(--red)') }}>{dif == null ? '—' : (Math.abs(dif) < 0.01 ? '✓ bate' : fmtMoney(dif))}</td>
                      <td style={{ ...painelTd, textAlign: 'right', color: c.pendentes ? 'var(--gold-dark)' : 'var(--green)', fontWeight: 600 }}>{c.pendentes ? `${c.pendentes} linha(s)` : '✓'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          <div style={{ ...indSub, marginTop: 8 }}>“No banco” = saldo do último OFX importado. “No sistema” = saldo inicial + o que já está conciliado (cartão: compras cobradas − pagamentos da fatura). A diferença é exatamente o que falta conciliar.</div>
        </div>
        <div style={indCard}>
          <div style={indLabel}>O que falta fazer</div>
          <div style={feedList}>
            <FeedItem n={paraFazer.nfsCaixa} label="NF(s) na caixa de entrada" to="/importar-nfs" navigate={navigate} />
            <FeedItem n={paraFazer.aEscriturar} label="lançamento(s) a escriturar" to="/classificar" navigate={navigate} />
            <FeedItem n={paraFazer.aConciliar} label="linha(s) de extrato a conciliar" to="/conciliacao" navigate={navigate} />
            <div onClick={() => navigate('/fechamento-mensal')} style={feedRow} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') navigate('/fechamento-mensal') }}>
              <span style={{ ...feedNum, color: paraFazer.aFechar ? 'var(--gold-dark)' : 'var(--green)' }}>{paraFazer.aFechar ? '🔓' : '🔒'}</span>
              <span style={{ flex: 1 }}>{paraFazer.aFechar ? `mês ${paraFazer.aFechar.split('-').reverse().join('/')} aguardando fechamento` : 'meses em dia'}{paraFazer.ultimoFechado ? ` · último fechado ${paraFazer.ultimoFechado.split('-').reverse().join('/')}` : ' · nenhum mês fechado ainda'}</span>
              <span style={{ opacity: 0.6 }}>→</span>
            </div>
          </div>
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
function FeedItem({ n, label, to, navigate }) {
  const ok = !n
  return (
    <div onClick={() => navigate(to)} style={feedRow} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') navigate(to) }}>
      <span style={{ ...feedNum, color: ok ? 'var(--green)' : 'var(--gold-dark)' }}>{ok ? '✓' : n}</span>
      <span style={{ flex: 1 }}>{ok ? label.replace(/^\w/, c => c.toUpperCase()).replace('(s)', 's') + ': nada pendente' : label}</span>
      <span style={{ opacity: 0.6 }}>→</span>
    </div>
  )
}

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
const painelGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14, marginBottom: 18 }
const painelTbl = { width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--body)' }
const painelTh = { textAlign: 'left', fontSize: 9, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-mid)', padding: '6px 8px', borderBottom: '1px solid var(--cream-dark)' }
const painelTd = { padding: '8px 8px', fontSize: 12, color: 'var(--navy)', borderBottom: '1px solid var(--cream-dark)' }
const feedList = { display: 'flex', flexDirection: 'column', gap: 4 }
const feedRow = { display: 'flex', alignItems: 'center', gap: 10, padding: '7px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 12, color: 'var(--navy)', background: 'rgba(0,32,62,0.03)' }
const feedNum = { minWidth: 26, textAlign: 'center', fontWeight: 700, fontSize: 13 }
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
