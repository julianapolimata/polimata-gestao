// =============================================================================
// PARCELAS — geração de N parcelas a partir de uma compra parcelada.
// Decisão UX 26/abr: detecção via regex "X/Y" no fim da descrição OU
// checkbox manual. Vencimento progressivo segue o dia_vencimento do cartão.
// =============================================================================

const REGEX_PARCELA = /\b(\d{1,2})\s*\/\s*(\d{1,2})\b\s*$/

/**
 * Tenta detectar "X/Y" no fim da descrição. Retorna {atual, total} ou null.
 * Aceita formato "3/12" ou "3 / 12" no fim da string.
 */
export function detectarParcela(descricao) {
  if (!descricao) return null
  const m = String(descricao).trim().match(REGEX_PARCELA)
  if (!m) return null
  const atual = parseInt(m[1], 10)
  const total = parseInt(m[2], 10)
  if (atual < 1 || total < 2 || atual > total) return null
  return { atual, total }
}

/**
 * Limpa o sufixo de parcela da descrição. Útil pra evitar repetir "1/12"
 * em todas as parcelas (a parcela é deduzida do parcela_atual).
 */
export function removerSufixoParcela(descricao) {
  return String(descricao || '').replace(REGEX_PARCELA, '').trim()
}

// Igual à detecção normal, mas acha "X/Y" em QUALQUER lugar (não só no fim) —
// necessário para memos de fatura que trazem a cidade depois da parcela
// (ex.: "EBN *Canva 11/12 CURITIBA"). Devolve {atual, total, serie}, onde
// serie é o texto antes do "X/Y" (o "nome" do parcelamento).
const REGEX_PARCELA_LIVRE = /\b(\d{1,2})\s*\/\s*(\d{1,2})\b/
export function detectarParcelaLivre(descricao) {
  if (!descricao) return null
  const s = String(descricao)
  const m = s.match(REGEX_PARCELA_LIVRE)
  if (!m) return null
  const atual = parseInt(m[1], 10)
  const total = parseInt(m[2], 10)
  if (atual < 1 || total < 2 || atual > total) return null
  return { atual, total, serie: s.slice(0, m.index).trim() }
}

/**
 * Calcula a data de vencimento da parcela K (1-N) a partir do cartão.
 * Lógica: a data da compra define em qual fatura a 1ª parcela cai.
 *   - Se data_compra <= dia_fechamento → fatura atual (vencimento neste mês)
 *   - Se data_compra > dia_fechamento → fatura próxima (vencimento mês que vem)
 * Demais parcelas: +1 mês sempre.
 */
export function venceParcela(dataCompraISO, cartao, k) {
  const compra = new Date(dataCompraISO + 'T12:00:00')
  const diaFech = Number(cartao?.data?.dia_fechamento) || 1
  const diaVenc = Number(cartao?.data?.dia_vencimento) || 10
  // Mês base da 1ª parcela
  const offsetPrimeiraParcela = compra.getDate() > diaFech ? 1 : 0
  const m = compra.getMonth() + offsetPrimeiraParcela + (k - 1)
  const y = compra.getFullYear()
  // Clampa o dia ao último dia do mês-alvo (ex.: vencimento 31 em mês de 30
  // dias não deve transbordar pro mês seguinte).
  const ultimoDia = new Date(y, m + 1, 0).getDate()
  const data = new Date(y, m, Math.min(diaVenc, ultimoDia))
  return data.toISOString().slice(0, 10)
}

/**
 * Gera os payloads das N parcelas. NÃO chama Supabase — apenas devolve
 * o array. O caller (ModalLancamento) faz o insert em batch + parent_id.
 *
 * Cada parcela:
 *  - Mesma data_competencia (mês da compra)
 *  - Vencimento progressivo (via venceParcela)
 *  - Valor = total / N (arredondado a 2 casas; a última recebe o ajuste de centavos)
 *  - Descrição = `${desc base} ${k}/${total}`
 *  - data.parcela_atual, data.parcela_total
 */
export function gerarParcelas({ baseData, valorTotal, numParcelas, dataCompra, cartao }) {
  const out = []
  const valorParcela = Math.round((Number(valorTotal) / numParcelas) * 100) / 100
  const totalArred = valorParcela * numParcelas
  const ajusteUltima = Math.round((Number(valorTotal) - totalArred) * 100) / 100
  const descBase = removerSufixoParcela(baseData.desc || '')
  for (let k = 1; k <= numParcelas; k++) {
    const valor = k === numParcelas ? Math.round((valorParcela + ajusteUltima) * 100) / 100 : valorParcela
    const venc = venceParcela(dataCompra, cartao, k)
    out.push({
      ...baseData,
      desc: `${descBase} ${k}/${numParcelas}`.trim(),
      value: valor,
      due: venc,
      // Mantém data_competencia única (a do mês da compra)
      data_competencia: baseData.data_competencia || dataCompra,
      // Status: cada parcela individual nasce Pendente. data_pagamento limpa.
      status: 'Pendente',
      data_pagamento: null,
      parcela_atual: k,
      parcela_total: numParcelas,
    })
  }
  return out
}
