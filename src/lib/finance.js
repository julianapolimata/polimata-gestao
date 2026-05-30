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
  return `${sym}${m === 'BRL' ? '' : ' '}${v}`.replace('R$ ', 'R$ ')
}

/** YYYY-MM-DD → DD/MM/YYYY. Retorna '—' se vazio. */
export function fmtDate(d) {
  if (!d) return '—'
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

/** Data de hoje em formato YYYY-MM-DD (timezone local). */
export function today() {
  return new Date().toISOString().split('T')[0]
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
