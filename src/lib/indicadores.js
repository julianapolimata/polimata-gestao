// =============================================================================
// Indicadores de mercado pro Painel. Funções puras — recebem os dados já
// carregados (receivable/payable FLATTEN, recurring_masters e plano crus).
// =============================================================================
import { isOverdue, today } from './finance'
import { valorMensalEquivalente } from './recorrencias'
import { computeDRE } from './dre'

/** MRR — Receita Recorrente Mensal (mestres ativos de receita). */
export function calcMRR(recurringMasters) {
  return (recurringMasters || [])
    .filter(m => (m.data?.tipo !== 'despesa') && m.data?.ativo !== false)
    .reduce((s, m) => s + valorMensalEquivalente(m), 0)
}

/** Despesa recorrente mensal (custo fixo). */
export function calcDespesaRecorrente(recurringMasters) {
  return (recurringMasters || [])
    .filter(m => m.data?.tipo === 'despesa' && m.data?.ativo !== false)
    .reduce((s, m) => s + valorMensalEquivalente(m), 0)
}

/** Inadimplência — a receber vencido e não recebido (valor + % do aberto). */
export function calcInadimplencia(receivable) {
  let vencido = 0, totalAberto = 0
  for (const r of (receivable || [])) {
    const st = r.data?.status
    if (st === 'Recebido') continue
    const val = Number(r.value ?? r.data?.value ?? 0)
    totalAberto += val
    if (st !== 'Provisão' && isOverdue(r.due || r.data?.due)) vencido += val
  }
  return { vencido, totalAberto, pct: totalAberto > 0 ? vencido / totalAberto : 0 }
}

/** Margem líquida do ano (Lucro Líquido ÷ Receita Bruta) via DRE realizado. */
export function calcMargem(receivable, payable, plano, ano) {
  const linhas = computeDRE({ receivable, payable, plano, ano })
  const recBruta = linhas.find(l => l.id === 'rec-bruta')?.total || 0
  const liquido = linhas.find(l => l.id === 'liquido')?.total || 0
  return { recBruta, liquido, pct: recBruta > 0 ? liquido / recBruta : null }
}

/** Liquidez próximos N dias: a receber ÷ a pagar (não liquidados na janela). */
export function calcLiquidez(receivable, payable, dias = 30) {
  const hoje = today()
  const d = new Date(); d.setDate(d.getDate() + dias)
  const lim = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const naJanela = due => due && due >= hoje && due <= lim
  let aReceber = 0, aPagar = 0
  for (const r of (receivable || [])) {
    const st = r.data?.status
    if (st === 'Recebido' || st === 'Provisão') continue
    if (naJanela(r.due || r.data?.due)) aReceber += Number(r.value ?? r.data?.value ?? 0)
  }
  for (const p of (payable || [])) {
    const st = p.data?.status
    if (st === 'Pago' || st === 'Provisão') continue
    if (naJanela(p.due || p.data?.due)) aPagar += Number(p.value ?? p.data?.value ?? 0)
  }
  return { aReceber, aPagar, indice: aPagar > 0 ? aReceber / aPagar : null }
}

/** Concentração de clientes — % do faturamento no maior cliente (risco/GRC). */
export function calcConcentracao(receivable) {
  const porCliente = {}
  let total = 0
  for (const r of (receivable || [])) {
    if (r.data?.status === 'Provisão') continue
    const cli = (r.data?.client || r.client || '—').trim() || '—'
    const val = Number(r.value ?? r.data?.value ?? 0)
    if (val <= 0) continue
    porCliente[cli] = (porCliente[cli] || 0) + val
    total += val
  }
  let maiorNome = '—', maiorVal = 0
  for (const [cli, val] of Object.entries(porCliente)) {
    if (val > maiorVal) { maiorVal = val; maiorNome = cli }
  }
  return { maiorNome, maiorVal, pct: total > 0 ? maiorVal / total : 0, nClientes: Object.keys(porCliente).length }
}
