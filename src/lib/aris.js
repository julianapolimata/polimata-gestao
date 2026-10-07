// =============================================================================
// ARIS CONTÁBIL — a régua antes da resposta.
//
// A Aris do CI é craque em metodologia. Esta é a de contabilidade, e ela nasce
// com uma cicatriz: eu disse à Juliana que o "Seguro Prestamista" estava
// corretamente classificado como despesa financeira, com ar de parecer técnico.
// Ela respondeu "TEM CERTEZA?" e os dados dela me derrubaram — duas das três
// cobranças são anteriores ao único empréstimo que ela tem.
//
// Eu tinha acabado de fazer exatamente o que avisei que a Aris faria de errado:
// produzir texto fluente apoiado numa generalização plausível. Daí a régua.
//
// ── AS QUATRO REGRAS ────────────────────────────────────────────────────────
//
// 1. SÓ ESCOLHE DENTRO DO PLANO DELA. Não é instrução ao modelo — é trava de
//    código: a resposta é conferida contra o plano e, se a categoria não
//    existir, é RECUSADA. O modelo não tem como inventar conta, nem querendo.
//
// 2. EVIDÊNCIA JUNTO DA RESPOSTA, SEMPRE. "Seguro Prestamista → Despesas
//    Financeiras" nunca sozinho. Sempre "porque X, que eu li em Y". Sem Y, a
//    resposta vira "não sei dizer; o que eu vi foi isto".
//
// 3. O HISTÓRICO DELA VENCE O MODELO. Decisão anterior dela > plano de contas >
//    raciocínio do modelo. Quando o histórico resolve, nem se chama a IA.
//
// 4. "NÃO SEI" É RESPOSTA VÁLIDA. Confiança baixa não vira palpite com cara de
//    certeza. Numa consultoria cujo produto é rigor, uma norma inventada custa
//    mais do que dez dúvidas honestas.
//
// Nada aqui cita NBC, CPC ou artigo de lei pelo modelo: o que ele lembra de
// norma não é verificável na hora, e o que não é verificável não entra. As
// regras que o sistema aplica de verdade (Fator R, anexos do Simples, o que
// entra na DRE) estão em código, com prova, e são essas que a Aris usa.
// =============================================================================

export const MODELO_ARIS = 'claude-sonnet-5'

/** Conjunto de chaves "categoria|subcategoria" que existem no plano, por tipo. */
export function opcoesDoPlano(plano, tipo) {
  return (plano || [])
    .filter(p => !tipo || p.tipo === tipo)
    .map(p => ({
      cat: p.categoria,
      subcat: p.subcategoria || '',
      classificacao: p.classificacao || '',
    }))
}

const k = (cat, subcat) => `${String(cat || '').trim()}|${String(subcat || '').trim()}`

/**
 * O texto que vai para o modelo. Montado aqui, e não solto no componente, para
 * caber numa prova: o que se cobra de uma IA é o que se pede a ela.
 */
