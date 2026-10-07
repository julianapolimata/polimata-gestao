// =============================================================================
// DEBITO E ESTORNO NO MESMO DIA: UM PAR QUE SE ANULA.
//
// O banco cobra e devolve. "DEB.CONV.DEMAIS EMPRESAS R$ 2.836,09" sai e, no
// mesmo dia, "ESTORNO DEB.CONV.DEMAIS EMPRESAS R$ 2.836,09" volta. Do ponto de
// vista da empresa NÃO ACONTECEU NADA -- não há despesa, não há receita, não há
// o que classificar.
//
// Mas as duas linhas chegam pendentes, e cada uma cobra uma decisão. No extrato
// da Polimata são 10 pares: 20 decisões para chegar a lugar nenhum. Esse tipo
// de trabalho inutil e o que faz a pessoa desistir no meio do fechamento.
//
// O PAREAMENTO É ESTRITO DE PROPÓSITO. Anular por engano um debito de verdade
// esconde dinheiro que saiu, e esconder é pior que mostrar demais. Por isso
// exigimos as CINCO coisas ao mesmo tempo:
//   1. mesma conta
//   2. mesmo dia (exato, não "próximo de")
//   3. mesmo valor (em centavos inteiros)
//   4. sentidos opostos (uma saida, uma entrada)
//   5. a descrição do estorno = "ESTORNO" + a descrição do débito
//
// A regra 5 é a que dá segurança. Sem ela, dois pagamentos de mesmo valor no
// mesmo dia -- um para um fornecedor, outro recebido de um cliente — virariam
// "par" e sumiriam os dois.
// =============================================================================

/** Centavos inteiros: comparar dinheiro em decimal deixa passar um centavo. */
const centavos = v => Math.round(Math.abs(Number(v) || 0) * 100)

const textoDe = e => String(e?.data?.descricao ?? '').trim()
const diaDe = e => String(e?.data?.data ?? '').slice(0, 10)
const sentidoDe = e => String(e?.data?.tipo ?? '')
const valorDe = e => centavos(e?.data?.valor)

/** Maiúscula, sem acento e sem espaço repetido — o OFX varia na pontuação. */
export function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
}

/** A linha se anuncia como estorno? */
export function ehEstorno(texto) {
  return /^ESTORNO\b/.test(normalizar(texto))
}

/** O que sobra da descrição depois de tirar o "ESTORNO" da frente. */
export function semEstorno(texto) {
  return normalizar(texto).replace(/^ESTORNO\s*/, '')
}

/**
 * Acha os pares débito × estorno dentro das linhas PENDENTES.
 *
 * Cada linha entra em no máximo um par: se o mesmo debito aparece duas vezes
 * no dia e há só um estorno, só um dos dois é anulado — o outro continua
 * pendente, que é o correto (um deles realmente saiu).
 *
 * @returns {Array<{ debito, estorno, valor, data, descricao }>}
 */
export function acharParesEstorno(linhas) {
  const pendentes = (linhas || []).filter(e => (e?.status || 'pendente') === 'pendente')
  const estornos = pendentes.filter(e => ehEstorno(textoDe(e)))
  const debitos = pendentes.filter(e => !ehEstorno(textoDe(e)))

  const usados = new Set()
  const pares = []

  for (const est of estornos) {
    const alvo = semEstorno(textoDe(est))
    const par = debitos.find(d =>
      !usados.has(d.id)
      && d.conta_id === est.conta_id
      && diaDe(d) === diaDe(est)
      && valorDe(d) === valorDe(est)
      && sentidoDe(d) !== sentidoDe(est)
      && sentidoDe(d) !== '' && sentidoDe(est) !== ''
      && normalizar(textoDe(d)) === alvo
      && alvo !== '',
    )
    if (!par) continue
    usados.add(par.id); usados.add(est.id)
    pares.push({
      debito: par,
      estorno: est,
      valor: Math.abs(Number(par.data?.valor) || 0),
      data: diaDe(par),
      descricao: textoDe(par),
    })
  }

  return pares.sort((a, b) => a.data.localeCompare(b.data))
}

/** Quantas linhas e quanto dinheiro os pares tiram da fila. */
export function resumoDosPares(pares) {
  const ps = pares || []
  return {
    pares: ps.length,
    linhas: ps.length * 2,
    valor: ps.reduce((s, p) => s + p.valor, 0),
  }
}

/** O motivo que fica gravado na linha arquivada — auditável, com o par citado. */
export function motivoDoPar(par) {
  const dia = String(par?.data || '').split('-').reverse().join('/')
  return `Débito e estorno no mesmo dia (${dia}), mesmo valor e mesma descricao: as duas linhas se anulam e não viram lançamento.`
}
