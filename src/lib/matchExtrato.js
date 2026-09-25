// =============================================================================
// MOTOR DE CONCILIAÇÃO — o que é esta linha do extrato, e com o que ela casa.
//
// A versão anterior tinha UMA regra: valor idêntico. Medido nos dados reais,
// isso deixava 82% das linhas sem nenhuma sugestão — e boa parte delas nem
// tinha par possível, porque o lançamento nunca existiu (IOF, juros, tarifa).
//
// Aqui há duas perguntas, nesta ordem:
//
//   1. O QUE É a linha?  (classificarLinha)
//      Encargo do banco, pagamento de fatura, transferência entre contas suas,
//      ou movimento que deve casar com um lançamento. Procurar par para um IOF
//      é perder tempo: o certo ali é criar o lançamento.
//
//   2. COM O QUE ELA CASA?  (sugerirMatches)
//      Valor, nome de quem está do outro lado, documento escrito na descrição
//      do Pix, identificador do banco e data. Cada evidência soma, e a soma
//      vira uma frase em português explicando por que aquilo foi sugerido.
//
// Princípio: a diferença de valor só é tolerada quando há evidência forte de
// IDENTIDADE (nome ou documento). Juros e multa mudam o valor, não mudam quem
// recebeu. Sem essa evidência, valor diferente não é sugestão — é chute.
// =============================================================================

const MS_DIA = 86400000
const TOL_DIAS = 3
const TOL_CENTAVOS = 0.01
// Quanto o valor pode diferir quando já se sabe QUEM é (juros, multa, desconto).
const TOL_VALOR_PCT = 0.05
const TOL_VALOR_ABS = 150

// Palavras que aparecem em todo extrato e não identificam ninguém.
const RUIDO = new Set([
  'PAGAMENTO', 'PAGTO', 'RECEBIMENTO', 'PIX', 'TED', 'DOC', 'TRANSFERENCIA', 'TRANSF',
  'DEBITO', 'DEB', 'CREDITO', 'CRED', 'CONV', 'TIT', 'COMPE', 'EFETIVADO', 'AVULSO',
  'FAV', 'BOLETO', 'TARIFA', 'MENSALIDADE', 'AUTOMATICO', 'DEMAIS', 'EMPRESAS',
  'LTDA', 'EIRELI', 'EPP', 'COMERCIO', 'INDUSTRIA', 'SERVICOS', 'REFERENTE',
  'CONTA', 'BANCO', 'DAS', 'DOS',
])

// Encargos e serviços do próprio banco: nunca existe lançamento antes de
// acontecer, então o destino certo é criar — não procurar par.
const PADRAO_ENCARGO = /\b(IOF|JUROS|TARIFA|T A C|SEGURO PRESTAMISTA|ANUIDADE|MENSALIDADE|PEDAGIO|ESTACIONAMENTO|CESTA|MANUTENCAO DE CONTA|RENOVACAO LIMITE|ADIANT DEPOSITANTE|SALDO DEVEDOR)\b/
// Pagamento da fatura do cartão: é transferência da conta para o cartão.
const PADRAO_FATURA = /\b(PAGAMENTO DE CARTAO|PAGTO CARTAO|DEBITO AUTOMATICO CARTAO|PAGAMENTO CARTAO|FATURA CARTAO)\b/
// Movimento entre contas da própria empresa.
const PADRAO_TRANSFERENCIA = /\b(APLICACAO|RESGATE|TRANSFERENCIA ENTRE CONTAS|TRANSF ENTRE|POUPANCA)\b/
// Dinheiro que entra ou sai por empréstimo — não é receita nem despesa.
const PADRAO_EMPRESTIMO = /\b(CRED EMPRESTIMO|DEB EMPRESTIMO|CREDITO EMPRESTIMO|EMPRESTIMO|CONTA GARANTIDA)\b/

const cacheNormal = new Map()

