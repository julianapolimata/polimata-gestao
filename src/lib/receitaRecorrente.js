// =============================================================================
// A RECEITA RECORRENTE DOS CONTRATOS (B4.2 e B4.3).
//
// ── OS DOIS DEFEITOS QUE ISTO FECHA, achados em 09/11/2026 ──────────────────
//
// 1. A PROJEÇÃO LIA UM CAMPO QUE NENHUMA TELA PREENCHIA.
//    O bloco `rec_ativa` / `rec_valor_mensal` foi retirado do formulário de
//    contrato — com razão, porque ele configurava EMISSÃO RECORRENTE DE NFS-e,
//    que nunca foi construída. Só que `calcularProjecaoFutura` continuou
//    filtrando por `rec_ativa`. Resultado: cadastrar contrato não fazia a
//    projeção enxergar nada, e isso não era visível em lugar nenhum.
//
//    Duas coisas diferentes estavam num campo só:
//      EMITIR NOTA TODO MÊS   não existe no sistema;
//      QUANTO ENTRA POR MÊS   é o que a projeção precisa saber.
//
// 2. A PROJEÇÃO IGNORAVA A VIGÊNCIA.
//    O valor era somado em TODOS os meses projetados, sem olhar início nem
//    fim. Um contrato encerrado em março continuaria prometendo receita em
//    dezembro — e um que começa em junho já apareceria em janeiro.
//
// ── A REGRA ─────────────────────────────────────────────────────────────────
//
// Um contrato entra na projeção de um mês quando:
//   • tem valor mensal maior que zero;
//   • está com status Ativo;
//   • aquele mês está dentro da vigência (início já passou, fim ainda não).
//
// Contrato sem data de fim é contrato sem prazo definido: vale enquanto o
// status disser Ativo. Encerrar é mudar o status, e isso é decisão dela.
// =============================================================================

const num = v => Number(v) || 0
const dadosDe = c => c?.data || c || {}

/**
 * O valor mensal que este contrato promete.
 *
 * Lê o campo novo e, na falta dele, o antigo — contratos cadastrados antes de
 * 09/11/2026 guardam `rec_valor_mensal`, e perder esse valor seria apagar o
 * que já havia sido informado.
 */
export function valorMensalDe(contrato) {
  const d = dadosDe(contrato)
  if (d.valor_mensal != null && d.valor_mensal !== '') return num(d.valor_mensal)
  if (d.rec_ativa && d.rec_valor_mensal != null) return num(d.rec_valor_mensal)
  return 0
}

/** O primeiro dia do mês, em texto comparável (AAAA-MM). */
const competencia = (ano, mes) => `${ano}-${String(mes + 1).padStart(2, '0')}`

/**
 * O contrato vale para esta competência?
 *
 * @param {object} contrato
 * @param {string} comp  'AAAA-MM'
 */
export function valeNaCompetencia(contrato, comp) {
  const d = dadosDe(contrato)
  if (String(d.status || '') !== 'Ativo') return false
  if (valorMensalDe(contrato) <= 0) return false
  const inicio = String(d.start || d.inicio || '').slice(0, 7)
  const fim = String(d.end || d.fim || '').slice(0, 7)
  if (inicio && comp < inicio) return false
  if (fim && comp > fim) return false
  return true
}

/**
 * Quanto os contratos somam em cada um dos meses projetados.
 *
 * @param {Array} contratos
 * @param {Array<{ano:number, mes:number}>} meses  mes base zero
 * @returns {Array<number>} uma soma por mês, na mesma ordem
 */
export function receitaDosContratos(contratos, meses) {
  return (meses || []).map(({ ano, mes }) => {
    const comp = competencia(ano, mes)
    let soma = 0
    for (const c of contratos || []) {
      if (valeNaCompetencia(c, comp)) soma += valorMensalDe(c)
    }
    return Math.round(soma * 100) / 100
  })
}

/**
 * O que a tela de contratos mostra sobre a recorrência, em uma linha.
 *
 * Devolve null quando não há valor mensal: contrato pontual não promete
 * receita recorrente, e inventar um texto sobre isso seria ruído.
 */
export function resumoDaRecorrencia(contrato) {
  const valor = valorMensalDe(contrato)
  if (valor <= 0) return null
  const d = dadosDe(contrato)
  const ativo = String(d.status || '') === 'Ativo'
  const fim = String(d.end || d.fim || '').slice(0, 7)
  return {
    valor,
    naProjecao: ativo,
    // Por que não está na projeção, quando não está. A tela mostra isto em
    // vez de simplesmente omitir o contrato de um número que ela não explica.
    motivo: ativo ? null : `o contrato está como "${d.status || 'sem status'}"`,
    ate: fim || null,
  }
}
