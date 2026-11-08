// =============================================================================
// ESCRITURAÇÃO — 1ª camada da conciliação (metodologia da Juliana).
//
// Regra: nenhuma nota entra na conciliação sem ser ESCRITURADA (revisada:
// categoria, natureza, classificação contábil E situação fiscal). No import
// tudo entra como "A escriturar" e espera aprovação manual.
//
// EXCEÇÃO — recorrente já aprovada: um lançamento igual a um que a Juliana já
// escriturou MANUALMENTE antes sobe sozinho, copiando FIELMENTE a classificação
// da versão aprovada. Só quando o histórico daquele fornecedor é UNÂNIME
// (mesma cat+subcat+situação fiscal). Divergência no passado → espera manual.
// =============================================================================

// Normaliza o nome do fornecedor/descrição pra virar chave estável:
//  • corta a partir do sufixo de parcela (NN/MM…) — remove também a cidade que
//    vem depois no cartão (ex.: "PORTO SEGURO 05/12 SAO PAULO" → "porto seguro");
//  • remove números longos (CNPJ/CPF sem formato), pontuação e espaços extras.
export function normalizarFornecedor(s) {
  return String(s || '')
    .replace(/\s*\d{1,2}\s*\/\s*\d{1,2}.*$/, '') // parcela e tudo depois
    .toLowerCase()
    .replace(/\d{6,}/g, ' ')
    .replace(/[^a-z0-9à-ú\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Chave de "mesmo lançamento recorrente", em três níveis, do mais forte ao mais
// fraco. A ORDEM é deliberada:
//
//  1) CNPJ — continua primeiro, e não por acaso: é o que as regras existentes já
//     usam. Pôr o vínculo na frente reclassificaria tudo que hoje chaveia por
//     CNPJ e partiria as regras aprendidas em duas metades.
//  2) pessoa_id — o VÍNCULO com o cadastro. Vale justamente onde não há CNPJ,
//     que é a compra de cartão: ali a chave era o descritivo do lojista, e o
//     mesmo fornecedor virava duas regras por estar escrito de dois jeitos.
//     "POLI INSTR VINHEDO" e "POLIINSTRUMENTOS" passam a ser a mesma coisa.
//  3) descrição normalizada — o que sempre existiu, para quem não tem nem um
//     nem outro. Nada que funciona hoje deixa de funcionar.
export function chaveRecorrente(data) {
  const cnpj = String(data?.cnpj || data?.emitente_cnpj || data?.cnpj_emitente || '').replace(/\D/g, '')
  if (cnpj.length === 14) return `cnpj:${cnpj}`
  const pessoa = String(data?.pessoa_id || '').trim()
  if (pessoa) return `pessoa:${pessoa}`
  const base = data?.supplier || data?.client || data?.desc || ''
  const norm = normalizarFornecedor(base)
  return norm ? `desc:${norm}` : null
}

// A "classificação" que uma regra copia (nunca valor/data — esses vêm da nota nova).
// Situação fiscal = doc_status (campo que já existe): vinculado (com NF) /
// dispensado (sem NF, com motivo) / pendente (NF pendente).
function classificacaoDe(data) {
  return {
    cat: data?.cat || '',
    subcat: data?.subcat || '',
    doc_status: data?.doc_status || '',
    doc_motivo_dispensa: data?.doc_motivo_dispensa || '',
  }
}
const assinatura = c => `${c.cat}||${c.subcat}||${c.doc_status}||${c.doc_motivo_dispensa}`

// Constrói o mapa de regras a partir das notas escrituradas MANUALMENTE (as
// decisões reais da Juliana — grandfather/auto NÃO viram regra). Uma chave só
// vira regra se TODAS as escriturações manuais daquele fornecedor concordam
// (mesma assinatura de classificação). Divergência → chave descartada.
//   @param notas  array de linhas {data:{...}} de payable/receivable
//   @returns Map<chave, {tabela, ...classificacao}>
export function construirRegras(notas) {
  const acc = new Map() // chave -> Map<assinatura, {classificacao, tabela}>
  // Quantos lançamentos sustentam cada chave. A tela mostra esse número: uma
  // regra apoiada em sete escriturações iguais pede menos conferência que uma
  // apoiada em uma só, e quem decide isso é ela, não o sistema.
  const quantos = new Map()
  for (const n of notas || []) {
    const d = n.data || n
    if (d?.escriturado !== true) continue
    if (d?.escriturado_por !== 'manual') continue
    if (!d?.cat || !d?.doc_status) continue // sem classificação/situação fiscal real
    const chave = chaveRecorrente(d)
    if (!chave) continue
    const c = classificacaoDe(d)
    const sig = assinatura(c)
    quantos.set(chave, (quantos.get(chave) || 0) + 1)
    if (!acc.has(chave)) acc.set(chave, new Map())
    const m = acc.get(chave)
    if (!m.has(sig)) m.set(sig, { classificacao: c, tabela: n.tabela || null })
  }
  const regras = new Map()
  for (const [chave, m] of acc) {
    if (m.size === 1) { // UNÂNIME
      const only = [...m.values()][0]
      // `origem` e `quantos` são para a TELA, não para o lançamento:
      // escriturarAuto copia campo a campo e não os leva junto.
      regras.set(chave, { ...only.classificacao, origem: 'viva', quantos: quantos.get(chave) || 0 })
    }
    // m.size > 1 → histórico divergente: NÃO cria regra (espera manual)
  }
  return regras
}

// Dada uma nota nova e o mapa de regras, retorna a classificação a aplicar ou null.
export function regraPara(data, regras) {
  if (!regras || regras.size === 0) return null
  const chave = chaveRecorrente(data)
  if (!chave) return null
  return regras.get(chave) || null
}

// sem_documento derivado do doc_status (mantém o campo legado coerente).
export const semDocumentoDe = docStatus => docStatus === 'pendente'

// Aplica a regra numa nota (retorna novo objeto data escriturado automaticamente).
// FIELMENTE: copia só a classificação; valor/data/fornecedor originais ficam.
export function escriturarAuto(data, regra, agoraISO) {
  return {
    ...data,
    cat: regra.cat,
    subcat: regra.subcat,
    doc_status: regra.doc_status,
    doc_motivo_dispensa: regra.doc_motivo_dispensa,
    sem_documento: semDocumentoDe(regra.doc_status),
    escriturado: true,
    escriturado_em: agoraISO,
    escriturado_por: 'auto',
    escriturado_regra: chaveRecorrente(data),
  }
}

// Rótulos e opções da situação fiscal — reusa doc_status (campo que já existe).
// Um conceito, um nome: estes três textos são os mesmos em toda a interface
// (Escrituração, lançamento, listas). Os valores gravados no banco não mudam.
export const SITUACOES_FISCAIS = [
  { value: 'vinculado', label: 'Tenho a nota' },
  { value: 'pendente', label: 'A nota vai chegar' },
  { value: 'dispensado', label: 'Não tem nota' },
]
export const rotuloSituacaoFiscal = v => ({
  vinculado: 'Tenho a nota', pendente: 'A nota vai chegar', dispensado: 'Não tem nota',
}[v] || '—')
