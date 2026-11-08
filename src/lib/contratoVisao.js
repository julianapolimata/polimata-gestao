// =============================================================================
// PRINCIPAL E JUROS, PREVISTO E REALIZADO.
//
// A decisão dela, 08/11/2026: "coloca em duas caixinhas, principal e juros.
// Aí, conforme eu for lançando, vai ajustando. Previsto e realizado."
//
// POR QUE DUAS CAIXAS, E NÃO UM NÚMERO SÓ: as duas coisas têm natureza
// diferente e vivem em lugares diferentes do resultado.
//
//   PRINCIPAL  é dívida sendo devolvida. Não é despesa: sai do caixa e abate
//              o passivo. Fica fora da DRE.
//   JUROS      são o custo de carregar a dívida. São despesa financeira, e
//              viram despesa conforme o tempo passa — nunca antes.
//
// Somar os dois num campo chamado "saldo" misturaria o que a empresa DEVE com
// o que ela VAI PAGAR para poder dever. O saldo devedor é só o principal.
//
// POR QUE PREVISTO E REALIZADO: o contrato diz o que está previsto. O que
// aconteceu de verdade vem da conciliação — e os dois divergem, por motivo
// legítimo: juros de mora, multa, desconto por antecipação, amortização
// extraordinária. A tela mostra os dois lado a lado em vez de escolher um.
//
// O CASO QUE ISTO RESOLVE: dois dos três contratos (o Parcelamento
// Simplificado RFB e o do Simples Nacional) vieram com a parcela cheia, sem
// abrir amortização e juros. O cronograma não separa, e inventar a separação
// seria pior que não tê-la. Mas a CONCILIAÇÃO separa: quando ela concilia o
// pagamento e tipa a diferença como "Juros/Multa", aquilo é juro medido, não
// estimado. Então o previsto fica vazio e o realizado se forma sozinho,
// pagamento a pagamento.
// =============================================================================

const num = v => Number(v || 0)
const ehJuros = l => String(l.subcat || '').toLowerCase().startsWith('juros')
  || String(l.ajuste_tipo || '') === 'juros'
const ehPago = l => l.st === 'Pago' || l.st === 'Recebido'

/**
 * Consolida as linhas de Contas a Pagar por contrato.
 *
 * @param {Array} linhas  linhas de `payable` com emprestimo_id, trazendo
 *                        { id, emprestimo_id, due, st, val, num, subcat,
 *                          ajuste_tipo }
 * @returns {Object} emprestimo_id → consolidado
 */
export function consolidarContratos(linhas) {
  const porEmp = new Map()
  for (const l of linhas || []) {
    if (!l.emprestimo_id) continue
    if (!porEmp.has(l.emprestimo_id)) {
      porEmp.set(l.emprestimo_id, {
        linhas: 0, proxima: null, nums: new Map(),
        principalPrevisto: 0, principalPago: 0,
        jurosPrevisto: 0, jurosPago: 0,
        // Juro que não estava no cronograma: nasceu na conciliação. É ele que
        // dá conteúdo à caixa de juros dos contratos que não separam.
        jurosDeConciliacao: 0,
        temJurosNoCronograma: false,
      })
    }
    const e = porEmp.get(l.emprestimo_id)
    const pago = ehPago(l)
    const val = num(l.val)
    const juros = ehJuros(l)
    // Qualquer linha nascida na conciliação é ajuste, e ajuste não é parcela.
    // Uma tarifa bancária cobrada junto com a parcela fica ligada ao contrato
    // — é verdade, e é útil —, mas ela não é amortização de nada. Sem esta
    // guarda ela entraria no principal e inflaria o saldo devedor.
    const ehAjuste = !!String(l.ajuste_tipo || '')
    const deConciliacao = String(l.ajuste_tipo || '') === 'juros'

    e.linhas += 1
    if (juros) {
      if (deConciliacao) {
        // Juro medido na conciliação: nunca foi previsto, e só conta como
        // realizado quando a linha está liquidada. Somá-lo também em
        // `jurosPago` contaria o mesmo dinheiro duas vezes.
        if (pago) e.jurosDeConciliacao += val
      } else {
        e.temJurosNoCronograma = true
        e.jurosPrevisto += val
        if (pago) e.jurosPago += val
      }
    } else if (!ehAjuste) {
      e.principalPrevisto += val
      if (pago) e.principalPago += val
    }

    if (!pago && l.due && (!e.proxima || l.due < e.proxima)) e.proxima = l.due

    // Contagem por NÚMERO da parcela: uma parcela que virou duas linhas
    // (amortização e juros) continua sendo uma parcela. O ajuste nascido na
    // conciliação não é parcela de contrato nenhum, e não conta.
    if (!ehAjuste) {
      const chave = l.num != null && l.num !== '' ? String(l.num) : `linha:${l.id}`
      const atual = e.nums.get(chave) || { pago: true }
      atual.pago = atual.pago && pago
      e.nums.set(chave, atual)
    }
  }

  const saida = {}
  for (const [id, e] of porEmp) {
    let pagas = 0
    for (const n of e.nums.values()) if (n.pago) pagas += 1
    saida[id] = {
      linhas: e.linhas,
      total: e.nums.size,
      pagas,
      proxima: e.proxima,
      principal: {
        previsto: round(e.principalPrevisto),
        realizado: round(e.principalPago),
        emAberto: round(e.principalPrevisto - e.principalPago),
      },
      juros: {
        // Vazio quando o contrato não abre os juros. Vazio é diferente de
        // zero: zero afirma que não há juros, e o contrato não disse isso.
        previsto: e.temJurosNoCronograma ? round(e.jurosPrevisto) : null,
        realizado: round(e.jurosPago + e.jurosDeConciliacao),
        emAberto: e.temJurosNoCronograma ? round(e.jurosPrevisto - e.jurosPago) : null,
        // Quanto do juro realizado veio da conciliação, e não do cronograma.
        medidoNaConciliacao: round(e.jurosDeConciliacao),
      },
    }
  }
  return saida
}