/** Texto comparável: sem acento, maiúsculo, só letras e números. */
export function normalizar(texto) {
  const bruto = String(texto || '')
  if (cacheNormal.has(bruto)) return cacheNormal.get(bruto)
  const limpo = bruto
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
  if (cacheNormal.size < 5000) cacheNormal.set(bruto, limpo)
  return limpo
}

/** Palavras que servem para identificar alguém (4+ letras, fora o ruído). */
export function palavrasDeIdentidade(texto) {
  return normalizar(texto)
    .split(' ')
    .filter(p => p.length >= 4 && !RUIDO.has(p) && !/^\d+$/.test(p))
}

/** CNPJ e CPF escritos na descrição — é assim que o Pix identifica a parte. */
export function documentosNoTexto(texto) {
  const t = String(texto || '')
  const achados = new Set()
  const cnpj = /\d{2}[.\s]?\d{3}[.\s]?\d{3}[/\s]?\d{4}[-\s]?\d{2}/g
  const cpf = /\d{3}[.\s]?\d{3}[.\s]?\d{3}[-\s]?\d{2}/g
  for (const m of t.match(cnpj) || []) achados.add(m.replace(/\D/g, ''))
  for (const m of t.match(cpf) || []) {
    const so = m.replace(/\D/g, '')
    // Não guarda o "CPF" que na verdade é um pedaço de um CNPJ já achado.
    if (so.length === 11 && ![...achados].some(a => a.includes(so))) achados.add(so)
  }
  return [...achados]
}

/**
 * O que é esta linha do extrato?
 * @returns {{ tipo: string, rotulo: string, explicacao: string }}
 *   'encargo' | 'fatura' | 'transferencia' | 'emprestimo' | 'comum'
 */
export function classificarLinha(extrato) {
  const desc = normalizar(extrato?.descricao)
  if (PADRAO_FATURA.test(desc)) {
    return {
      tipo: 'fatura',
      rotulo: 'Pagamento da fatura do cartão',
      explicacao: 'Isto não casa com um lançamento: é a transferência desta conta para a conta do cartão.',
    }
  }
  if (PADRAO_EMPRESTIMO.test(desc)) {
    return {
      tipo: 'emprestimo',
      rotulo: 'Movimento de empréstimo',
      explicacao: 'Entrada ou saída de principal não é receita nem despesa — o lugar dela é o módulo de empréstimos.',
    }
  }
  if (PADRAO_TRANSFERENCIA.test(desc)) {
    return {
      tipo: 'transferencia',
      rotulo: 'Transferência entre contas',
      explicacao: 'Dinheiro trocando de lugar dentro da empresa: não é despesa nem receita.',
    }
  }
  if (PADRAO_ENCARGO.test(desc)) {
    return {
      tipo: 'encargo',
      rotulo: 'Encargo do banco',
      explicacao: 'Tarifa, juros ou imposto do próprio banco. Não existe lançamento esperando por isso — o certo é criar.',
    }
  }
  return { tipo: 'comum', rotulo: '', explicacao: '' }
}

// Quem está do outro lado do lançamento (fornecedor ou cliente).
const parteDo = c => c?.data?.supplier || c?.data?.client || c?.data?.parte || ''
// Documento da parte, onde quer que ele tenha sido gravado.
function docDo(c) {
  const gravado = String(
    c?.data?.cnpj || c?.data?.cnpj_parte || c?.data?.doc || c?.data?.emitente_cnpj || '',
  ).replace(/\D/g, '')
  if (gravado.length >= 11) return gravado
  // Microempresário costuma ter o CNPJ no PRÓPRIO nome ("57.077.301 FULANA DE
  // TAL"), que é como ele sai da nota fiscal e como aparece no Pix. Ali vem só
  // a raiz — os oito primeiros dígitos, que já identificam a empresa.
  const nome = parteDo(c)
  const completo = documentosNoTexto(nome)[0]
  if (completo) return completo
  const raiz = String(nome).match(/\b\d{2}[.\s]?\d{3}[.\s]?\d{3}\b/)
  return raiz ? raiz[0].replace(/\D/g, '') : ''
}

