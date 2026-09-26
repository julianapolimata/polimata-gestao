// =============================================================================
// NATUREZAS SEM DOCUMENTO FISCAL — regra de metodologia da Polímata.
//
// Há despesas que nunca vão ter nota fiscal, porque não existe nota a emitir:
//
//   • o banco cobra IOF, juros e tarifa — e o documento dele é o extrato;
//   • o governo cobra tributo — e o documento dele é a guia;
//   • o empréstimo tem contrato, e cada parcela é execução dele.
//
// Cobrar nota fiscal dessas é cobrar um papel que não existe, e obrigar uma
// justificativa escrita para cada uma é transformar o controle em burocracia
// sem ganho: a natureza já é a justificativa.
//
// Para TODAS AS OUTRAS, dar baixa sem a conferência do extrato é afirmar que
// pagou sem poder provar — e aí a justificativa é o que sustenta a afirmação.
//
// Esta lista vale por CATEGORIA do plano de contas, não por palavra na
// descrição: quem decide a natureza é a classificação contábil.
// =============================================================================

export const CATEGORIAS_SEM_NOTA_FISCAL = [
  // Banco: o documento é o extrato.
  'Despesas Financeiras',
  'Receitas Financeiras',
  // Empréstimo: o documento é o contrato.
  'Empréstimos e Financiamentos',
  // Governo: o documento é a guia.
  'Impostos sobre Receita',
  'Impostos sobre Folha',
  'Impostos retidos na fonte',
  'Outros Tributos',
  'Parcelamento de Tributos',
]

const normal = s => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().trim()

const LISTA = CATEGORIAS_SEM_NOTA_FISCAL.map(normal)

/**
 * A natureza deste lançamento dispensa documento fiscal?
 *
 * @param {object} data  o lançamento (precisa da categoria já classificada)
 * @returns {boolean}
 */
export function dispensaDocumentoFiscal(data) {
  const cat = normal(data?.cat)
  if (!cat) return false
  return LISTA.includes(cat)
}

/**
 * Dar baixa neste lançamento sem conferência bancária exige justificativa?
 *
 * Sim, salvo quando a natureza dispensa — e também quando o lançamento ainda
 * não foi classificado: sem categoria não dá para saber a natureza, e o certo
 * é perguntar, não presumir.
 */
export function exigeJustificativaNaBaixa(data) {
  return !dispensaDocumentoFiscal(data)
}

/** Por que esta natureza dispensa — a frase que aparece na tela. */
export function motivoDaDispensa(data) {
  const cat = normal(data?.cat)
  if (cat === normal('Despesas Financeiras') || cat === normal('Receitas Financeiras')) {
    return 'Cobrança do banco: o documento dela é o próprio extrato.'
  }
  if (cat === normal('Empréstimos e Financiamentos')) {
    return 'Parcela de empréstimo: o documento é o contrato.'
  }
  if (LISTA.includes(cat)) {
    return 'Tributo: o documento é a guia, não a nota fiscal.'
  }
  return ''
}
