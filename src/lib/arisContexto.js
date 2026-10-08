// =============================================================================
// O QUE A ARIS SABE QUANDO VOCÊ PERGUNTA — e por que é pouco de propósito.
//
// A Juliana pediu a Aris disponível no app inteiro, respondendo sobre tudo do
// sistema. O risco disso é exatamente o que ela já me pegou fazendo: responder
// com fluência sobre algo que não foi conferido.
//
// A defesa é a mesma régua, aplicada ao caso geral: a Aris responde A PARTIR
// DOS DADOS DELA, e o que não está no contexto ela não sabe. Não é limitação
// técnica — é desenho. Um assistente que responde "mais ou menos" sobre o
// faturamento de uma empresa é pior que um que diz "não tenho esse número
// aqui, abra a DRE".
//
// ── O CONTEXTO É PEQUENO POR DUAS RAZÕES ────────────────────────────────────
//
// 1. CUSTO. Cada pergunta manda o contexto inteiro. Despejar 434 linhas de
//    histórico e 556 lançamentos em toda pergunta é pagar caro por ruído —
//    e a regra desta casa é medir, mostrar, limitar, só então baratear.
//
// 2. PRECISÃO. Contexto grande e genérico faz o modelo escolher o número
//    errado entre vinte parecidos. Mandar o que a pergunta pede, e só, é o
//    que faz a resposta ser conferível.
//
// Por isso o histórico entra FILTRADO pelas palavras da pergunta: a evidência
// que vai junto é a que foi de fato usada, não um despejo da tabela.
// =============================================================================

/** Quantas linhas de histórico, no máximo, acompanham uma pergunta. */
export const MAX_HISTORICO = 40

