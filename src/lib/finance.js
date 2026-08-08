// =============================================================================
// Helpers financeiros compartilhados (Painel, Fluxo, DRE, Conciliação, etc)
// Replica o comportamento das funções globais do legado (public/index.html).
// =============================================================================

const FX_SYMBOLS = { BRL: 'R$ ', USD: 'US$ ', EUR: '€ ', GBP: '£ ', ARS: 'AR$ ' }

/** Formata um valor numérico em moeda. Default BRL. */
export function fmtMoney(value, moeda = 'BRL') {
  const m = (moeda || 'BRL').toUpperCase()
  const sym = FX_SYMBOLS[m] || (m + ' ')
  const v = (Number(value) || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return `${sym}${m === 'BRL' ? '' : ' '}${v}`
}

/** YYYY-MM-DD → DD/MM/YYYY. Retorna '—' se vazio. */
export function fmtDate(d) {
  if (!d) return '—'
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

/** Data de hoje em formato YYYY-MM-DD (timezone local do navegador). */
export function today() {
  const d = new Date()
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${mo}-${day}`
}

/** True se a data de vencimento já passou (considerando 23:59:59 do dia). */
export function isOverdue(due) {
  if (!due) return false
  return new Date(due + 'T23:59:59') < new Date()
}

/** Status do documento fiscal de um lançamento. */
export function getDocStatus(reg) {
  if (!reg) return 'vinculado'
  const d = reg.data || reg
  if (d.doc_status) return d.doc_status
  if (d.sem_documento) return 'pendente'
  return 'vinculado'
}

/**
 * Extrai os campos canônicos de um registro vindo do Supabase no formato
 * {id, codigo, data: {...}}. O legado usa propriedades direto na linha.
 * Aqui devolvemos um shape achatado para o consumo do Painel/Fluxo/etc.
 */
export function flatten(row) {
  if (!row) return {}
  const d = row.data || {}
  return {
    id: row.id,
    codigo: row.codigo,
    anexo_path: row.anexo_path,
    created_at: row.created_at,
    updated_at: row.updated_at,
    // campos do jsonb data
    client: d.client,
    supplier: d.supplier,
    desc: d.desc,
    value: Number(d.value || 0),
    due: d.due,
    created: d.created,
    status: d.status,
    cat: d.cat,
    doc_status: d.doc_status,
    sem_documento: d.sem_documento,
    doc_motivo_dispensa: d.doc_motivo_dispensa,
    // preserva o jsonb inteiro pra acessos avançados
    data: d,
  }
}

/** Checa se uma data ISO (YYYY-MM-DD) cai num determinado ano+mês (0-11). */
export function inMonth(dateStr, ano, mes) {
  if (!dateStr) return false
  const d = new Date(dateStr + 'T12:00:00')
  return d.getFullYear() === ano && d.getMonth() === mes
}

/** Rótulos abreviados em pt-BR para os 12 meses do ano. */
export function monthLabels(ano = new Date().getFullYear()) {
  const out = []
  for (let m = 0; m <= 11; m++) {
    const dt = new Date(ano, m, 1)
    out.push(dt.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '').toLowerCase())
  }
  return out
}

const MES_CURTO = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

/**
 * Projeta entradas e saídas dos próximos N meses baseado em recorrências.
 * Replica calcularProjecaoFutura() do legado (linha 3265).
 *
 * Considera 3 fontes:
 *  1. receivable/payable com `data.recorrente === true`
 *  2. Contratos com `data.rec_ativa === true` e status Ativo (apenas entradas, mensal)
 *  3. Lançamentos NÃO recorrentes com data futura (já cadastrados)
 *
 * Inputs já vêm passados por flatten(). Quando Recorrências for construído (#11),
 * basta os usuários começarem a marcar `recorrente:true` que essa função usa.
 */
export function calcularProjecaoFutura(numMeses, { receivable = [], payable = [], contracts = [] } = {}) {
  const entradas = new Array(numMeses).fill(0)
  const saidas = new Array(numMeses).fill(0)
  const labels = []
  const hoje = new Date()
  const incPorFreq = { mensal: 1, trimestral: 3, semestral: 6, anual: 12 }

  for (let i = 0; i < numMeses; i++) {
    const fd = new Date(hoje.getFullYear(), hoje.getMonth() + 1 + i, 1)
    labels.push(`${MES_CURTO[fd.getMonth()]}/${String(fd.getFullYear()).slice(2)}`)
  }

  function avancarRecorrencia(reg, arr) {
    if (!reg.due) return
    const freq = reg.data?.rec_frequencia || 'mensal'
    const inc = incPorFreq[freq] || 1
    let d = new Date(reg.due + 'T12:00:00')
    while (d <= hoje) d.setMonth(d.getMonth() + inc)
    for (let i = 0; i < numMeses; i++) {
      const target = new Date(hoje.getFullYear(), hoje.getMonth() + 1 + i, 1)
      if (d.getFullYear() === target.getFullYear() && d.getMonth() === target.getMonth()) {
        arr[i] += Number(reg.value) || 0
        d.setMonth(d.getMonth() + inc)
      } else if (d < target) {
        d = new Date(target)
      }
    }
  }

  receivable.filter(r => r.data?.recorrente).forEach(r => avancarRecorrencia(r, entradas))
  payable.filter(r => r.data?.recorrente).forEach(r => avancarRecorrencia(r, saidas))

  contracts
    .filter(c => c.data?.rec_ativa && (c.data?.status === 'Ativo'))
    .forEach(c => {
      const valor = Number(c.data?.rec_valor_mensal || c.value || 0)
      for (let i = 0; i < numMeses; i++) entradas[i] += valor
    })

  receivable.filter(r => !r.data?.recorrente && r.due).forEach(r => {
    const d = new Date(r.due + 'T12:00:00')
    if (d <= hoje) return
    for (let i = 0; i < numMeses; i++) {
      const target = new Date(hoje.getFullYear(), hoje.getMonth() + 1 + i, 1)
      if (d.getFullYear() === target.getFullYear() && d.getMonth() === target.getMonth()) {
        entradas[i] += Number(r.value) || 0
      }
    }
  })
  payable.filter(r => !r.data?.recorrente && r.due).forEach(r => {
    const d = new Date(r.due + 'T12:00:00')
    if (d <= hoje) return
    for (let i = 0; i < numMeses; i++) {
      const target = new Date(hoje.getFullYear(), hoje.getMonth() + 1 + i, 1)
      if (d.getFullYear() === target.getFullYear() && d.getMonth() === target.getMonth()) {
        saidas[i] += Number(r.value) || 0
      }
    }
  })

  return { entradas, saidas, labels }
}

// =============================================================================
// Classificação CPC 03 — Fluxo de Caixa por atividade
// =============================================================================

/**
 * Classificações do plano_contas que representam ATIVIDADES DE INVESTIMENTO
 * (CPC 03 §16): aquisição/venda de ativos imobilizados, intangíveis, ou
 * aplicações financeiras que não são equivalentes de caixa.
 */
const CLASSIF_INVESTIMENTO = new Set([
  'Imobilizado/Intangível',
])

/** Subcategorias adicionais que se enquadram como investimento, mesmo
 * em classificações operacionais (ex: aplicações financeiras como
 * 'Transferência Entre Contas') */
const SUBCAT_INVESTIMENTO_KEYS = ['aplicaç', 'aplicac', 'resgate', 'cdb', 'tesouro', 'fundo']

/**
 * Classifica um lançamento como atividade Operacional, Investimento ou
 * Financiamento, conforme CPC 03. Recebe o lançamento já flatten() e a
 * tabela plano_contas pra resolver a classificação da categoria.
 *
 * @returns {'operacional' | 'investimento' | 'financiamento'}
 */
export function classificarFluxo(reg, plano) {
  if (!reg) return 'operacional'
  const cat = reg.cat || reg.data?.cat
  const subcat = (reg.subcat || reg.data?.subcat || '').toLowerCase()

  if (subcat && SUBCAT_INVESTIMENTO_KEYS.some(k => subcat.includes(k))) {
    return 'investimento'
  }

  if (!cat || !plano) return 'operacional'

  // Procura no plano de contas: precisa do par (tipo, categoria) pra resolver classificacao
  const tipoFin = guessTipoFinanc(reg)
  const linha = plano.find(p => p.tipo === tipoFin && p.categoria === cat)
  if (!linha) return 'operacional'

  if (CLASSIF_INVESTIMENTO.has(linha.classificacao)) return 'investimento'
  if (linha.classificacao === 'Empréstimo - Principal') return 'financiamento'
  return 'operacional'
}

/** Heurística pra inferir se um registro é Entrada ou Saída pelo formato. */
function guessTipoFinanc(reg) {
  // Por padrão olha o status do registro — Recebido = Entrada, Pago = Saída
  if (reg.status === 'Recebido' || reg.client !== undefined) return 'Entrada'
  if (reg.status === 'Pago' || reg.supplier !== undefined) return 'Saída'
  // Fallback: se vem do receivable é Entrada, payable é Saída
  return reg._tipoFin || 'Entrada'
}
