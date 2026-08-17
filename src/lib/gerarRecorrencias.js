// =============================================================================
// Geração das provisões do mês a partir dos mestres de recorrência.
// - Idempotente: dedup por recurring_id + data.rec_ref (não duplica).
// - Materializa só a(s) ocorrência(s) do MÊS CORRENTE (não 12 meses).
// - Cria como status 'Provisão' e SEM código (o código só é atribuído quando
//   a provisão é promovida a Pendente — ver promoção, passo seguinte).
// - NÃO marca data.recorrente:true (esse flag é do motor de projeção antigo;
//   marcá-lo faria a provisão se auto-projetar pra frente, contando em dobro).
// =============================================================================
import { supabase } from './supabase'
import { ocorrenciasEntre } from './recorrencias'
import { today } from './finance'
import { proximoCodigoReceivable, proximoCodigoPayable } from './codigos'

export async function gerarProvisoesDoMes(userId) {
  if (!userId) return { criadas: 0 }

  const { data: mestres, error: eM } = await supabase.from('recurring_masters').select('*')
  if (eM) throw eM
  const ativos = (mestres || []).filter(m => m.data?.ativo !== false)
  if (!ativos.length) return { criadas: 0 }

  // Janela = mês corrente (1º ao último dia)
  const hoje = today()
  const [y, mo] = hoje.split('-')
  const ultimoDia = new Date(Number(y), Number(mo), 0).getDate()
  const inicioMes = `${y}-${mo}-01`
  const fimMes = `${y}-${mo}-${String(ultimoDia).padStart(2, '0')}`

  // Já materializadas — dedup por recurring_id + rec_ref (nas duas tabelas)
  const [{ data: rec, error: eR }, { data: pay, error: eP }] = await Promise.all([
    supabase.from('receivable').select('recurring_id, data').not('recurring_id', 'is', null),
    supabase.from('payable').select('recurring_id, data').not('recurring_id', 'is', null),
  ])
  if (eR) throw eR
  if (eP) throw eP
  const existentes = new Set()
  for (const row of [...(rec || []), ...(pay || [])]) {
    if (row.recurring_id && row.data?.rec_ref) existentes.add(`${row.recurring_id}|${row.data.rec_ref}`)
  }

  const novosRec = []
  const novosPay = []
  for (const m of ativos) {
    const d = m.data || {}
    const isReceita = d.tipo !== 'despesa'
    for (const due of ocorrenciasEntre(m, inicioMes, fimMes)) {
      if (existentes.has(`${m.id}|${due}`)) continue
      const payloadData = {
        [isReceita ? 'client' : 'supplier']: d.parte || 'Recorrência',
        desc: d.descricao || 'Recorrência',
        value: Number(d.valor) || 0,
        due,
        data_competencia: due,
        data_pagamento: null,
        status: 'Provisão',
        cat: d.cat || '',
        forma_pagamento: d.forma_pagamento || null,
        moeda: d.moeda || 'BRL',
        rec_ref: due,
        origem_recorrencia: true,
        created: hoje,
      }
      const linha = { user_id: userId, recurring_id: m.id, data: payloadData }
      if (isReceita) novosRec.push(linha)
      else novosPay.push(linha)
    }
  }

  let criadas = 0
  if (novosRec.length) {
    const { error } = await supabase.from('receivable').insert(novosRec)
    if (error) throw error
    criadas += novosRec.length
  }
  if (novosPay.length) {
    const { error } = await supabase.from('payable').insert(novosPay)
    if (error) throw error
    criadas += novosPay.length
  }
  return { criadas }
}

// Promove uma provisão a lançamento real (Pendente): atribui código sequencial
// e muda o status. Use quando o fato acontece (NF emitida / conta confirmada).
export async function promoverProvisao(row, tabela) {
  const codigo = tabela === 'receivable'
    ? await proximoCodigoReceivable()
    : await proximoCodigoPayable()
  const merged = { ...(row.data || {}), status: 'Pendente' }
  const { error } = await supabase.from(tabela).update({ codigo, data: merged }).eq('id', row.id)
  if (error) throw error
  return codigo
}
