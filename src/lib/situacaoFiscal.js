// =============================================================================
// A SITUAÇÃO FISCAL COM QUE UM LANÇAMENTO NASCE.
//
// Três estados, e eles respondem a uma pergunta só: existe nota fiscal para
// este desembolso, e onde ela está?
//
//   vinculado   a nota existe e está aqui;
//   pendente    a nota existe e ainda não chegou;
//   dispensado  não há nota a emitir, e o motivo fica escrito.
//
// ── O CASO DO BOLETO (C8) ───────────────────────────────────────────────────
//
// Até 09/11/2026, tudo que não fosse guia ou folha nascia "vinculado". Boleto
// incluído. Isso afirma que a nota está anexada — quando o que está anexado é
// um boleto, que é INSTRUÇÃO DE PAGAMENTO, não documento fiscal.
//
// E não dá para resolver com uma regra que vale para todos, porque os dois
// casos reais dela se contradizem:
//
//   a ACIAS      só emite boleto. Nota não virá nunca, e "dispensado" é a
//                verdade — com o motivo escrito.
//   a JL Ramos   emite nota. O boleto chega antes; a nota vem depois. Aqui
//                "pendente" é a verdade, e fechar como "vinculado" faria a
//                nota, quando chegasse, não ter onde entrar.
//
// Mesmo documento, duas respostas certas. Quem sabe qual é o fornecedor é
// ela — então o sistema não decide: deixa a situação EM ABERTO e manda o
// lançamento para a Escrituração, que é onde a decisão mora. Decidido uma vez
// por fornecedor, a regra aprendida passa a repetir aquilo sozinha.
//
// Nascer sem situação fiscal não é lançamento incompleto: é lançamento
// honesto. O incompleto era nascer afirmando que tem nota.
// =============================================================================

/** Documentos que SÃO o próprio comprovante: não há nota fiscal a emitir. */
export const SEM_NOTA_FISCAL = {
  DAS: 'Guia de tributo: o documento é a própria guia, não há nota fiscal.',
  DARF: 'Guia de tributo: o documento é a própria guia, não há nota fiscal.',
  GPS: 'Guia previdenciária: o documento é a própria guia, não há nota fiscal.',
  GNRE: 'Guia de tributo: o documento é a própria guia, não há nota fiscal.',
  FOLHA: 'Folha de pagamento: o documento é o recibo, não há nota fiscal a emitir.',
  'PRÓ-LABORE': 'Retirada de sócio: o documento é o recibo, não há nota fiscal a emitir.',
  'PRO-LABORE': 'Retirada de sócio: o documento é o recibo, não há nota fiscal a emitir.',
}

/**
 * Documentos que não decidem sozinhos: provam o pagamento, não o faturamento.
 * Fatura entra junto pelo mesmo motivo — ela cobra, e a nota é outra coisa.
 */
export const NAO_DECIDEM_SOZINHOS = {
  BOLETO: 'O documento anexado é um boleto, que é instrução de pagamento e não documento fiscal.'
    + ' Se este fornecedor emite nota, ela ainda vai chegar; se não emite, marque como dispensado'
    + ' e escreva o motivo.',
  FATURA: 'O documento anexado é uma fatura, que cobra o pagamento e não substitui a nota fiscal.'
    + ' Se este fornecedor emite nota, ela ainda vai chegar.',
}

const chave = d => String(d?.tipo_documento || '').trim().toUpperCase()

/**
 * Com que situação fiscal este lançamento deve nascer.
 *
 * @returns {{doc_status: string, doc_motivo_dispensa?: string, fiscal_em_aberto?: boolean,
 *            fiscal_motivo_aberto?: string}}
 *   `doc_status` vazio = em aberto, por decisão. A tela usa
 *   `fiscal_motivo_aberto` para dizer por que não decidiu.
 */
export function situacaoFiscalDe(d) {
  const tipo = chave(d)
  const motivoDispensa = SEM_NOTA_FISCAL[tipo]
  if (motivoDispensa) return { doc_status: 'dispensado', doc_motivo_dispensa: motivoDispensa }

  const porQueNaoDecido = NAO_DECIDEM_SOZINHOS[tipo]
  if (porQueNaoDecido) {
    return {
      doc_status: '',
      fiscal_em_aberto: true,
      fiscal_motivo_aberto: porQueNaoDecido,
    }
  }

  // Nota fiscal, e o arquivo está anexado: a prova veio junto.
  return { doc_status: 'vinculado' }
}

/** O lançamento nasceu de um documento que não decide a situação fiscal? */
export const fiscalEmAberto = data => data?.fiscal_em_aberto === true && !data?.doc_status

export default situacaoFiscalDe