/** Palavras com peso de busca — as curtas e comuns não ajudam a achar nada. */
export function palavrasDe(pergunta) {
  return String(pergunta ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(p => p.length >= 4)
    .filter(p => !PARADAS.has(p))
}

const PARADAS = new Set([
  'para', 'como', 'onde', 'quando', 'porque', 'esse', 'essa', 'isso', 'isto',
  'meus', 'minha', 'minhas', 'meu', 'qual', 'quais', 'tem', 'tenho', 'está',
  'esta', 'estao', 'sobre', 'todos', 'todas', 'aqui', 'mais', 'menos', 'pode',
  'fazer', 'quero', 'preciso', 'sistema', 'valor', 'valores',
])

/**
 * O recorte do histórico que a pergunta pede.
 *
 * Sem palavra útil na pergunta, devolve os mais usados — é o melhor retrato
 * geral e continua sendo evidência de verdade.
 */
export function historicoRelevante(pergunta, historico, limite = MAX_HISTORICO) {
  const linhas = historico || []
  const palavras = palavrasDe(pergunta)
  const maisUsados = [...linhas].sort((a, b) => (b.vezes || 0) - (a.vezes || 0))
  if (!palavras.length) return maisUsados.slice(0, limite)

  const normal = t => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const pontuar = h => {
    const alvo = `${normal(h.descricao)} ${normal(h.parte)} ${normal(h.cat)} ${normal(h.subcat)}`
    return palavras.reduce((s, p) => s + (alvo.includes(p) ? 1 : 0), 0)
  }

  const comPonto = linhas.map(h => ({ h, ponto: pontuar(h) })).filter(x => x.ponto > 0)
  comPonto.sort((a, b) => (b.ponto - a.ponto) || ((b.h.vezes || 0) - (a.h.vezes || 0)))
  const escolhidos = comPonto.slice(0, limite).map(x => x.h)

  // Nada casou: devolve o retrato geral em vez de contexto vazio, mas quem
  // chama saberá disso pelo tamanho — e a Aris é instruída a não forçar
  // resposta quando o contexto não cobre a pergunta.
  return escolhidos.length ? escolhidos : maisUsados.slice(0, Math.min(10, limite))
}

/** O plano de contas em texto compacto, agrupado por categoria. */
export function planoEmTexto(plano) {
  const porTipo = new Map()
  for (const p of plano || []) {
    const chave = `${p.tipo} · ${p.categoria}`
    if (!porTipo.has(chave)) porTipo.set(chave, { classificacao: p.classificacao || '', subs: [] })
    if (p.subcategoria) porTipo.get(chave).subs.push(p.subcategoria)
  }
  return [...porTipo.entries()]
    .map(([chave, v]) => `- ${chave}${v.classificacao ? ` [DRE: ${v.classificacao}]` : ''}: ${v.subs.join(', ') || '(sem subcategoria)'}`)
    .join('\n')
}

/** O histórico em texto, já com a prova (quantas vezes, quando). */
export function historicoEmTexto(linhas) {
  if (!(linhas || []).length) return '(nada parecido foi classificado ainda)'
  return linhas
    .map(h => `- [${h.tipo}] "${h.descricao || h.parte}" → ${h.cat}${h.subcat ? ` › ${h.subcat}` : ''} (${h.vezes}x, última em ${h.ultima || 'sem data'})`)
    .join('\n')
}

/** Os números da empresa, em texto. Só o que foi somado de verdade. */
export function resumoEmTexto(resumo) {
  if (!resumo) return '(resumo financeiro não carregou)'
  const m = v => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const linhas = [
    `- Lançamentos no sistema: ${resumo.lancamentos} (${resumo.realizados} já realizados)`,
    `- Entradas realizadas: ${m(resumo.entradas)}`,
    `- Saídas realizadas: ${m(resumo.saidas)}`,
    `- Em aberto a pagar: ${m(resumo.aPagar)} · a receber: ${m(resumo.aReceber)}`,
    `- Contas e cartões cadastrados: ${resumo.contas}`,
    `- Linhas de extrato ainda pendentes de classificação: ${resumo.extratoPendente}`,
  ]
  if (resumo.porClassificacao?.length) {
    linhas.push('- Por grupo da DRE (realizado):')
    for (const g of resumo.porClassificacao) linhas.push(`    · ${g.classificacao}: ${m(g.valor)}`)
  }
  return linhas.join('\n')
}

/**
 * O texto completo que acompanha a pergunta.
 *
 * Devolve também `usouHistorico`, porque a tela precisa dizer À JULIANA em que
 * a Aris se apoiou. Evidência que não aparece não serve de evidência.
 */
export function montarContexto({ pergunta, plano, historico, resumo, tela }) {
  const relevante = historicoRelevante(pergunta, historico)
  const texto = [
    tela ? `A usuária está na tela: ${tela}.` : '',
    '',
    '=== NÚMEROS DO SISTEMA (somados agora, confiáveis) ===',
    resumoEmTexto(resumo),
    '',
    '=== PLANO DE CONTAS DELA ===',
    planoEmTexto(plano),
    '',
    '=== COMO ELA JÁ CLASSIFICOU COISAS PARECIDAS ===',
    historicoEmTexto(relevante),
  ].filter(l => l !== '').join('\n')

  return { texto, usouHistorico: relevante }
}

/**
 * As regras da Aris conversando. São as mesmas da sugestão de categoria, ditas
 * para o caso geral — a diferença é que aqui ela pode ser perguntada sobre
 * qualquer coisa, e é justamente aí que inventar fica barato.
 */
export const SYSTEM_CONVERSA = [
  'Você é a Aris, assistente de contabilidade e finanças da Polímata Consultoria em GRC.',
  'Você conversa com a Juliana, que é fundadora e NÃO é contadora nem desenvolvedora.',
  '',
  'REGRAS INEGOCIÁVEIS:',
  '1. Responda a partir do CONTEXTO fornecido. Se a resposta não estiver nele, diga que não tem esse dado aqui e indique qual tela do sistema tem.',
  '2. NUNCA invente número. Todo valor que você citar tem que estar no contexto, igualzinho.',
  '3. NUNCA cite norma, lei, NBC, CPC ou artigo. Você não tem como comprovar isso aqui, e resposta que não dá para conferir não serve.',
  '4. Ao sugerir classificação, use SOMENTE categorias que estejam no plano de contas do contexto.',
  '5. Mostre a evidência junto: diga de onde tirou (o número do sistema, o plano, ou quantas vezes ela já classificou assim).',
  '6. Quando não souber, diga que não sabe e diga o que confirmaria a resposta. "Não sei" é resposta válida e esperada.',
  '7. Português do Brasil, linguagem de negócio, direta. Sem jargão contábil sem explicação.',
  '8. Seja breve: 2 a 5 frases, salvo se ela pedir detalhe.',
].join('\n')
