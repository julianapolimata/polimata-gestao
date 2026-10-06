// =============================================================================
// JUNTAR LINHAS DO EXTRATO PARA UMA BAIXA SÓ.
//
// O pró-labore da Polímata não sai num Pix só: "vou transferindo picado". São
// 24 Pix somando R$ 73.160 em oito meses, nenhum conciliado, porque toda
// conciliação tratava UMA linha de cada vez.
//
// E o dinheiro que sai não tem uma natureza só: parte é PRÓ-LABORE, que conta
// no Fator R, e parte é ANTECIPAÇÃO DE LUCRO, que não conta. Essa divisão é o
// que decide o anexo do Simples — e uma diferença de mais de R$ 15 mil por ano.
// Por isso não basta somar as linhas: é preciso dizer quanto de cada natureza.
//
// A regra que atravessa tudo: a soma das partes tem que fechar EXATAMENTE a
// soma das linhas. Conciliação que não fecha não é conciliação — é uma conta
// com sobra escondida dentro.
// =============================================================================

/** Centavos inteiros: comparar dinheiro em decimal deixa passar um centavo. */
const centavos = v => Math.round(Math.abs(Number(v) || 0) * 100)

const valorDaLinha = l => Number(l?.valor ?? l?.data?.valor ?? 0)
const dataDaLinha = l => String(l?.data?.data ?? l?.dt ?? l?.data ?? '').slice(0, 10)

/** Quanto somam as linhas selecionadas, em reais. */
export function somarLinhas(linhas) {
  return (linhas || []).reduce((s, l) => s + Math.abs(valorDaLinha(l)), 0)
}

/** A linha mais antiga do grupo — é ela que dá a data de referência da baixa. */
export function linhaAncora(linhas) {
  const ordenadas = [...(linhas || [])].sort((a, b) => dataDaLinha(a).localeCompare(dataDaLinha(b)))
  return ordenadas[0] || null
}

/**
 * Dá para juntar estas linhas?
 *
 * Só linhas da MESMA conta e do MESMO sentido: somar uma entrada com uma saída
 * daria um total que não existiu em lugar nenhum.
 *
 * @returns {string|null} o motivo do impedimento, ou null se dá.
 */
export function podeJuntar(linhas) {
  const ls = linhas || []
  if (ls.length < 2) return 'Marque pelo menos duas parcelas deste pagamento.'
  const contas = new Set(ls.map(l => l.conta_id))
  if (contas.size > 1) return 'As parcelas são de contas diferentes — só é possível reunir parcelas da mesma conta.'
  const sentidos = new Set(ls.map(l => l?.data?.tipo ?? l?.tipo))
  if (sentidos.size > 1) return 'Há entradas e saídas misturadas — um pagamento só tem um sentido.'
  if (ls.some(l => (l.status || 'pendente') !== 'pendente')) return 'Uma das parcelas já foi conciliada — recarregue a tela.'
  return null
}

/**
 * A divisão fecha a soma das linhas?
 *
 * `partes` é como o dinheiro se reparte: [{ cat, subcat, valor }]. No caso do
 * pró-labore são duas — pró-labore e antecipação de lucro —, mas a função não
 * sabe nem precisa saber quais: ela cobra que tudo tenha natureza e que a
 * soma feche.
 *
 * @returns {string|null} o motivo do impedimento, ou null se fecha.
 */
export function validarDivisao({ linhas, partes }) {
  const impedimento = podeJuntar(linhas)
  if (impedimento) return impedimento

  // As mensagens são lidas por quem está classificando dinheiro, não por quem
  // escreveu o código: dizem o que fazer, não o que está errado.
  const ps = partes || []
  if (!ps.length) return 'Diga em que esse valor se divide — comece por uma natureza.'
  if (ps.some(p => !String(p?.cat || '').trim())) {
    return 'Falta escolher a categoria de uma das naturezas: é ela que diz se o valor conta no Fator R.'
  }
  if (ps.some(p => centavos(p?.valor) === 0)) {
    return 'Uma das naturezas está sem valor — preencha ou remova a linha.'
  }

  const totalLinhas = centavos(somarLinhas(linhas))
  const totalPartes = ps.reduce((s, p) => s + centavos(p.valor), 0)
  if (totalPartes !== totalLinhas) {
    const falta = (totalLinhas - totalPartes) / 100
    return falta > 0
      ? `Faltam R$ ${falta.toFixed(2).replace('.', ',')} para fechar o valor do pagamento.`
      : `Sobram R$ ${Math.abs(falta).toFixed(2).replace('.', ',')} além do valor do pagamento.`
  }
  return null
}

/**
 * Monta o que vai para o banco: um lançamento por natureza, todos já
 * liquidados na data da ÚLTIMA linha (é quando o pagamento terminou de sair).
 *
 * Devolve o formato que `conciliar_varias_linhas` espera em `p_ajustes`.
 */
export function montarLancamentos({ linhas, partes, tabela = 'payable', parte: nomeDaParte, hoje }) {
  const ls = [...(linhas || [])].sort((a, b) => dataDaLinha(a).localeCompare(dataDaLinha(b)))
  const primeira = dataDaLinha(ls[0])
  const ultima = dataDaLinha(ls[ls.length - 1])
  const competencia = ultima.slice(0, 7) + '-01'
  const quantas = ls.length

  return (partes || []).map(p => ({
    tabela,
    data: {
      [tabela === 'receivable' ? 'client' : 'supplier']: nomeDaParte || 'Não identificado',
      desc: `${p.cat}${p.subcat ? ` · ${p.subcat}` : ''} — ${quantas} transferência(s) entre ${primeira.split('-').reverse().join('/')} e ${ultima.split('-').reverse().join('/')}`,
      value: Math.abs(Number(p.valor) || 0),
      cat: p.cat,
      subcat: p.subcat || '',
      data_competencia: competencia,
      due: ultima,
      data_pagamento: ultima,
      status: tabela === 'receivable' ? 'Recebido' : 'Pago',
      // A natureza dispensa nota: o documento é o extrato e o recibo.
      doc_status: 'dispensado',
      doc_motivo_dispensa: 'Pagamento a pessoa física, transferido em parcelas — o documento é o extrato e o recibo.',
      sem_documento: false,
      // Escriturar é decisão dela; aqui só se registra o que o dinheiro foi.
      created: hoje || new Date().toISOString().slice(0, 10),
      notes: `Baixa agrupada de ${quantas} linha(s) do extrato.`,
      // Marca para o desfazer: estes lançamentos NASCERAM do agrupamento, então
      // desfazer tem que apagá-los — devolvê-los a "Pendente" deixaria uma
      // conta a pagar que nunca existiu.
      criado_via_agrupamento: true,
    },
  }))
}
