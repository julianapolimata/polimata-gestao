// =============================================================================
// Vínculo obrigatório de NF na escrituração — "Com NF" tem que PROVAR.
//
// Metodologia (Juliana): a NOTA (e-mail ou digitalizada) é a verdade e é a
// própria saída. Se a nota do e-mail já virou lançamento, ao vincular a uma
// compra de cartão/banco a gente UNE: a nota sobrevive, absorve o contexto do
// pagamento (cartão + data), e a compra duplicada é removida. Valor entra 1x.
//
// Proteções (bloco 1 da revisão de set/26):
//  • nunca unir uma compra que faz parte de série parcelada (a FK parent_id é
//    ON DELETE CASCADE — apagar a 1ª parcela apagaria as outras);
//  • nunca unir sobre nota já conciliada com o extrato (sobrescreveria o vínculo);
//  • o arquivo da NF do e-mail vem em BASE64 (nf_pending.data.anexo) — sobe pro
//    Storage e grava o PATH em anexo_path (antes gravava o base64 no campo de path).
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

// ── Arquivo da NF: base64 (do robô do e-mail) → Storage → path ──────────────
// nf_pending.data.anexo pode ser um PATH do Storage (já migrado) ou o BASE64 cru
// gravado pelo email-cron. Path começa com o uuid do usuário; base64 não.
const pareceStoragePath = s => /^[0-9a-f]{8}-[0-9a-f-]{27}\//i.test(String(s || ''))

function base64ParaFile(b64, nome, mime) {
  let s = String(b64 || '').trim()
  // aceita base64url e remove quebras/data-URL
  if (s.startsWith('data:')) s = s.slice(s.indexOf(',') + 1)
  s = s.replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '')
  while (s.length % 4) s += '='
  const bin = atob(s)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new File([bytes], nome || 'nota.pdf', { type: mime || 'application/octet-stream' })
}

// Garante o arquivo da NF no Storage e devolve o path (ou null se a NF não tem arquivo).
export async function anexoDaNF(nd, { tabela, lancamentoId, userId }) {
  if (!nd?.anexo) return null
  if (pareceStoragePath(nd.anexo)) return nd.anexo
  if (!userId) return null
  const file = base64ParaFile(nd.anexo, nd.anexoNome || nd.fileName || `NF-${nd.numero || 'sem-numero'}.pdf`, nd.anexoTipo)
  return uploadAnexo(file, { tipo: tabela === 'receivable' ? 'rec' : 'pay', lancamentoId, userId })
}

// A compra faz parte de série parcelada? (é filha OU é mãe de outras parcelas)
async function ehParcelaDeSerie(tabela, compraId) {
  if (tabela !== 'payable') return false
  const { data: row } = await supabase.from(tabela).select('parent_id').eq('id', compraId).single()
  if (row?.parent_id) return true
  const { data: filhos } = await supabase.from(tabela).select('id').eq('parent_id', compraId).limit(1)
  return !!(filhos && filhos.length)
}

// ── Vincular a uma NF do e-mail (nf_pending) ────────────────────────────────
// nf = linha de nf_pending. compra = lançamento sendo escriturado/completado.
// modo:
//   'consolidar' (padrão) — o lançamento é uma DUPLICATA da nota (ex.: compra de
//       cartão). A nota é a verdade: sobrevive, absorve o pagamento, e a duplicata sai.
//   'anexar' — o lançamento JÁ é a saída (ex.: "NF pendente" que agora recebe a nota).
//       Só anexa a prova (arquivo+número) ao lançamento; consome a NF pendente; nada é apagado.
// Retorna { survivorId, survivorTabela, removidoId }.
export async function vincularNFEmail({ nf, compra, compraTabela, classificacao, modo = 'consolidar', user }) {
  const agora = new Date().toISOString()
  const nd = nf.data || {}
  const userId = user?.id

  // Modo ANEXAR + NF ainda pendente: anexa a prova ao próprio lançamento, consome a NF.
  if (modo === 'anexar' && !nf.lancamento_id) {
    const merged = { ...(compra.data || {}), ...selo(classificacao, nd.numero, agora) }
    const upd = { data: merged }
    if (!compra.anexo_path) {
      const path = await anexoDaNF(nd, { tabela: compraTabela, lancamentoId: compra.id, userId })
      if (path) upd.anexo_path = path
    }
    const { error: eUp } = await supabase.from(compraTabela).update(upd).eq('id', compra.id)
    if (eUp) throw eUp
    // Baixa a NF pendente apontando pro lançamento (sem criar outro).
    await supabase.from('nf_pending').update({ status: 'aprovado', approved_at: agora, lancamento_tipo: compraTabela, lancamento_id: compra.id }).eq('id', nf.id)
    return { survivorId: compra.id, survivorTabela: compraTabela, removidoId: null }
  }

  // Daqui pra baixo é CONSOLIDAR (a compra vai ser apagada). Proteções primeiro.
  if (await ehParcelaDeSerie(compraTabela, compra.id)) {
    throw new Error('Esta compra faz parte de uma série parcelada — unir apagaria as outras parcelas. Anexe a nota como arquivo a esta parcela (ou vincule pela edição do lançamento).')
  }

  if (nf.lancamento_id) {
    // A nota JÁ é um lançamento (N). Ela sobrevive e absorve o contexto da compra.
    const tabelaN = nf.lancamento_tipo || 'payable'
    const { data: rowN, error: eN } = await supabase.from(tabelaN).select('id, data, anexo_path, cartao_id, conciliado_em').eq('id', nf.lancamento_id).single()
    if (eN) throw new Error('Nota do e-mail não encontrada: ' + eN.message)
    if (rowN.conciliado_em) {
      throw new Error('A nota do e-mail já está conciliada com o extrato — unir sobrescreveria esse vínculo. Desconcilie antes, ou anexe a nota a este lançamento.')
    }
    const mergedN = {
      ...(rowN.data || {}),
      ...contextoPagamento(compra),
      ...selo(classificacao, nd.numero || rowN.data?.numero_nf, agora),
    }
    const updN = { data: mergedN }
    if (tabelaN === 'payable' && compra.cartao_id) updN.cartao_id = compra.cartao_id
    if (!rowN.anexo_path) {
      const path = await anexoDaNF(nd, { tabela: tabelaN, lancamentoId: nf.lancamento_id, userId })
      if (path) updN.anexo_path = path
    }
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
  if (target !== compraTabela) {
    throw new Error('Esta nota é de ' + (target === 'receivable' ? 'receita' : 'despesa') + ' e o lançamento é de ' + (compraTabela === 'receivable' ? 'receita' : 'despesa') + ' — não podem ser unidos.')
  }
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
  const path = await anexoDaNF(nd, { tabela: target, lancamentoId: novoId, userId })
  if (path) patch.anexo_path = path
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
