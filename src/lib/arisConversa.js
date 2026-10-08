// =============================================================================
// A ARIS CONVERSANDO — carregar os números dela e levar a pergunta.
//
// A parte cara e silenciosa deste arquivo é o RESUMO: ele é somado aqui, com
// os dados dela, e vai pronto para a Aris. O modelo nunca calcula nada — ele
// lê números que o sistema somou. É essa separação que impede a resposta
// "aproximadamente uns R$ 80 mil", que soa certa e não é conferível.
// =============================================================================
import { supabase } from './supabase'
import { unificar, totais, situacaoDe } from './lancamentos'
import { montarContexto, SYSTEM_CONVERSA } from './arisContexto'
import { MODELO_ARIS } from './aris'

/** Tudo que a Aris precisa saber, carregado uma vez por sessão de conversa. */
export async function carregarBase() {
  const [rP, rR, rPlano, rContas, rExtrato, rHist] = await Promise.all([
    supabase.from('payable_lista').select('*'),
    supabase.from('receivable_lista').select('*'),
    supabase.from('plano_contas').select('tipo,categoria,subcategoria,classificacao').order('ordem'),
    supabase.from('contas_bancarias').select('id'),
    supabase.from('transacoes_extrato').select('id', { count: 'exact', head: true }).eq('status', 'pendente'),
    supabase.from('historico_classificacao').select('*'),
  ])

  const plano = rPlano.data || []
  const linhas = unificar({ pagar: rP.data || [], receber: rR.data || [], plano })

  const realizados = linhas.filter(l => l.situacao === 'realizado')
  const t = totais(realizados)

  // Soma por grupo da DRE — os números que ela cobra em reunião.
  const porGrupo = new Map()
  for (const l of realizados) {
    const g = l.classificacao || 'Sem classificação'
    porGrupo.set(g, (porGrupo.get(g) || 0) + l.valor)
  }

  const emAberto = linhas.filter(l => l.situacao === 'aberto')
  const soma = ls => Math.round(ls.reduce((s, l) => s + l.valor, 0) * 100) / 100

  const resumo = {
    lancamentos: linhas.length,
    realizados: realizados.length,
    entradas: t.entradas,
    saidas: t.saidas,
    aPagar: soma(emAberto.filter(l => l.tipo === 'Saída')),
    aReceber: soma(emAberto.filter(l => l.tipo === 'Entrada')),
    contas: (rContas.data || []).length,
    extratoPendente: rExtrato.count ?? 0,
    porClassificacao: [...porGrupo.entries()]
      .map(([classificacao, valor]) => ({ classificacao, valor: Math.round(valor * 100) / 100 }))
      .sort((a, b) => b.valor - a.valor),
  }

  return { plano, historico: rHist.data || [], resumo }
}

/**
 * Leva a pergunta à Aris, com o contexto dela junto.
 *
 * `conversa` são as mensagens anteriores ({ papel: 'voce'|'aris', texto }).
 * O contexto só vai na ÚLTIMA pergunta: repetir o plano de contas a cada turno
 * multiplicaria o custo sem acrescentar nada.
 */
export async function conversar({ pergunta, conversa = [], plano, historico, resumo, tela }) {
  const { texto, usouHistorico } = montarContexto({ pergunta, plano, historico, resumo, tela })

  const { data: sessao } = await supabase.auth.getSession()
  const token = sessao?.session?.access_token
  if (!token) throw new Error('not_authenticated')

  const messages = [
    ...conversa.slice(-6).map(m => ({
      role: m.papel === 'aris' ? 'assistant' : 'user',
      content: m.texto,
    })),
    { role: 'user', content: `${texto}\n\n=== PERGUNTA ===\n${pergunta}` },
  ]

  const resposta = await fetch('/api/anthropic', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      model: MODELO_ARIS,
      max_tokens: 700,
      system: SYSTEM_CONVERSA,
      origem: 'aris',
      messages,
    }),
  })

  const json = await resposta.json().catch(() => null)
  if (!resposta.ok) throw new Error(json?.error || `A Aris não respondeu (${resposta.status}).`)

  const txt = (json?.content || []).map(b => b?.text || '').join('').trim()
  return { texto: txt || 'Não consegui formular uma resposta.', usouHistorico }
}

export { situacaoDe }
