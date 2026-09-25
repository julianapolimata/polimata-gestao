// =============================================================================
// REGRAS DA CONCILIAÇÃO — o extrato se repete, a decisão não precisa.
//
// "DÉB.CONV.EN.ELÉTRICA E GÁS" aparece todo mês, é sempre a mesma conta de luz,
// e todo mês alguém decide a mesma coisa. Aqui essa decisão vira proposta na
// próxima vez.
//
// O princípio é o mesmo da Escrituração, e é ele que torna isso seguro:
//
//   • só aprende do que foi decidido À MÃO (proposta aceita não vira regra —
//     senão o sistema aprenderia com ele mesmo e um erro viraria doutrina);
//   • só vira regra quando o histórico é UNÂNIME. Se a mesma descrição já foi
//     classificada de dois jeitos, não há regra: espera a decisão humana;
//   • a regra PROPÕE, nunca aplica sozinha. Quem concilia é quem decide.
// =============================================================================

import { documentosNoTexto, normalizar } from './matchExtrato.js'

// O que varia entre duas ocorrências da mesma cobrança e precisa sair da chave:
// data, hora, número de documento e sufixos de parcela.
const VARIAVEL = [
  /\b\d{1,2}\s*\/\s*\d{1,2}(\s*\/\s*\d{2,4})?\b/g,   // 05/12, 05/12/2026
  /\b\d{1,2}:\d{2}(:\d{2})?\b/g,                      // 14:35
  /\bN[º°]?\s*\d+\b/gi,                               // Nº 12345
  /\b\d{5,}\b/g,                                      // identificadores longos
]

/**
 * Chave estável de uma linha do extrato.
 *
 * Quando a descrição traz documento (é o caso do Pix), ele É a identidade —
 * muito mais confiável que o texto, que muda de banco para banco.
 */
export function chaveDaLinha(descricao) {
  const docs = documentosNoTexto(descricao)
  if (docs.length) return `doc:${docs[0].slice(0, 8)}`

  let texto = String(descricao || '')
  for (const re of VARIAVEL) texto = texto.replace(re, ' ')
  const limpo = normalizar(texto)
    .split(' ')
    .filter(p => p.length >= 3)
    .join(' ')
    .trim()
  return limpo ? `desc:${limpo}` : null
}

// A decisão que uma regra guarda. Nunca valor nem data — esses vêm da linha nova.
function decisaoDe(lanc) {
  const d = lanc?.data || {}
  return {
    tabela: lanc?.tabela || null,
    parte: d.supplier || d.client || '',
    cat: d.cat || '',
    subcat: d.subcat || '',
    doc_status: d.doc_status || '',
  }
}
const assinatura = d => [d.tabela, d.parte, d.cat, d.subcat, d.doc_status].join('||')

/**
 * Monta as regras a partir do que já foi conciliado.
 *
 * @param {Array} extratos     linhas de transacoes_extrato já conciliadas
 * @param {Array} lancamentos  lançamentos, com extrato_id apontando para elas
 * @returns {Map<string, object>} chave da linha → decisão a propor
 */
export function construirRegrasDeConciliacao(extratos, lancamentos) {
  const porExtrato = new Map()
  for (const l of lancamentos || []) {
    if (!l?.extrato_id) continue
    if (!porExtrato.has(l.extrato_id)) porExtrato.set(l.extrato_id, [])
    porExtrato.get(l.extrato_id).push(l)
  }

  const acc = new Map() // chave -> Map<assinatura, decisao>
  for (const e of extratos || []) {
    if (e?.status !== 'conciliado') continue
    // Aprender do que o próprio sistema propôs seria aprender com ele mesmo.
    if (e?.data?.conciliado_por === 'automatico') continue
    const ligados = porExtrato.get(e.id) || []
    // Uma linha que virou vários lançamentos não ensina nada simples.
    if (ligados.length !== 1) continue
    const chave = chaveDaLinha(e?.data?.descricao)
    if (!chave) continue
    const decisao = decisaoDe(ligados[0])
    if (!decisao.cat || !decisao.parte) continue // decisão incompleta não ensina
    const sig = assinatura(decisao)
    if (!acc.has(chave)) acc.set(chave, new Map())
    acc.get(chave).set(sig, decisao)
  }

  const regras = new Map()
  for (const [chave, assinaturas] of acc) {
    // Histórico divergente não vira regra: espera a decisão humana.
    if (assinaturas.size === 1) regras.set(chave, [...assinaturas.values()][0])
  }
  return regras
}

/** A decisão a propor para esta linha, ou null. */
export function regraParaLinha(descricao, regras) {
  if (!regras || regras.size === 0) return null
  const chave = chaveDaLinha(descricao)
  return chave ? regras.get(chave) || null : null
}

/** Frase curta explicando de onde a proposta veio. */
export function explicarRegra(regra) {
  if (!regra) return ''
  const partes = [regra.parte]
  if (regra.cat) partes.push(regra.cat)
  if (regra.subcat) partes.push(regra.subcat)
  return `Da última vez que esta cobrança apareceu, você lançou como ${partes.filter(Boolean).join(' · ')}.`
}
