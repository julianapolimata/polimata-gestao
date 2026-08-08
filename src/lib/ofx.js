// =============================================================================
// Parser OFX (Open Financial eXchange) — formato exportado por todos
// os bancos BR. Implementação JS pura, sem deps externas.
// =============================================================================

/**
 * Parse o conteúdo de um arquivo OFX e retorna lista de transações.
 *
 * @param {string} texto - conteúdo bruto do arquivo .ofx
 * @returns {{transacoes: Array, saldoFinal: number|null, periodoIni: string|null, periodoFim: string|null}}
 */
export function parseOFX(texto) {
  const transacoes = []
  // Normaliza quebras de linha; OFX antigo (SGML) usa tags sem fechamento explícito
  const blocos = String(texto).split(/<STMTTRN>/i).slice(1)
  for (const bloco of blocos) {
    const txt = bloco.split(/<\/STMTTRN>/i)[0]
    const trnType = pick(txt, 'TRNTYPE')       // CREDIT, DEBIT, PIX, etc
    const dtPosted = pick(txt, 'DTPOSTED')     // YYYYMMDDHHMMSS
    const amount = pick(txt, 'TRNAMT')         // -123.45 ou 123.45
    const fitId = pick(txt, 'FITID')           // ID único no banco
    const memo = pick(txt, 'MEMO')             // descrição
    const name = pick(txt, 'NAME')             // descrição alternativa
    const checkNum = pick(txt, 'CHECKNUM')
    const amtNum = parseAmount(amount)
    if (!dtPosted || Number.isNaN(amtNum)) continue
    const valor = Math.abs(amtNum)
    const tipo = amtNum >= 0 ? 'entrada' : 'saida'
    const dataISO = normalizarData(dtPosted)
    // NAME tem nome do favorecido + CNPJ (mais útil); MEMO é genérico tipo "PIX EMITIDO".
    // Concatena se ambos existem e diferem.
    const nameStr = (name || '').trim()
    const memoStr = (memo || '').trim()
    let descricao
    if (nameStr && memoStr && nameStr !== memoStr) descricao = `${nameStr} · ${memoStr}`
    else descricao = nameStr || memoStr
    transacoes.push({
      fit_id: fitId || null,
      tipo, valor, data: dataISO,
      descricao,
      trn_type: trnType || null,
      check_num: checkNum || null,
      // Procura CNPJ em NAME + MEMO combinados (CNPJ pode estar em qualquer um)
      cnpj: extrairCNPJ(`${nameStr} ${memoStr}`),
    })
  }
  // Saldo final
  const saldoFinalStr = pick(texto, 'BALAMT')
  const saldoFinal = saldoFinalStr ? Number(saldoFinalStr) : null
  // Período do extrato
  const periodoIni = normalizarData(pick(texto, 'DTSTART') || '')
  const periodoFim = normalizarData(pick(texto, 'DTEND') || '')
  return { transacoes, saldoFinal, periodoIni, periodoFim }
}

function pick(txt, tag) {
  const re = new RegExp(`<${tag}>([^<\\n]*)`, 'i')
  const m = txt.match(re)
  return m ? m[1].trim() : ''
}

// Converte o TRNAMT do OFX em número. A spec manda ponto decimal, mas alguns
// bancos exportam vírgula (e ponto de milhar) — normaliza os dois casos.
// Antes, "123,45" virava NaN e "casava" com qualquer lançamento na conciliação.
function parseAmount(s) {
  if (s == null) return NaN
  let t = String(s).trim()
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.')
  return Number(t)
}

function normalizarData(s) {
  if (!s) return null
  const limpo = s.replace(/[^\d]/g, '')
  if (limpo.length < 8) return null
  return `${limpo.substring(0, 4)}-${limpo.substring(4, 6)}-${limpo.substring(6, 8)}`
}

/** Extrai CNPJ de uma string. Aceita formatos NN.NNN.NNN/NNNN-NN ou só dígitos. */
function extrairCNPJ(s) {
  if (!s) return null
  // Tenta o formato canônico primeiro
  let m = s.match(/(\d{2}\.\d{3}\.\d{3}[/\\]\d{4}-?\d{2})/)
  if (m) return m[1].replace(/\D/g, '')
  // Ou 14 dígitos seguidos / separados por espaços
  m = s.match(/(\d{2}[\s.]?\d{3}[\s.]?\d{3}[\s\\/]?\d{4}[\s-]?\d{2})/)
  if (m) {
    const apenasDigitos = m[1].replace(/\D/g, '')
    if (apenasDigitos.length === 14) return apenasDigitos
  }
  return null
}

/**
 * Normaliza descrição: remove pontuação, espaços extras, números longos
 * (CNPJ, CPF, valores). Usado pra agrupar transações similares.
 */
export function normalizarDescricao(s) {
  if (!s) return ''
  return String(s)
    .toUpperCase()
    .replace(/[\d./\\-]{8,}/g, '') // remove sequências de números longos
    .replace(/[^A-Z\sÀ-Ú]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
