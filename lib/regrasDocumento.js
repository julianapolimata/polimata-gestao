// =============================================================================
// O QUE VOCÊ JÁ DISPENSOU UMA VEZ, O SISTEMA PARA DE PERGUNTAR.
//
// Pedido da Juliana (06/10), diante de três documentos do eSocial que ela ia
// rejeitar: "preciso que o sistema lembre disso e não traga esses arquivos
// novamente". Hoje não lembra — a trava de duplicidade só olha a fila de
// pendentes, então documento rejeitado volta no mês seguinte, e volta sempre.
//
// Isto segue a regra 6 do REGRAS.md ("o sistema aprende do que você decidiu,
// nunca do que ele propôs"), com as três condições de lá:
//
//   1. SÓ APRENDE DO QUE FOI DECIDIDO À MÃO. Documento arquivado pela própria
//      regra não alimenta a regra — senão ela se realimenta e um engano vira
//      doutrina.
//   2. SÓ VIRA REGRA SE O HISTÓRICO FOR UNÂNIME. Se um documento igual já foi
//      APROVADO alguma vez, não há regra: ela espera decisão humana.
//   3. A REGRA NUNCA APLICA SOZINHA. E aqui está a parte que precisa ser dita
//      com precisão: ela não classifica nem lança nada. Ela decide apenas que
//      o documento NÃO PRECISA DA SUA ATENÇÃO — ele entra arquivado, com o
//      arquivo inteiro e o motivo registrado, em vez de entrar na fila. Nada
//      some; só para de perguntar.
//
// E uma quarta condição, que é só desta regra:
//
//   4. SÓ VALE PARA DOCUMENTO QUE É PROVA. Comprovante, base de cálculo,
//      declaração e contrato são sempre dispensáveis pelo mesmo motivo: não
//      são desembolso. Já uma guia ou uma nota fiscal rejeitada foi rejeitada
//      por algo DAQUELE documento — valor errado, duplicata, não era dela.
//      Generalizar isso faria o sistema parar de trazer uma conta a pagar de
//      verdade, e falta não se enxerga em lugar nenhum.
// =============================================================================

import { PAPEIS_SEM_LANCAMENTO } from './papelDocumento.js';

/** Dispensável por tipo: só o que é prova, nunca o que vira lançamento. */
const ehProva = papel => PAPEIS_SEM_LANCAMENTO.includes(String(papel || ''));

/** O domínio de quem mandou — 'Fulano <x@contador.com.br>' → 'contador.com.br' */
export function dominioDe(emailDe) {
  const m = String(emailDe || '').match(/<([^>]+)>/);
  const endereco = (m ? m[1] : String(emailDe || '')).trim().toLowerCase();
  return endereco.split('@')[1] || '';
}

/**
 * A chave do que se repete: o MESMO tipo de prova, do MESMO remetente.
 *
 * Não entra o número nem o valor de propósito — eles mudam todo mês, e é
 * justamente o documento mensal que ela não quer ver de novo. O que não muda é
 * "recibo da DCTFWeb que vem do escritório contábil".
 */
export function chaveDeDispensa(d) {
  const papel = String(d?.papel_documento || '').trim();
  if (!ehProva(papel)) return null;
  const tipo = String(d?.tipo_documento || '').trim().toUpperCase();
  const dominio = dominioDe(d?.email_de);
  if (!tipo || !dominio) return null;
  return `${papel}|${tipo}|${dominio}`;
}

/**
 * Monta as regras a partir do histórico de decisões.
 *
 * @param {Array} linhas  linhas de nf_pending ({status, data})
 * @returns {Map<string, {exemplo, quantas}>}
 */
export function construirRegrasDeDispensa(linhas) {
  const rejeitadas = new Map();  // chave -> {exemplo, quantas}
  const aprovadas = new Set();   // chave -> houve aprovação alguma vez

  for (const linha of linhas || []) {
    const d = linha?.data || linha || {};
    const chave = chaveDeDispensa(d);
    if (!chave) continue;

    if (linha.status === 'aprovado') { aprovadas.add(chave); continue; }
    if (linha.status !== 'rejeitado') continue;
    // Condição 1: arquivado pela própria regra não ensina nada.
    if (d.rejeitado_por === 'regra') continue;

    const atual = rejeitadas.get(chave) || { exemplo: null, quantas: 0 };
    atual.quantas += 1;
    atual.exemplo = atual.exemplo || d.fileName || d.anexoNome || null;
    rejeitadas.set(chave, atual);
  }

  // Condição 2: unanimidade. Aprovou uma vez que fosse, não há regra.
  for (const chave of aprovadas) rejeitadas.delete(chave);
  return rejeitadas;
}

/**
 * Este documento cai numa regra? Devolve a regra (com o porquê) ou null.
 */
export function dispensaPara(d, regras) {
  if (!regras || regras.size === 0) return null;
  const chave = chaveDeDispensa(d);
  if (!chave) return null;
  const regra = regras.get(chave);
  if (!regra) return null;
  return {
    chave,
    quantas: regra.quantas,
    exemplo: regra.exemplo,
    // O motivo é escrito para ser lido por ela depois, no histórico — não para
    // o código. Quem abrir daqui a três meses precisa entender sem perguntar.
    motivo: `Arquivado automaticamente: você já rejeitou ${regra.quantas} documento(s) deste mesmo tipo `
          + `(${d.tipo_documento}) vindos de ${dominioDe(d.email_de)}`
          + (regra.exemplo ? `, como "${regra.exemplo}"` : '')
          + '. O arquivo está guardado; se quiser revê-lo, devolva para reanálise.',
  };
}

export default construirRegrasDeDispensa;
