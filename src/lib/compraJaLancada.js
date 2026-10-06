// =============================================================================
// ESTA NOTA JÁ FOI PAGA NO CARTÃO?
//
// A assinatura chega duas vezes: a nota por e-mail e a mesma compra na fatura
// do cartão. Se as duas virarem lançamento, a despesa dobra.
//
// O sistema já evitava isso — mas só de um lado. O pareamento roda na hora de
// IMPORTAR A FATURA: se a nota já estava lançada, a fatura a encontra e une as
// duas. Quando a ordem se inverte — a compra chega primeiro e a nota depois —
// não havia ninguém conferindo, porque a aprovação acontece na tela e nunca
// passou por essa checagem.
//
// É a mesma regra, no outro momento. Aqui ela não decide nada: só avisa, e
// sugere Anexar em vez de Lançar. Quem decide continua sendo ela — pode haver
// duas assinaturas iguais no mesmo mês, e o sistema não tem como saber.
// =============================================================================

/**
 * Dias de folga entre a emissão da nota e a data da compra no cartão.
 *
 * A nota de uma assinatura mensal costuma ser emitida no mesmo dia da cobrança,
 * mas nem sempre: o emissor atrasa um ou dois dias. Cinco dias cobre a prática
 * sem alcançar a mensalidade seguinte.
 */
export const JANELA_DIAS_COMPRA = 5;

const centavos = v => Math.round(Math.abs(Number(v) || 0) * 100);
const dia = d => (d ? new Date(String(d).slice(0, 10)).getTime() : null);

/**
 * Compras do cartão que podem ser esta mesma despesa.
 *
 * @param {object} nota     dados da pendência ({valor, data_emissao, data_vencimento})
 * @param {Array}  compras  linhas de payable do cartão ({id, cartao_id, data:{value, data_competencia|due, desc}})
 * @returns {Array} as candidatas, em ordem de proximidade de data
 */
export function comprasQuePodemSerEsta(nota, compras) {
  const valor = centavos(nota?.valor ?? nota?.value);
  const quando = dia(nota?.data_emissao || nota?.data_competencia || nota?.data_vencimento);
  if (!valor || !quando) return [];

  return (compras || [])
    .filter(c => c?.cartao_id)                       // só compra de cartão
    .map(c => {
      const d = c.data || {};
      const q = dia(d.data_competencia || d.due);
      return { compra: c, distancia: q ? Math.abs(q - quando) / 86400000 : null };
    })
    .filter(x => centavos(x.compra.data?.value) === valor)
    .filter(x => x.distancia !== null && x.distancia <= JANELA_DIAS_COMPRA)
    .sort((a, b) => a.distancia - b.distancia)
    .map(x => x.compra);
}

/**
 * O texto do aviso, escrito para ser entendido sem contexto.
 *
 * Fica aqui, e não na tela, porque é a parte que a prova consegue checar: um
 * aviso que não diz QUAL lançamento é o suspeito faz a pessoa clicar em
 * "lançar mesmo assim" só para se livrar dele.
 */
export function avisoDeCompraJaLancada(compras) {
  if (!compras?.length) return null;
  const nomeDe = c => String(c.data?.desc || c.data?.supplier || 'compra sem descrição').trim();
  if (compras.length === 1) {
    const c = compras[0];
    return {
      titulo: 'Esta despesa já parece estar lançada pelo cartão',
      detalhe: `Existe uma compra de cartão de mesmo valor e data próxima: "${nomeDe(c)}"`
             + ` (${c.data?.data_competencia || c.data?.due}).`,
      sugestao: 'Anexe a nota a esse lançamento em vez de criar outro — senão a despesa entra duas vezes.',
    };
  }
  return {
    titulo: 'Esta despesa já parece estar lançada pelo cartão',
    detalhe: `Existem ${compras.length} compras de cartão de mesmo valor e data próxima: `
           + compras.map(nomeDe).join(' · ') + '.',
    sugestao: 'Confira qual é a mesma despesa e anexe a nota a ela, em vez de criar outro lançamento.',
  };
}

export default comprasQuePodemSerEsta;
