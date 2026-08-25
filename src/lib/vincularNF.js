// =============================================================================
// Vínculo obrigatório de NF na escrituração — "Com NF" tem que PROVAR.
//
// Metodologia (Juliana): a NOTA (e-mail ou digitalizada) é a verdade e é a
// própria saída. Se a nota do e-mail já virou lançamento, ao vincular a uma
// compra de cartão/banco a gente UNE: a nota sobrevive, absorve o contexto do
// pagamento (cartão + data), e a compra duplicada é removida. Valor entra 1x.
// =============================================================================
import { supabase } from './supabase'
import { uploadAnexo } from './anexos'
import { proximoCodigoReceivable, proximoCodigoPayable } from './codigos'

// Campos de escrituração/fiscal aplicados quando uma nota é vinculada.
function selo(classificacao, numero, agoraISO) {
  const s = {
    doc_status: 'vinculado',
    doc_motivo_dispensa: '',
    sem_documento: false,
    numero_nf: numero || null,
    escriturado: true,
    escriturado_em: agoraISO,
    escriturado_por: 'manual',
  }
  // Só sobrescreve a categoria se veio uma nova (não apaga a existente no modo anexar).
  if (classificacao?.cat) { s.cat = classificacao.cat; s.subcat = classificacao.subcat || '' }
  return s
}

// Contexto de pagamento que a nota absorve da compra do cartão/banco (regime caixa:
// a saída de caixa da nota é a data do pagamento da fatura/débito).
function contextoPagamento(compra) {
  const d = compra.data || {}
  return {
    due: d.due || null,
    data_pagamento: d.due || d.data_pagamento || null,
    forma_pagamento: d.forma_pagamento || 'Cartão Crédito',
    status: 'Pago',
    consolidado_de: compra.codigo || compra.id,
  }
}

// ── Vincular a uma NF do e-mail (nf_pending) ────────────────────────────────
// nf = linha de nf_pending. compra = lançamento sendo escriturado/completado.
// modo:
//   'consolidar' (padrão) — o lançamento é uma DUPLICATA da nota (ex.: compra de
//       cartão). A nota é a verdade: sobrevive, absorve o pagamento, e a duplicata sai.
//   'anexar' — o lançamento JÁ é a saída (ex.: "NF pendente" que agora recebe a nota).
//       Só anexa a prova (arquivo+número) ao lançamento; consome a NF pendente; nada é apagado.
// Retorna { survivorId, survivorTabela, removidoId }.
export async function vincularNFEmail({ nf, compra, compraTabela, classificacao, modo = 'consolidar' }) {
  const agora = new Date().toISOString()
  const nd = nf.data || {}

  // Modo ANEXAR + NF ainda pendente: anexa a prova ao próprio lançamento, consome a NF.
  if (modo === 'anexar' && !nf.lancamento_id) {
    const merged = { ...(compra.data || {}), ...selo(classificacao, nd.numero, agora) }
    const upd = { data: merged }
    if (nd.anexo && !compra.anexo_path) upd.anexo_path = nd.anexo
    const { error: eUp } = await supabase.from(compraTabela).update(upd).eq('id', compra.id)
    if (eUp) throw eUp
    // Baixa a NF pendente apontando pro lançamento (sem criar outro).
    await supabase.from('nf_pending').update({ status: 'aprovado', approved_at: agora, lancamento_tipo: compraTabela, lancamento_id: compra.id }).eq('id', nf.id)
    return { survivorId: compra.id, survivorTabela: compraTabela, removidoId: null }
  }

  if (nf.lancamento_id) {
    // A nota JÁ é um lançamento (N). Ela sobrevive e absorve o contexto da compra.
    const tabelaN = nf.lancamento_tipo || 'payable'
    const { data: rowN, error: eN } = await supabase.from(tabelaN).select('id, data, anexo_path, cartao_id').eq('id', nf.lancamento_id).single()
    if (eN) throw new Error('Nota do e-mail não encontrada: ' + eN.message)
    const mergedN = {
      ...(rowN.data || {}),
      ...contextoPagamento(compra),
      ...selo(classificacao, nd.numero || rowN.data?.numero_nf, agora),
    }
    const updN = { data: mergedN }
    if (tabelaN === 'payable' && compra.cartao_id) updN.cartao_id = compra.cartao_id
    if (!rowN.anexo_path && nd.anexo) updN.anexo_path = nd.anexo // leva o arquivo da NF
    const { error: eUp } = await supabase.from(tabelaN).update(updN).eq('id', nf.lancamento_id)
    if (eUp) throw eUp
    // Remove a compra duplicada.
    const { error: eDel } = await supabase.from(compraTabela).delete().eq('id', compra.id)
    if (eDel) throw eDel
    return { survivorId: nf.lancamento_id, survivorTabela: tabelaN, removidoId: compra.id }
  }

  // A NF está pendente (ainda não é lançamento). Aprova PARA O LUGAR da compra:
  // cria a nota como lançamento (com contexto do pagamento) e remove a compra.
  const isSaida = nd.is_saida || nd.tipo === 'saida'
  const target = nd.target_table || (isSaida ? 'receivable' : 'payable')
  const codigo = target === 'receivable' ? await proximoCodigoReceivable() : await proximoCodigoPayable()
  const p_lanc = {
    [target === 'receivable' ? 'client' : 'supplier']: nd.parte || nd.emitente_nome || '(sem nome)',
    desc: nd.desc_full || nd.descricao || '',
    value: Number(nd.valor || compra.data?.value || 0),
    data_competencia: nd.data_emissao || null,
    moeda: nd.moeda || 'BRL',
    cnpj: nd.emitente_cnpj || null,
    ...contextoPagamento(compra),
    ...selo(classificacao, nd.numero, agora),
    notes: `NF do e-mail vinculada à compra ${compra.codigo || ''}`,
  }
  const { data: novoId, error: eAprovar } = await supabase.rpc('aprovar_nf', {
    p_pending_id: nf.id, p_target: target, p_codigo: codigo, p_lanc,
  })
  if (eAprovar) throw eAprovar
  // aprovar_nf não seta colunas cartao_id/anexo_path — completa aqui.
  const patch = {}
  if (target === 'payable' && compra.cartao_id) patch.cartao_id = compra.cartao_id
  if (nd.anexo) patch.anexo_path = nd.anexo
  if (Object.keys(patch).length) await supabase.from(target).update(patch).eq('id', novoId)
  // Remove a compra duplicada.
  const { error: eDel } = await supabase.from(compraTabela).delete().eq('id', compra.id)
  if (eDel) throw eDel
  return { survivorId: novoId, survivorTabela: target, removidoId: compra.id }
}

// ── Caso 3: vincular subindo o arquivo da nota física (digitalizada) ────────
// Não há duplicata: a própria compra vira a saída provada, com o anexo.
export async function vincularNFArquivo({ compra, compraTabela, file, numero, classificacao, user }) {
  const agora = new Date().toISOString()
  const path = await uploadAnexo(file, { tipo: compraTabela === 'receivable' ? 'rec' : 'pay', lancamentoId: compra.id, userId: user.id })
  const merged = { ...(compra.data || {}), ...selo(classificacao, numero, agora) }
  const { error } = await supabase.from(compraTabela).update({ data: merged, anexo_path: path }).eq('id', compra.id)
  if (error) throw error
  return { survivorId: compra.id, survivorTabela: compraTabela, removidoId: null }
}