function round(v) { return Math.round((Number(v) || 0) * 100) / 100 }

export default consolidarContratos

/**
 * As parcelas de um contrato, uma por linha da tela, em ordem.
 *
 * Por que agrupar: uma parcela vira DUAS linhas em Contas a Pagar quando o
 * cronograma separa amortização de juros. O Sicoob tem 72 linhas para 36
 * parcelas. Listar as linhas cruas faria a parcela 1 aparecer duas vezes, com
 * dois valores que não são o valor dela.
 *
 * O que fica de fora do agrupamento: os ajustes nascidos na conciliação
 * (juros de mora, tarifa). Eles pertencem ao contrato, mas não a uma parcela
 * do cronograma — então viram linhas próprias, no fim, marcadas como ajuste.
 *
 * @param {Array} linhas  de `payable`, com { id, due, st, val, num, subcat,
 *                        ajuste_tipo, conciliado_em, ajuste_historico,
 *                        data_pagamento, data_pagamento_presumida, codigo }
 */
export function parcelasDoContrato(linhas) {
  const porNumero = new Map()
  const ajustes = []

  for (const l of linhas || []) {
    const val = num(l.val)
    const pago = ehPago(l)
    if (String(l.ajuste_tipo || '')) {
      ajustes.push({
        ajuste: true,
        tipo: String(l.ajuste_tipo),
        codigo: l.codigo || '',
        vencimento: l.due || '',
        principal: 0,
        juros: ehJuros(l) ? val : 0,
        outros: ehJuros(l) ? 0 : val,
        total: val,
        pago,
        conciliadoEm: l.conciliado_em || null,
      })
      continue
    }
    const chave = l.num != null && l.num !== '' ? String(l.num) : `linha:${l.id}`
    if (!porNumero.has(chave)) {
      porNumero.set(chave, {
        numero: Number(l.num) || null,
        codigos: [],
        vencimento: l.due || '',
        principal: 0, juros: 0, outros: 0, total: 0,
        pago: true,
        conciliadoEm: null,
        // O ajuste de história: a parcela foi dada como paga porque venceu
        // antes do recorte, e o extrato daquele período não entra. Quem olhar
        // a lista precisa ver que ali não houve conciliação.
        ajusteHistorico: false,
        pagamentoPresumido: false,
        pagoEm: null,
      })
    }
    const p = porNumero.get(chave)
    if (l.codigo) p.codigos.push(l.codigo)
    if (ehJuros(l)) p.juros += val
    else p.principal += val
    p.total += val
    p.pago = p.pago && pago
    if (l.conciliado_em && !p.conciliadoEm) p.conciliadoEm = l.conciliado_em
    if (l.ajuste_historico === true || l.ajuste_historico === 'true') p.ajusteHistorico = true
    if (l.data_pagamento_presumida === true || l.data_pagamento_presumida === 'true') p.pagamentoPresumido = true
    if (l.data_pagamento && !p.pagoEm) p.pagoEm = l.data_pagamento
    // O vencimento é o mesmo nas duas linhas da parcela; o menor, se divergirem.
    if (l.due && (!p.vencimento || l.due < p.vencimento)) p.vencimento = l.due
  }

  const parcelas = [...porNumero.values()].map(p => ({
    ...p,
    principal: round(p.principal), juros: round(p.juros), total: round(p.total),
  }))
  parcelas.sort((a, b) => {
    if (a.numero && b.numero) return a.numero - b.numero
    return String(a.vencimento).localeCompare(String(b.vencimento))
  })
  ajustes.sort((a, b) => String(a.vencimento).localeCompare(String(b.vencimento)))
  return { parcelas, ajustes }
}