/** Mesmo documento? Com raiz de CNPJ dos dois lados, compara a raiz. */
function mesmoDocumento(a, b) {
  const x = String(a || '').replace(/\D/g, '')
  const y = String(b || '').replace(/\D/g, '')
  if (x.length < 8 || y.length < 8) return false
  if (x.length >= 14 && y.length >= 14) return x === y
  return x.slice(0, 8) === y.slice(0, 8)
}

/**
 * Sugestões de lançamento para uma linha do extrato.
 *
 * @param {object} extrato    { tipo, valor, data, descricao, cnpj?, fit_id? }
 * @param {Array}  candidatos lançamentos disponíveis (payable ou receivable)
 * @param {object} [opcoes]   { pessoas: [{nome, doc}] } para identificar pelo documento
 * @returns {Array<{lancamento, score, motivo, confianca, dentroTol}>}
 */
export function sugerirMatches(extrato, candidatos, opcoes = {}) {
  if (!extrato || !candidatos?.length) return []
  const valor = Math.abs(Number(extrato.valor))
  if (!Number.isFinite(valor)) return []

  const dataExt = extrato.data ? new Date(String(extrato.data).slice(0, 10) + 'T12:00:00') : null
  const descNormal = normalizar(extrato.descricao)
  const palavrasExtrato = palavrasDeIdentidade(extrato.descricao)
  const docsExtrato = new Set([
    ...documentosNoTexto(extrato.descricao),
    ...(extrato.cnpj ? [String(extrato.cnpj).replace(/\D/g, '')] : []),
  ])

  // O documento pode estar só no cadastro de pessoas: se o nome da parte é
  // conhecido e o documento dela aparece no extrato, isso identifica a parte.
  const docPorNome = new Map()
  for (const p of opcoes.pessoas || []) {
    const doc = String(p?.doc || p?.data?.doc || '').replace(/\D/g, '')
    const nome = p?.nome || p?.data?.nome || ''
    if (doc.length >= 11 && nome) docPorNome.set(normalizar(nome), doc)
  }

  const resultados = []
  for (const c of candidatos) {
    const cVal = Math.abs(Number(c.value ?? c.data?.value))
    if (!Number.isFinite(cVal)) continue

    const parte = parteDo(c)
    const parteNormal = normalizar(parte)
    const evidencias = []
    let score = 0

    // ── Identidade: quem está do outro lado ────────────────────────────────
    const docLanc = docDo(c) || docPorNome.get(parteNormal) || ''
    const docBate = docLanc.length >= 8 && [...docsExtrato].some(d => mesmoDocumento(d, docLanc))
    if (docBate) {
      score += 50
      evidencias.push('documento confere')
    }

    const palavrasParte = palavrasDeIdentidade(parte)
    const emComum = palavrasParte.filter(p => palavrasExtrato.includes(p) || descNormal.includes(p))
    const nomeBate = emComum.length > 0
    if (nomeBate) {
      score += emComum.length > 1 ? 35 : 25
      evidencias.push(`nome confere (${emComum.slice(0, 2).join(', ').toLowerCase()})`)
    }

    // Mesmo identificador do banco: é a MESMA transação, não há o que discutir.
    const mesmoId = extrato.fit_id && c.data?.fit_id_ofx
      && String(c.data.fit_id_ofx) === String(extrato.fit_id)
    if (mesmoId) {
      score += 80
      evidencias.push('mesmo identificador no banco')
    }

    // ── Valor ──────────────────────────────────────────────────────────────
    const difValor = Math.abs(cVal - valor)
    const valorIgual = difValor <= TOL_CENTAVOS
    const temIdentidade = docBate || nomeBate || mesmoId
    const toleraDiferenca = Math.max(TOL_VALOR_ABS, valor * TOL_VALOR_PCT)
    const valorPerto = !valorIgual && temIdentidade && difValor <= toleraDiferenca

    if (valorIgual) {
      score += 40
      evidencias.push('valor exato')
    } else if (valorPerto) {
      // Só entra porque já se sabe QUEM é. Juros e multa mudam o valor.
      score += 12
      evidencias.push(`valor difere em ${moeda(difValor)} — juros, multa ou desconto?`)
    } else {
      continue // sem valor igual e sem identidade, não é sugestão: é chute
    }

    // ── Data: não elimina ninguém, só ordena ───────────────────────────────
    const refData = c.data?.data_pagamento || c.due || c.data?.due || c.created || c.data?.created
    const dataLanc = refData ? new Date(String(refData).slice(0, 10) + 'T12:00:00') : null
    const diffDias = dataExt && dataLanc ? Math.abs(dataExt - dataLanc) / MS_DIA : Infinity
    if (diffDias < 0.5) { score += 20; evidencias.push('mesmo dia') }
    else if (diffDias <= TOL_DIAS) { score += 12; evidencias.push(`${Math.round(diffDias)} dia(s) de diferença`) }
    else if (Number.isFinite(diffDias) && diffDias <= 30) { score += 4; evidencias.push(`${Math.round(diffDias)} dias de diferença`) }
    else if (Number.isFinite(diffDias)) evidencias.push(`${Math.round(diffDias)} dias de diferença`)

    // Confiança alta = dá para conciliar sem pensar muito. É o que alimenta a
    // conciliação automática, então o critério é duro de propósito.
    const confianca = (mesmoId || (valorIgual && (docBate || nomeBate)) || (valorIgual && diffDias <= TOL_DIAS))
      ? 'alta'
      : score >= 45 ? 'media' : 'baixa'

    resultados.push({
      lancamento: c,
      score,
      confianca,
      motivo: evidencias.join(' · '),
      // Mantido com o nome antigo: a tela usa isto para separar o que mostra
      // como sugestão do que mostra como "mesmo valor, data diferente".
      dentroTol: confianca === 'alta',
    })
  }

  return resultados.sort((a, b) => b.score - a.score)
}

