// =============================================================================
// Match engine — sugere lançamentos do sistema pra cada transação do extrato.
// Decisão de design: tolerância ±3 dias na data, valor exato, prioriza CNPJ
// extraído da descrição do OFX vs nome do cliente/fornecedor.
// =============================================================================

const TOL_DIAS = 3
const MS_DIA = 86400000

/**
 * Acha sugestões pra uma transação do extrato.
 *
 * @param {object} extrato - { tipo: 'entrada'|'saida', valor, data, cnpj?, descricao }
 * @param {Array} candidatos - receivable (se entrada) ou payable (se saida) já flatten
 * @returns {Array<{lancamento, score, motivo}>} ordenado por score desc
 */
export function sugerirMatches(extrato, candidatos) {
  if (!extrato || !candidatos?.length) return []
  const valor = Number(extrato.valor)
  if (Number.isNaN(valor)) return []
  const dataExt = new Date(extrato.data + 'T12:00:00')
  const cnpjExtrato = extrato.cnpj
  const resultados = []
  for (const c of candidatos) {
    // Match obrigatório: valor exato (tolerância 0.01 pra arredondamento).
    // A DATA não é mais filtro rígido — ela só ranqueia. Antes, pagar numa data
    // diferente do vencimento escondia o match legítimo; agora ele aparece
    // (marcado como "data diferente" quando fora da tolerância).
    const cVal = Number(c.value)
    if (Number.isNaN(cVal) || Math.abs(cVal - valor) > 0.01) continue
    // Data de referência: prefer data_pagamento (se já liquidado), fallback due, fallback created
    const refData = c.data?.data_pagamento || c.due || c.created
    const dataLanc = refData ? new Date(refData + 'T12:00:00') : null
    const diffDias = dataLanc ? Math.abs(dataExt - dataLanc) / MS_DIA : Infinity
    const dentroTol = diffDias <= TOL_DIAS
    // Score: valor sempre bate (1). Data próxima bonifica; CNPJ bonifica forte.
    let score = 1
    if (diffDias < 0.5) score += 0.4
    else if (dentroTol) score += 0.2
    const motivos = [`valor ${formatBR(valor)}`]
    if (Number.isFinite(diffDias)) motivos.push(dentroTol ? `data ±${Math.round(diffDias)}d` : `${Math.round(diffDias)}d de diferença`)
    if (cnpjExtrato && (c.data?.cnpj || c.data?.cnpj_parte)) {
      const cnpjLanc = String(c.data.cnpj || c.data.cnpj_parte).replace(/\D/g, '')
      if (cnpjLanc === cnpjExtrato) {
        score += 1
        motivos.push('CNPJ confere')
      }
    }
    resultados.push({ lancamento: c, score, motivo: motivos.join(' · '), dentroTol })
  }
  return resultados.sort((a, b) => b.score - a.score)
}

function formatBR(v) {
  return (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
