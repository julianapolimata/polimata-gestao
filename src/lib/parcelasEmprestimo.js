// =============================================================================
// AS PARCELAS DE UM EMPRÉSTIMO, EM CONTAS A PAGAR.
//
// Por que isto deixou de morar dentro do modal: a mesma montagem é precisa em
// dois momentos — quando o empréstimo é criado, e quando um empréstimo que já
// existe ainda não tem as suas parcelas lançadas. Duas cópias da mesma regra
// é a forma mais barata de as duas divergirem.
//
// A REGRA QUE ISTO SUSTENTA (C6): "parcelas pagas" não é campo digitado. Uma
// parcela está paga quando o pagamento dela foi CONCILIADO contra o extrato —
// e é a conciliação que marca a linha como paga. Enquanto as parcelas não
// existirem em Contas a Pagar, não há o que conciliar, e o sistema não tem
// saldo apurado para mostrar.
//
// Foi o que aconteceu: os três contratos carregavam R$ 38.345,11 vindos do
// número digitado no cadastro, com o Parcelamento do Simples Nacional em zero
// de 36 parcelas pagas, apesar dos pagamentos estarem no extrato.
//
// Cada parcela vira DUAS linhas quando o cronograma separa amortização de
// juros: o principal fica fora do resultado (é dívida sendo devolvida) e só o
// juro é despesa. Sem essa separação, uma linha só, tratada como amortização —
// melhor não ter o juro do que inventar um.
// =============================================================================

/**
 * @param {object} emprestimo  o registro, com `data.parcelas` (o cronograma)
 * @param {string} [hoje]      data de criação das linhas, YYYY-MM-DD
 * @returns {Array<object>}    as linhas de `payable`, sem código (quem numera
 *                             é o banco, para não haver dois com o mesmo)
 */
export function linhasDeParcelas(emprestimo, hoje = new Date().toISOString().slice(0, 10)) {
  const d = emprestimo?.data || emprestimo || {}
  const parcelas = Array.isArray(d.parcelas) ? d.parcelas : []
  const nome = String(d.nome || '').trim()
  const credor = String(d.credor || '').trim()
  const total = Number(d.parcelas_total) || parcelas.length
  const agora = new Date().toISOString()
  const linhas = []

  for (const p of parcelas) {
    const amort = Number(p.amortizacao) || 0
    const jur = Number(p.juros) || 0
    const base = {
      supplier: credor || nome,
      // O VÍNCULO, e não só o nome. Sem ele, a parcela aponta para um texto:
      // a ficha do credor não mostra a dívida, o total por fornecedor não
      // soma, e renomear o cadastro desliga a ligação sem avisar.
      ...(d.pessoa_id ? { pessoa_id: d.pessoa_id } : {}),
      due: p.vencimento,
      data_competencia: p.vencimento,
      // O cronograma pode trazer parcelas já quitadas antes de o sistema
      // existir. Isso é história, e entra como história; daqui para a frente
      // quem marca "Pago" é a conciliação.
      status: p.pago ? 'Pago' : 'Pendente',
      data_pagamento: p.pago ? p.vencimento : null,
      cat: 'Empréstimos e Financiamentos',
      forma_pagamento: 'Débito Automático',
      parcela_atual: Number(p.numero) || 0,
      parcela_total: total,
      criado_via_emprestimo: true,
      // Categoria vem do sistema e o contrato é o documento: a linha nasce
      // aceita e não entra na fila de escrituração — seriam 72 por contrato.
      escriturado: true, escriturado_em: agora, escriturado_por: 'sistema',
      doc_status: 'dispensado', doc_motivo_dispensa: 'Contrato de empréstimo', sem_documento: false,
      created: hoje,
    }
    if (amort > 0 || jur > 0) {
      if (amort > 0) {
        linhas.push({ ...base,
          desc: `${nome} — parcela ${p.numero}/${total} (amortização)`,
          value: amort, subcat: 'Amortização do principal (saída)' })
      }
      if (jur > 0) {
        linhas.push({ ...base,
          desc: `${nome} — parcela ${p.numero}/${total} (juros)`,
          value: jur, subcat: 'Juros de empréstimos' })
      }
    } else {
      linhas.push({ ...base,
        desc: `${nome} — parcela ${p.numero}/${total}`,
        value: Number(p.valor) || 0, subcat: 'Amortização do principal (saída)' })
    }
  }
  return linhas
}

/**
 * O saldo APURADO de um contrato: a soma das parcelas que ainda não foram
 * conciliadas. Sem parcelas lançadas, devolve null — e null não é zero: é
 * "não há saldo apurado", que é uma informação diferente e que a tela mostra
 * como tal, em vez de repetir o número que alguém digitou um dia.
 */
export function saldoApurado(consolidado) {
  if (!consolidado || !consolidado.linhas) return null
  return Number(consolidado.saldo) || 0
}

export default linhasDeParcelas
