// =============================================================================
// O FUNIL — as regras da oportunidade, puras, com prova em provas/funil.mjs.
//
// A oportunidade é o que está sendo negociado com uma pessoa. Ela aponta para
// a PESSOA, e não o contrário: no momento da proposta, quem está do outro lado
// ainda não é cliente.
//
// POR QUE A ETAPA SAIU DA FICHA: colada na pessoa, ela só admite uma. Duas
// propostas para o mesmo cliente — uma em aberto, uma perdida — não cabiam, e
// a Poli Instrumentos carregava "Fechado" como se fosse um atributo dela.
//
// SITUAÇÃO × ETAPA são eixos diferentes, e misturá-los foi o defeito original:
//   ETAPA     onde a negociação está: Sondagem, Proposta, Negociação.
//   SITUAÇÃO  como ela terminou: aberta, ganha, perdida.
// Uma oportunidade ganha não tem etapa — ela saiu do funil. "Fechado" como
// etapa era as duas coisas no mesmo campo.
// =============================================================================

/** Onde a negociação está, enquanto está aberta. */
export const ETAPAS = ['Sondagem', 'Proposta', 'Negociação']

/** Como ela terminou. */
export const SITUACOES = [
  { v: 'aberta', label: 'Em aberto' },
  { v: 'ganha', label: 'Ganha' },
  { v: 'perdida', label: 'Perdida' },
]

export const ORIGENS = ['Indicação', 'Evento', 'Inbound', 'Prospecção ativa', 'Cliente antigo']

const num = v => Number(v) || 0
const dadosDe = o => o?.data || o || {}

export function situacaoDe(o) { return String(dadosDe(o).situacao || 'aberta') }
export function etapaDe(o) { return String(dadosDe(o).etapa || '') }
export function valorDe(o) { return num(dadosDe(o).valor_estimado) }

/**
 * O funil: as oportunidades EM ABERTO, agrupadas por etapa.
 *
 * Ganhas e perdidas ficam de fora — elas já saíram do funil, e deixá-las
 * dentro faria o total prometer dinheiro que já foi decidido.
 */
export function funilPorEtapa(oportunidades) {
  const colunas = ETAPAS.map(etapa => ({ etapa, itens: [], total: 0 }))
  const semEtapa = { etapa: '', itens: [], total: 0 }
  for (const o of oportunidades || []) {
    if (situacaoDe(o) !== 'aberta') continue
    const etapa = etapaDe(o)
    const col = colunas.find(c => c.etapa === etapa) || semEtapa
    col.itens.push(o)
    col.total = Math.round((col.total + valorDe(o)) * 100) / 100
  }
  // A coluna sem etapa só aparece quando tem algo: etapa vazia é legítima
  // (nem toda negociação passou por funil registrado), mas coluna vazia na
  // tela é ruído.
  return semEtapa.itens.length ? [...colunas, semEtapa] : colunas
}

/**
 * O placar do funil.
 *
 * `taxaGanho` é calculada só sobre o que foi DECIDIDO (ganhas + perdidas).
 * Incluir as abertas no denominador faria a taxa cair toda vez que uma
 * proposta nova entrasse — o que diria algo sobre o volume, e não sobre a
 * conversão. Sem nada decidido, devolve null: não há taxa, e zero mentiria.
 */
export function placarDoFunil(oportunidades) {
  const lista = oportunidades || []
  const abertas = lista.filter(o => situacaoDe(o) === 'aberta')
  const ganhas = lista.filter(o => situacaoDe(o) === 'ganha')
  const perdidas = lista.filter(o => situacaoDe(o) === 'perdida')
  const decididas = ganhas.length + perdidas.length
  const soma = l => Math.round(l.reduce((s, o) => s + valorDe(o), 0) * 100) / 100
  return {
    emAberto: abertas.length,
    valorEmAberto: soma(abertas),
    ganhas: ganhas.length,
    valorGanho: soma(ganhas),
    perdidas: perdidas.length,
    valorPerdido: soma(perdidas),
    taxaGanho: decididas ? Math.round((ganhas.length / decididas) * 1000) / 10 : null,
  }
}

/**
 * A próxima referência de proposta do ano: P-2026-001, P-2026-002…
 *
 * O ano vem da data da proposta, e não de "hoje": uma proposta de dezembro
 * cadastrada em janeiro pertence ao ano dela.
 */
export function proximaReferencia(codigosExistentes, ano) {
  const prefixo = `P-${ano}-`
  let maior = 0
  for (const c of codigosExistentes || []) {
    const s = String(c || '')
    if (!s.startsWith(prefixo)) continue
    const n = parseInt(s.slice(prefixo.length), 10)
    if (Number.isFinite(n) && n > maior) maior = n
  }
  return `${prefixo}${String(maior + 1).padStart(3, '0')}`
}

/**
 * O que impede de salvar. Devolve a mensagem, em português, ou null.
 *
 * A pessoa é obrigatória porque oportunidade sem pessoa não é negociação com
 * ninguém. O motivo da perda é obrigatório porque perda sem motivo não ensina
 * nada — e o funil existe para ensinar.
 */
export function problemaNaOportunidade(d) {
  if (!d?.pessoa_id) return 'Escolha com quem é esta negociação.'
  const situacao = String(d.situacao || 'aberta')
  if (!SITUACOES.some(s => s.v === situacao)) return 'Situação inválida.'
  if (situacao === 'perdida' && !String(d.motivo_perda || '').trim()) {
    return 'Informe o motivo da perda: é por ele que as causas são apuradas.'
  }
  if (situacao === 'aberta' && !String(d.etapa || '').trim()) {
    return 'Escolha a etapa: toda negociação em aberto está em algum lugar.'
  }
  return null
}
