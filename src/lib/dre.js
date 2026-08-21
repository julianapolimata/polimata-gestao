// =============================================================================
// Cálculo do DRE Gerencial (CPC 26) — versão pura, usada pelos RELATÓRIOS.
// ⚠️ Espelha a lógica de src/pages/DRE.jsx. Se mudar a regra do DRE lá,
//    atualize aqui também (mantidos em sincronia de propósito, pra não mexer
//    na tela que já funciona).
// Realizado = exclui Provisão. Projetado = inclui Provisão + projeta as
// recorrências dos meses futuros do ano.
// =============================================================================
import { ocorrenciasEntre } from './recorrencias'

export const DRE_BLOCOS = [
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

/**
 * @returns {Array<{id,label,kind,total,byMes[12],subItems}>}
 * @param opts { receivable, payable, plano, ano, incluirProvisao, recurringMasters, incluirProjecao }
 */
export function computeDRE({ receivable = [], payable = [], plano = [], ano, incluirProvisao = false, recurringMasters = [], incluirProjecao = false }) {
  const catToClass = new Map()
  const catSubToClass = new Map()
  for (const p of plano) {
    if (p.categoria && p.classificacao) catToClass.set(`${p.tipo}|${p.categoria}`, p.classificacao)
    if (p.categoria && p.subcategoria && p.classificacao) catSubToClass.set(`${p.tipo}|${p.categoria}|${p.subcategoria}`, p.classificacao)
  }
  const resolveClassif = (tipoFin, cat, sub) =>
    (sub && catSubToClass.get(`${tipoFin}|${cat}|${sub}`)) || catToClass.get(`${tipoFin}|${cat}`)

  const grupos = {}
  function bucket(classif) {
    if (!grupos[classif]) grupos[classif] = { total: 0, byMes: new Array(12).fill(0), byCat: {} }
    return grupos[classif]
  }
  function add(classif, cat, m, val) {
    const b = bucket(classif)
    b.total += val
    b.byMes[m] += val
    if (!b.byCat[cat]) b.byCat[cat] = { total: 0, byMes: new Array(12).fill(0) }
    b.byCat[cat].total += val
    b.byCat[cat].byMes[m] += val
  }
  function processa(reg, tipoFin) {
    if (!incluirProvisao && reg.data?.status === 'Provisão') return
    const ref = reg.data?.data_competencia || reg.due || reg.created || null
    if (!ref || !String(ref).startsWith(ano)) return
    const m = parseInt(String(ref).substring(5, 7), 10) - 1
    if (m < 0 || m > 11) return
    const cat = reg.data?.cat
    if (!cat) return
    const classif = resolveClassif(tipoFin, cat, reg.data?.subcat)
    if (!classif) return
    add(classif, cat, m, Number(reg.value || 0))
  }
  receivable.forEach(r => processa(r, 'Entrada'))
  payable.forEach(r => processa(r, 'Saída'))

  // Projeção: recorrências dos meses FUTUROS do ano (evita double com provisão
  // do mês corrente — só conta meses depois do atual).
  if (incluirProjecao) {
    const hoje = new Date()
    const anoNum = Number(ano)
    const mesCorte = hoje.getFullYear() === anoNum ? hoje.getMonth() : (hoje.getFullYear() < anoNum ? -1 : 12)
    for (const master of (recurringMasters || [])) {
      const d = master.data || {}
      if (d.ativo === false) continue
      const valor = Number(d.valor) || 0
      if (!valor || !d.cat) continue
      const tipoFin = d.tipo === 'despesa' ? 'Saída' : 'Entrada'
      const classif = resolveClassif(tipoFin, d.cat, d.subcat)
      if (!classif) continue
      for (const due of ocorrenciasEntre(master, `${anoNum}-01-01`, `${anoNum}-12-31`)) {
        const m = parseInt(due.substring(5, 7), 10) - 1
        if (m <= mesCorte) continue
        add(classif, d.cat, m, valor)
      }
    }
  }

  const valores = {}
  const linhas = []
  for (const blk of DRE_BLOCOS) {
    if (blk.kind === 'subtotal') {
      const v = evalFormula(blk.formula, valores)
      valores[blk.id] = v
      linhas.push({ ...blk, total: v.total, byMes: v.byMes, subItems: [] })
    } else {
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
      linhas.push({ ...blk, total, byMes, subItems })
    }
  }
  return linhas
}

/**
 * Fluxo de Caixa anual por mês. Realizado (meses passados/atual, por status
 * Recebido/Pago) + Projeção (meses futuros: não-liquidados por vencimento +
 * recorrências). Retorna { entradas[12], saidas[12], saldo[12], acumulado[12] }.
 */
export function computeFluxoAnual({ receivable = [], payable = [], recurringMasters = [], ano }) {
  const anoNum = Number(ano)
  const entradas = new Array(12).fill(0)
  const saidas = new Array(12).fill(0)
  // Subconjunto de FINANCIAMENTO (empréstimos): captação (entrada) e amortização/
  // juros (saída). Fica dentro de entradas/saidas (é caixa de verdade), mas também
  // aqui pra a tela poder separar Operacional × Financiamento (estrutura DFC).
  const entradasFin = new Array(12).fill(0)
  const saidasFin = new Array(12).fill(0)
  const hoje = new Date()
  const mesCorte = hoje.getFullYear() === anoNum ? hoje.getMonth() : (hoje.getFullYear() < anoNum ? -1 : 12)

  function mesDe(iso) {
    if (!iso || !String(iso).startsWith(String(anoNum))) return -1
    return parseInt(String(iso).substring(5, 7), 10) - 1
  }

  // Realizado (Recebido/Pago) — todos os meses onde houver liquidação no ano.
  for (const r of receivable) {
    if (r.data?.status !== 'Recebido') continue
    const m = mesDe(r.data?.data_pagamento || r.due)
    if (m >= 0) { const v = Number(r.value || r.data?.value || 0); entradas[m] += v; if (r.data?.criado_via_emprestimo) entradasFin[m] += v }
  }
  for (const p of payable) {
    if (p.data?.status !== 'Pago') continue
    const m = mesDe(p.data?.data_pagamento || p.due)
    if (m >= 0) { const v = Number(p.value || p.data?.value || 0); saidas[m] += v; if (p.data?.criado_via_emprestimo) saidasFin[m] += v }
  }
  // Projeção (meses futuros): não-liquidados por vencimento + recorrências.
  for (const r of receivable) {
    if (r.data?.status === 'Recebido') continue
    const m = mesDe(r.due || r.data?.due)
    if (m > mesCorte) { const v = Number(r.value || r.data?.value || 0); entradas[m] += v; if (r.data?.criado_via_emprestimo) entradasFin[m] += v }
  }
  for (const p of payable) {
    if (p.data?.status === 'Pago') continue
    const m = mesDe(p.due || p.data?.due)
    if (m > mesCorte) { const v = Number(p.value || p.data?.value || 0); saidas[m] += v; if (p.data?.criado_via_emprestimo) saidasFin[m] += v }
  }
  for (const master of (recurringMasters || [])) {
    const d = master.data || {}
    if (d.ativo === false) continue
    const valor = Number(d.valor) || 0
    if (!valor) continue
    const isReceita = d.tipo !== 'despesa'
    for (const due of ocorrenciasEntre(master, `${anoNum}-01-01`, `${anoNum}-12-31`)) {
      const m = parseInt(due.substring(5, 7), 10) - 1
      if (m <= mesCorte) continue
      if (isReceita) entradas[m] += valor; else saidas[m] += valor
    }
  }

  const saldo = entradas.map((e, i) => e - saidas[i])
  const acumulado = []
  let acc = 0
  for (let i = 0; i < 12; i++) { acc += saldo[i]; acumulado.push(acc) }
  // Operacional = total − financiamento (por mês)
  const entradasOp = entradas.map((e, i) => e - entradasFin[i])
  const saidasOp = saidas.map((s, i) => s - saidasFin[i])
  return { entradas, saidas, saldo, acumulado, mesCorte, entradasFin, saidasFin, entradasOp, saidasOp }
}
