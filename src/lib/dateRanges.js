// =============================================================================
// Helpers de range de datas — replica _resolveDateRange do legado (linha 2672).
// Usado pelos filtros de Receber, Pagar, e (no futuro) Conciliação.
// =============================================================================

function fmtISO(dt) {
  return dt.toISOString().slice(0, 10)
}

/**
 * Resolve um período em { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }.
 *
 * @param {string} periodo - 'hoje' | 'semana' | 'mes' | 'mes_passado' | 'ano' | 'custom' | ''
 * @param {string} customFrom - data inicial (só usada se periodo === 'custom')
 * @param {string} customTo - data final (só usada se periodo === 'custom')
 * @returns {{from: string, to: string} | null} null se periodo vazio
 */
export function resolveDateRange(periodo, customFrom, customTo) {
  if (!periodo) return null
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  const d = now.getDate()

  if (periodo === 'hoje') {
    const t = fmtISO(now)
    return { from: t, to: t }
  }
  if (periodo === 'semana') {
    const dow = now.getDay() // 0 = domingo
    const ini = new Date(y, m, d - dow)
    const fim = new Date(y, m, d - dow + 6)
    return { from: fmtISO(ini), to: fmtISO(fim) }
  }
  if (periodo === 'mes') {
    return { from: fmtISO(new Date(y, m, 1)), to: fmtISO(new Date(y, m + 1, 0)) }
  }
  if (periodo === 'mes_passado') {
    return { from: fmtISO(new Date(y, m - 1, 1)), to: fmtISO(new Date(y, m, 0)) }
  }
  if (periodo === 'ano') {
    return { from: fmtISO(new Date(y, 0, 1)), to: fmtISO(new Date(y, 11, 31)) }
  }
  if (periodo === 'custom') {
    // Sem nenhuma data digitada, não ativa range nenhum (senão escondia linhas sem due).
    if (!customFrom && !customTo) return null
    return { from: customFrom || '1900-01-01', to: customTo || '2999-12-31' }
  }
  return null
}

/** Lista de opções pra dropdown de período. */
export const PERIODOS_LANCAMENTO = [
  { value: '', label: 'Todos períodos' },
  { value: 'hoje', label: 'Hoje' },
  { value: 'semana', label: 'Esta semana' },
  { value: 'mes', label: 'Este mês' },
  { value: 'mes_passado', label: 'Mês passado' },
  { value: 'ano', label: 'Este ano' },
  { value: 'custom', label: 'Personalizado' },
]