/**
 * Combinações de lançamentos que somam o valor da linha — o caso do pagamento
 * único que quita várias contas do mesmo fornecedor.
 *
 * Só considera lançamentos da MESMA parte, e no máximo `maxItens` por
 * combinação: sem isso, qualquer valor acha uma soma por acaso.
 */
export function sugerirCombinacoes(extrato, candidatos, { maxItens = 3, maxSugestoes = 5 } = {}) {
  const alvo = Math.abs(Number(extrato?.valor))
  if (!Number.isFinite(alvo) || !candidatos?.length) return []

  const porParte = new Map()
  for (const c of candidatos) {
    const chave = normalizar(parteDo(c))
    if (!chave) continue
    if (!porParte.has(chave)) porParte.set(chave, [])
    porParte.get(chave).push(c)
  }

  const achados = []
  for (const [, lista] of porParte) {
    if (lista.length < 2) continue
    // Ordenar ajuda a cortar cedo: passou do alvo, não adianta somar mais.
    const ordenada = [...lista].sort((a, b) => Math.abs(Number(a.value)) - Math.abs(Number(b.value)))
    const combinar = (inicio, atual, soma) => {
      if (achados.length >= maxSugestoes) return
      if (Math.abs(soma - alvo) <= TOL_CENTAVOS && atual.length >= 2) {
        achados.push({
          lancamentos: [...atual],
          soma,
          motivo: `${atual.length} contas de ${parteDo(atual[0]) || 'mesma parte'} somam ${moeda(soma)}`,
        })
        return
      }
      if (atual.length >= maxItens || soma > alvo + TOL_CENTAVOS) return
      for (let i = inicio; i < ordenada.length; i++) {
        const v = Math.abs(Number(ordenada[i].value))
        if (!Number.isFinite(v)) continue
        atual.push(ordenada[i])
        combinar(i + 1, atual, +(soma + v).toFixed(2))
        atual.pop()
      }
    }
    combinar(0, [], 0)
  }
  return achados
}

function moeda(v) {
  return 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
