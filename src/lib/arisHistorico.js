// =============================================================================
// A MEMÓRIA DA ARIS — o que a Juliana já decidiu antes.
//
// Esta é a parte da Aris que NÃO usa inteligência artificial, e é a que
// responde melhor. Quando "DÉB.CONV.TELECOMUNICAÇÕES" já foi classificado sete
// vezes em Despesas Operacionais › Telefonia e Internet, a resposta certa não
// é o que um modelo acha de telecomunicações: é o que ela decidiu, com data.
//
// ── POR QUE ISTO VEM ANTES DO MODELO ────────────────────────────────────────
//
// Eu afirmei para ela que o "Seguro Prestamista" estava corretamente
// classificado como despesa financeira. Soava certo e era fluente. Ela
// perguntou "TEM CERTEZA?" e os dados dela me derrubaram: duas das três
// cobranças são anteriores ao único empréstimo que ela tem.
//
// A lição virou regra do produto: a Aris mostra a evidência junto da resposta,
// e prefere a evidência mais forte. Decisão anterior dela > plano de contas >
// raciocínio do modelo. Quando o histórico responde, não há chamada de IA:
// é de graça, é instantâneo, e é conferível olhando.
//
// ── O QUE A NORMALIZAÇÃO PODE E NÃO PODE FAZER ──────────────────────────────
//
// O extrato repete a mesma despesa com números diferentes a cada mês
// ("DÉB.CONV.TELECOMUNICAÇÕES" é igual sempre, mas "SebraeSp 3/10" muda). Para
// achar o histórico é preciso ignorar o que varia.
//
// O limite está em `agruparExtrato.js`, aprendido do jeito caro: normalizar
// demais juntou "Pagamento Pix ***.156.628-**" com "Pagamento Pix
// ***.985.018-**" — duas pessoas diferentes. Aqui a regra é mais estreita de
// propósito: tira sufixo de parcela e espaço repetido, e só. Documento
// mascarado continua fazendo parte do nome, porque é ele que diz QUEM é.
// =============================================================================

/** Minúsculas, sem acento, sem espaço repetido. Não tira dígito. */
export function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** "SebraeSp 3/10" → "sebraesp". O número da parcela muda, a compra não. */
export function semParcela(texto) {
  return normalizar(texto).replace(/\s*\d{1,3}\s*\/\s*\d{1,3}\s*$/, '').trim()
}

/** A chave de comparação de uma descrição do extrato. */
export function chave(descricao) {
  return semParcela(descricao)
}

/**
 * Procura como esta descrição já foi classificada.
 *
 * `historico` são as linhas da view historico_classificacao.
 * Devolve as classificações candidatas, da mais usada para a menos, cada uma
 * com a prova (quantas vezes e quando foi a última).
 *
 * @returns {Array<{cat, subcat, vezes, ultima, forca}>}
 */
export function procurar({ descricao, parte, tipo, historico }) {
  const alvoDesc = chave(descricao)
  const alvoParte = chave(parte)
  if (!alvoDesc && !alvoParte) return []

  const candidatos = new Map()
  const somar = (h, forca) => {
    const k = `${h.cat}|${h.subcat || ''}`
    const atual = candidatos.get(k)
    if (!atual) {
      candidatos.set(k, { cat: h.cat, subcat: h.subcat || '', vezes: h.vezes, ultima: h.ultima || '', forca })
      return
    }
    atual.vezes += h.vezes
    if ((h.ultima || '') > atual.ultima) atual.ultima = h.ultima || ''
    // Vale a evidência mais forte que encontrarmos para a mesma classificação.
    if (forca === 'exata') atual.forca = 'exata'
  }

  for (const h of historico || []) {
    if (tipo && h.tipo !== tipo) continue
    if (!h.cat) continue
    const hDesc = chave(h.descricao)
    const hParte = chave(h.parte)

    // Igualdade de descrição é a evidência forte: mesma linha do extrato,
    // mesma decisão.
    if (alvoDesc && hDesc && hDesc === alvoDesc) { somar(h, 'exata'); continue }
    // Mesmo fornecedor/cliente é evidência fraca: a mesma empresa pode vender
    // coisas de naturezas diferentes.
    if (alvoParte && hParte && hParte === alvoParte) { somar(h, 'parte') }
  }

  return [...candidatos.values()].sort((a, b) => {
    if (a.forca !== b.forca) return a.forca === 'exata' ? -1 : 1
    if (b.vezes !== a.vezes) return b.vezes - a.vezes
    return String(b.ultima).localeCompare(String(a.ultima))
  })
}

/**
 * O histórico resolve sozinho, sem precisar do modelo?
 *
 * Só quando é inequívoco: evidência exata e UMA classificação candidata. Duas
 * classificações para a mesma descrição significam que a própria Juliana
 * decidiu diferente em momentos diferentes — e aí quem decide é ela de novo,
 * não um desempate automático.
 */
export function respostaDoHistorico(candidatos) {
  const cs = candidatos || []
  const exatos = cs.filter(c => c.forca === 'exata')
  if (exatos.length !== 1) return null
  return exatos[0]
}

/** A frase da evidência, do jeito que vai para a tela. */
export function fraseDaEvidencia(c) {
  if (!c) return ''
  const onde = `${c.cat}${c.subcat ? ` › ${c.subcat}` : ''}`
  const quando = c.ultima ? `, a última em ${String(c.ultima).split('-').reverse().join('/')}` : ''
  const quantas = c.vezes === 1 ? 'uma vez' : `${c.vezes} vezes`
  const origem = c.forca === 'exata'
    ? 'Você já classificou esta mesma descrição'
    : 'Você já classificou outros lançamentos desta mesma parte'
  return `${origem} em ${onde} — ${quantas}${quando}.`
}
