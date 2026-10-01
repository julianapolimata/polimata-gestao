// =============================================================================
// O PRÓXIMO PASSO — um gancho, duas telas, uma verdade só.
//
// "Olho pra ele e não sei o que fazer" (Juliana, 01/10). O sistema tinha a
// resposta espalhada: o Fechamento sabia o que faltava, mas ela abre o Início.
// E mesmo no Fechamento a resposta vinha como nome de item ("Extrato
// importado ✕"), não como ordem.
//
// Aqui o cálculo é feito UMA vez e as duas telas consomem o mesmo resultado.
// Se o Início e o Fechamento discordassem, o sistema estaria mentindo em algum
// dos dois — e a pessoa pararia de confiar nos dois.
//
// As consultas são enxutas de propósito: só as colunas que o checklist usa.
// =============================================================================
import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { mesLabel } from './fechamento'
import { montarChecklist, proximoPasso } from './fechamentoChecklist'

const ym = s => (s || '').slice(0, 7)
const mesAtual = () => new Date().toISOString().slice(0, 7)

/** Todos os meses do primeiro movimento até hoje, em ordem crescente. */
function listarMeses(movs) {
  if (!movs.size) return []
  const hoje = mesAtual()
  const lista = []
  let cur = [...movs].sort()[0]
  let guarda = 0
  while (cur <= hoje && guarda++ < 600) {
    lista.push(cur)
    const [y, m] = cur.split('-').map(Number)
    const d = new Date(y, m, 1)
    cur = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }
  return lista
}

/**
 * @returns {{passo: object|null, meses: Array, loading: boolean, recarregar: function}}
 */
export function useProximoPasso(user) {
  const [estado, setEstado] = useState({ passo: null, meses: [], loading: true })

  const carregar = useCallback(() => {
    if (!user) return
    setEstado(e => ({ ...e, loading: true }))
    Promise.all([
      supabase.from('transacoes_extrato').select('id, conta_id, status, dt:data->>data'),
      supabase.from('receivable').select('id, conciliado_em, due:data->>due, comp:data->>data_competencia, st:data->>status, esc:data->>escriturado, doc:data->>doc_status, sus:data->>suspense, val:data->>value'),
      supabase.from('payable').select('id, conciliado_em, due:data->>due, comp:data->>data_competencia, st:data->>status, esc:data->>escriturado, doc:data->>doc_status, sus:data->>suspense, val:data->>value, cat:data->>cat, cartao_id'),
      supabase.from('contas_bancarias').select('id,data'),
      supabase.from('transferencias').select('para_conta_id, data, valor'),
      supabase.from('fechamentos').select('*'),
      supabase.from('nf_pending').select('id,status,created_at').eq('status', 'pendente'),
    ]).then(([e, r, p, c, t, f, nf]) => {
      const extratos = e.data || [], receivable = r.data || [], payable = p.data || []
      const fechamentos = f.data || []
      const movs = new Set()
      for (const x of extratos) { const k = ym(x.dt); if (k) movs.add(k) }
      for (const l of [...receivable, ...payable]) { const k = ym(l.comp || l.due); if (k) movs.add(k) }
      for (const x of fechamentos) if (x.competencia) movs.add(x.competencia)

      const ctx = {
        extratos, receivable, payable,
        contas: c.data || [], transferencias: t.data || [], fechamentos,
        nfPend: nf.data || [],
        temFechamento: fechamentos.length > 0,
        mesesComMovimento: movs,
      }
      const hoje = mesAtual()
      const meses = listarMeses(movs).map(comp => {
        const items = montarChecklist(comp, ctx)
        const reg = fechamentos.find(x => x.competencia === comp)
        const obrigFalta = items.filter(i => i.obrigatorio && !i.ok)
        const avisosFalta = items.filter(i => !i.obrigatorio && !i.ok)
        let estadoMes
        if (reg?.status === 'fechado') estadoMes = 'fechado'
        else if (reg?.status === 'reaberto') estadoMes = 'reaberto'
        else if (comp >= hoje) estadoMes = 'corrente'
        else if (obrigFalta.length === 0) estadoMes = 'pronto'
        else estadoMes = 'pendente'
        return { comp, items, reg, obrigFalta, avisosFalta, estado: estadoMes }
      })

      setEstado({ passo: proximoPasso(meses, mesLabel), meses, loading: false })
    }).catch(() => setEstado({ passo: null, meses: [], loading: false }))
  }, [user])

  useEffect(() => { carregar() }, [carregar])

  return { ...estado, recarregar: carregar }
}
