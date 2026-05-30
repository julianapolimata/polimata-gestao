// =============================================================================
// FATURA — cálculo de períodos de fechamento de cartão de crédito.
// Decisão UX 30/05: período = (dia_fechamento+1 do mês anterior) até
// (dia_fechamento deste mês). A fatura vence no dia_vencimento DESTE mês.
// =============================================================================

/**
 * Período coberto por uma fatura específica.
 *
 * @param {object} cartao - registro do cartões (data.dia_fechamento, data.dia_vencimento)
 * @param {number} ano - ano da fatura (ex: 2026)
 * @param {number} mes - mês 0-11 em que a fatura VENCE
 * @returns {{ini: string, fim: string, vencimento: string}} datas YYYY-MM-DD
 */
export function periodoFatura(cartao, ano, mes) {
  const dF = Number(cartao?.data?.dia_fechamento) || 1
  const dV = Number(cartao?.data?.dia_vencimento) || 10
  // Fatura que vence em mes/ano fecha no dia_fechamento DESTE mês
  // e abrange (dF+1) do mês anterior até dF deste mês
  const fimDate = new Date(ano, mes, dF)
  const iniDate = new Date(ano, mes - 1, dF + 1)
  const vencDate = new Date(ano, mes, dV)
  const fmt = d => d.toISOString().slice(0, 10)
  return { ini: fmt(iniDate), fim: fmt(fimDate), vencimento: fmt(vencDate) }
}

/** Mês de referência da fatura — formato curto pt-BR (ex: "mai/2026"). */
export function rotuloFatura(ano, mes) {
  const dt = new Date(ano, mes, 1)
  return dt.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }).replace('.', '')
}