export function montarPergunta({ descricao, parte, valor, tipo, plano, candidatos }) {
  const opcoes = opcoesDoPlano(plano, tipo)
  const lista = opcoes
    .map(o => `- ${o.cat}${o.subcat ? ` › ${o.subcat}` : ''}${o.classificacao ? `  [DRE: ${o.classificacao}]` : ''}`)
    .join('\n')

  const historico = (candidatos || []).length
    ? (candidatos || []).slice(0, 5).map(c =>
      `- ${c.cat}${c.subcat ? ` › ${c.subcat}` : ''} — usada ${c.vezes}x, última em ${c.ultima || 'sem data'} (${c.forca === 'exata' ? 'mesma descrição' : 'mesma parte'})`).join('\n')
    : '(nenhum lançamento parecido foi classificado antes)'

  const system = [
    'Você é a Aris, assistente de contabilidade da Polímata Consultoria em GRC.',
    'Sua função é ajudar a classificar um lançamento financeiro DENTRO do plano de contas que a usuária já tem.',
    '',
    'REGRAS INEGOCIÁVEIS:',
    '1. Escolha SOMENTE uma das opções listadas. Nunca proponha categoria que não esteja na lista.',
    '2. Se nenhuma opção servir, responda com escolha nula e diga o que faria falta.',
    '3. NUNCA cite norma, lei, NBC, CPC ou artigo. Você não tem como comprovar isso aqui, e resposta que não dá para conferir não serve.',
    '4. Baseie-se no histórico quando ele existir: a decisão anterior da usuária vale mais que a sua opinião.',
    '5. Se não tiver base suficiente, responda confianca "baixa" e diga honestamente o que falta saber.',
    '6. Escreva em português do Brasil, em linguagem de negócio, sem jargão.',
    '',
    'Responda APENAS com um JSON, sem texto em volta, neste formato:',
    '{"cat": "...", "subcat": "...", "confianca": "alta|media|baixa", "porque": "uma ou duas frases", "falta_saber": "o que confirmaria, ou vazio"}',
    'Para "não sei": {"cat": null, "subcat": null, "confianca": "baixa", "porque": "...", "falta_saber": "..."}',
  ].join('\n')

  const pergunta = [
    `Lançamento de ${tipo === 'Entrada' ? 'ENTRADA (dinheiro que recebeu)' : 'SAÍDA (dinheiro que pagou)'}:`,
    `- Descrição: ${descricao || '(sem descrição)'}`,
    parte ? `- Quem: ${parte}` : '',
    Number(valor) ? `- Valor: R$ ${Number(valor).toFixed(2)}` : '',
    '',
    'COMO LANÇAMENTOS PARECIDOS JÁ FORAM CLASSIFICADOS POR ELA:',
    historico,
    '',
    'OPÇÕES DISPONÍVEIS NO PLANO DE CONTAS (só estas valem):',
    lista,
  ].filter(Boolean).join('\n')

  return { system, pergunta, modelo: MODELO_ARIS }
}

/**
 * Lê a resposta do modelo e CONFERE contra o plano.
 *
 * Esta função é a trava da regra 1. O prompt pede para não inventar; aqui a
 * invenção é recusada mesmo se vier. Instrução é pedido; isto é controle.
 *
 * @returns {{ok: true, cat, subcat, confianca, porque, faltaSaber}
 *          | {ok: false, motivo: string, cru?: string}}
 */
export function lerResposta(texto, plano, tipo) {
  const bruto = String(texto ?? '').trim()
  if (!bruto) return { ok: false, motivo: 'A Aris não respondeu nada.' }

  // O modelo às vezes embrulha o JSON em ```json … ```.
  const semCerca = bruto.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  const inicio = semCerca.indexOf('{')
  const fim = semCerca.lastIndexOf('}')
  if (inicio < 0 || fim <= inicio) {
    return { ok: false, motivo: 'A resposta da Aris não veio no formato esperado.', cru: bruto.slice(0, 300) }
  }

  let obj
  try { obj = JSON.parse(semCerca.slice(inicio, fim + 1)) } catch {
    return { ok: false, motivo: 'A resposta da Aris não veio no formato esperado.', cru: bruto.slice(0, 300) }
  }

  const confianca = ['alta', 'media', 'baixa'].includes(obj?.confianca) ? obj.confianca : 'baixa'
  const porque = String(obj?.porque || '').trim()
  const faltaSaber = String(obj?.falta_saber || '').trim()

  // "Não sei" é resposta válida e não é erro.
  if (!obj?.cat) {
    return { ok: true, cat: null, subcat: null, confianca: 'baixa', porque, faltaSaber }
  }

  const cat = String(obj.cat).trim()
  const subcat = String(obj.subcat || '').trim()
  const existentes = new Set(opcoesDoPlano(plano, tipo).map(o => k(o.cat, o.subcat)))

  if (!existentes.has(k(cat, subcat))) {
    // A categoria não existe no plano dela. Não há aproveitamento parcial:
    // sugerir "quase isso" é como sugerir outra conta.
    return {
      ok: false,
      motivo: `A Aris sugeriu "${cat}${subcat ? ` › ${subcat}` : ''}", que não existe no seu plano de contas. Descartei a sugestão.`,
    }
  }

  // Confiança alta sem explicação não passa: a régua é mostrar a evidência.
  const confiancaFinal = (confianca === 'alta' && !porque) ? 'media' : confianca
  return { ok: true, cat, subcat, confianca: confiancaFinal, porque, faltaSaber }
}

export const ROTULO_CONFIANCA = {
  alta: 'Confiança alta',
  media: 'Confiança média',
  baixa: 'Confiança baixa — confira antes',
}
