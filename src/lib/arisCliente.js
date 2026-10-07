// =============================================================================
// FALAR COM A ARIS — e, antes disso, tentar não precisar dela.
//
// A ordem aqui é a régua do produto, em código:
//
//   1. O HISTÓRICO DELA. Se "DÉB.CONV.SEGUROS" já foi classificado nove vezes
//      no mesmo lugar, a resposta é essa. Custo zero, resposta instantânea, e
//      a evidência é a decisão dela própria, com data. Não se chama a IA.
//
//   2. O MODELO, só quando o histórico não resolve — e com as opções do plano
//      dela na mão, para escolher DENTRO, nunca fora.
//
//   3. A CONFERÊNCIA, sempre. O que volta passa por lerResposta(), que recusa
//      categoria inexistente mesmo que o modelo insista.
//
// Inverter essa ordem seria pagar por IA para reaprender o que ela já ensinou
// ao sistema — e trocar uma evidência conferível por um palpite fluente.
// =============================================================================
import { supabase } from './supabase'
import { procurar, respostaDoHistorico, fraseDaEvidencia } from './arisHistorico'
import { montarPergunta, lerResposta, MODELO_ARIS } from './aris'

/** Carrega a memória de classificação (view historico_classificacao). */
export async function carregarHistorico() {
  const { data, error } = await supabase.from('historico_classificacao').select('*')
  if (error) throw error
  return data || []
}

/**
 * Pergunta como classificar um lançamento.
 *
 * @returns {{
 *   fonte: 'historico' | 'aris' | 'nenhuma',
 *   cat: string|null, subcat: string,
 *   confianca: 'alta'|'media'|'baixa',
 *   porque: string, faltaSaber: string,
 *   evidencias: string[],
 *   candidatos: Array,
 * }}
 */
export async function perguntar({ descricao, parte, valor, tipo, plano, historico }) {
  const candidatos = procurar({ descricao, parte, tipo, historico })
  const doHistorico = respostaDoHistorico(candidatos)

  // ── 1. O histórico resolve: nem toca na IA. ──────────────────────────────
  if (doHistorico) {
    return {
      fonte: 'historico',
      cat: doHistorico.cat,
      subcat: doHistorico.subcat,
      confianca: 'alta',
      porque: 'Esta mesma descrição já foi classificada por você antes, e eu repeti a sua decisão.',
      faltaSaber: '',
      evidencias: [fraseDaEvidencia(doHistorico)],
      candidatos,
    }
  }

  // ── 2. Não resolve: aí sim pergunta, com o plano dela em mãos. ───────────
  const { system, pergunta, modelo } = montarPergunta({ descricao, parte, valor, tipo, plano, candidatos })

  const { data: sessao } = await supabase.auth.getSession()
  const token = sessao?.session?.access_token
  if (!token) throw new Error('not_authenticated')

  const resposta = await fetch('/api/anthropic', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      model: modelo || MODELO_ARIS,
      max_tokens: 500,
      system,
      origem: 'aris',
      messages: [{ role: 'user', content: pergunta }],
    }),
  })

  const json = await resposta.json().catch(() => null)
  if (!resposta.ok) {
    throw new Error(json?.error || `A Aris não respondeu (${resposta.status}).`)
  }

  const texto = (json?.content || []).map(b => b?.text || '').join('').trim()

  // ── 3. Conferência: categoria fora do plano é recusada aqui. ─────────────
  const lida = lerResposta(texto, plano, tipo)
  if (!lida.ok) {
    return {
      fonte: 'nenhuma', cat: null, subcat: '', confianca: 'baixa',
      porque: lida.motivo, faltaSaber: '',
      evidencias: candidatos.length ? [fraseDaEvidencia(candidatos[0])] : [],
      candidatos,
    }
  }

  // Mesmo quando a IA responde, a evidência do histórico vai junto: é com ela
  // que a Juliana confere se a sugestão bate com o que ela já fez.
  const evidencias = []
  if (candidatos.length) evidencias.push(fraseDaEvidencia(candidatos[0]))
  if (lida.cat) {
    evidencias.push(`Está no seu plano de contas como ${lida.cat}${lida.subcat ? ` › ${lida.subcat}` : ''}.`)
  }

  return {
    fonte: 'aris',
    cat: lida.cat,
    subcat: lida.subcat,
    confianca: lida.confianca,
    porque: lida.porque,
    faltaSaber: lida.faltaSaber,
    evidencias,
    candidatos,
  }
}
