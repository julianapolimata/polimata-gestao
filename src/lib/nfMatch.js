// =============================================================================
// Casamento NF (nf_pending, lida do e-mail) ↔ lançamento a escriturar.
// Rankeia as notas do e-mail que mais combinam com um lançamento por
// valor + emitente(CNPJ/nome) + proximidade de data. Serve pro seletor de NF.
// =============================================================================
import { normalizarFornecedor } from './escrituracao'

const digits = s => String(s || '').replace(/\D/g, '')

// Pontua o quão provável é que a NF `nf` seja a nota daquele lançamento.
export function pontuarNF(lanc, nf) {
  const ld = lanc.data || lanc
  const nd = nf.data || nf
  let score = 0
  // 1) VALOR (peso maior) — exato bate forte; pequena diferença ainda conta.
  const lv = Math.abs(Number(ld.value || 0))
  const nv = Math.abs(Number(nd.valor || 0))
  if (lv && nv) {
    const diff = Math.abs(lv - nv)
    if (diff < 0.01) score += 100
    else if (diff <= lv * 0.02) score += 55
    else if (diff <= lv * 0.10) score += 18
  }
  // 2) EMITENTE — CNPJ igual é forte; senão, nome que contém.
  const lc = digits(ld.cnpj || ld.emitente_cnpj || ld.cnpj_emitente)
  const nc = digits(nd.emitente_cnpj || nd.destinatario_cnpj)
  if (lc && nc && lc === nc) score += 50
  else {
    const ln = normalizarFornecedor(ld.supplier || ld.client || ld.desc)
    const nn = normalizarFornecedor(nd.emitente_nome || nd.parte || nd.destinatario_nome)
    if (ln && nn && (ln.includes(nn) || nn.includes(ln))) score += 28
  }
  // 3) DATA — proximidade entre competência/vencimento e emissão da NF.
  //
  // Numa assinatura mensal de valor fixo o VALOR é o sinal que menos distingue:
  // todo mês tem o mesmo. Quem identifica a nota é a data. Por isso o mesmo mês
  // pesa alto, e distância grande SUBTRAI em vez de apenas deixar de somar.
  //
  // O caso que mostrou isto: lançamento do Google de R$ 294,00 com competência
  // em 01/01/2026 recebia como "prováveis" as notas de 31/08 e 30/09, de valor
  // idêntico e oito meses de distância — 100 pontos só do valor, zero da data.
  // A nota do próprio mês (31/01, R$ 278,86) ficava de fora, com 21 pontos.
  // Vincular uma delas uniria os registros e apagaria um lançamento legítimo.
  // A DIREÇÃO importa tanto quanto a distância: a nota é emitida ANTES do
  // pagamento, nunca depois. No cartão a cobrança cai um dia após a emissão; no
  // boleto, cerca de trinta dias — mês seguinte. Nota emitida DEPOIS da data do
  // lançamento quase sempre é a nota do pagamento seguinte, não deste.
  //
  // Foi o que uma primeira tentativa errou: premiar "mesmo mês" casou o
  // pagamento de 15/01 do Microsoft 365 com a nota de 19/01 — que é a nota do
  // pagamento de 18/02, já conciliada. O mês é proxy ruim; a ordem não é.
  const lday = ld.data_competencia || ld.due
  const nday = nd.data_emissao || nd.data_vencimento
  if (lday && nday) {
    const desvio = (new Date(nday) - new Date(lday)) / 86400000 // > 0 = nota DEPOIS
    const dias = Math.abs(desvio)
    let pts
    if (dias <= 3) pts = 20          // cartão: cobrança no dia seguinte à emissão
    else if (dias <= 45) pts = 15    // boleto: pagamento no mês seguinte
    else if (dias <= 120) pts = 3
    else pts = -60                   // meses de distância derrubam, não empatam
    if (desvio > 2) pts -= 35        // nota emitida depois do pagamento
    score += pts
  }
  return score
}

// Score mínimo pra uma NF ser considerada candidata. Abaixo disso é só ruído
// (ex.: coincidência de data com valor/emitente totalmente diferentes) — não mostra.
// 35 exige pelo menos valor próximo (≤2%) OU CNPJ igual OU nome + data.
export const MIN_SCORE = 35

// Rankeia as NFs candidatas (só as que passam do mínimo), maior primeiro.
// Direção da NF (receita × despesa) — uma NF de receita nunca casa com uma despesa.
export function tabelaDaNF(nf) {
  const nd = nf?.data || nf || {}
  const isSaida = nd.is_saida || nd.tipo === 'saida'
  return nd.target_table || (isSaida ? 'receivable' : 'payable')
}

// Rankeia as NFs candidatas (só as que passam do mínimo E têm a mesma direção do
// lançamento), maior primeiro. Sem o filtro de direção, vincular uma NF de receita
// a uma compra criava a receita e APAGAVA a despesa.
export function rankearNFs(lanc, nfs, tabela) {
  return (nfs || [])
    .filter(nf => !tabela || tabelaDaNF(nf) === tabela)
    .map(nf => ({ nf, score: pontuarNF(lanc, nf) }))
    .filter(x => x.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
}

// A EVIDÊNCIA do casamento, em palavras. O score é um número interno; quem
// decide precisa ver o motivo — "mesmo valor, mesma data" é verificável, "148
// pontos" não é.
export function motivosDoMatch(lanc, nf) {
  const ld = lanc?.data || lanc || {}
  const nd = nf?.data || nf || {}
  const motivos = []
  const lv = Math.abs(Number(ld.value || 0))
  const nv = Math.abs(Number(nd.valor || 0))
  if (lv && nv) {
    const diff = Math.abs(lv - nv)
    if (diff < 0.01) motivos.push('mesmo valor')
    else if (diff <= lv * 0.02) motivos.push('valor quase igual')
  }
  const lc = digits(ld.cnpj || ld.emitente_cnpj || ld.cnpj_emitente)
  const nc = digits(nd.emitente_cnpj || nd.destinatario_cnpj)
  if (lc && nc && lc === nc) motivos.push('mesmo CNPJ')
  else {
    const ln = normalizarFornecedor(ld.supplier || ld.client || ld.desc)
    const nn = normalizarFornecedor(nd.emitente_nome || nd.parte || nd.destinatario_nome)
    if (ln && nn && (ln.includes(nn) || nn.includes(ln))) motivos.push('mesmo fornecedor')
  }
  const lday = ld.data_competencia || ld.due
  const nday = nd.data_emissao || nd.data_vencimento
  if (lday && nday) {
    const desvio = Math.round((new Date(nday) - new Date(lday)) / 86400000)
    const dias = Math.abs(desvio)
    // Quem decide precisa ver a distância E a ordem escritas: é o que separa a
    // nota certa da nota de outro mês com o mesmo valor.
    if (desvio > 2) motivos.push(`⚠️ nota emitida ${dias} dia(s) DEPOIS do pagamento`)
    else if (dias === 0) motivos.push('mesma data')
    else if (dias <= 45) motivos.push(`nota ${dias} dia(s) antes do pagamento`)
    else if (dias > 120) motivos.push(`⚠️ ${Math.round(dias / 30)} meses de diferença`)
    else motivos.push(`${dias} dias de diferença`)
  }
  return motivos
}

// Existe UMA nota obviamente certa? Só quando ela é forte E está claramente à
// frente da segunda.
//
// Por que isto importa: vincular UNE os dois registros e APAGA a compra
// duplicada. Numa lista de cinco notas do mesmo fornecedor, todas do mesmo
// valor, diferindo só no mês, o clique errado apaga o lançamento errado — e o
// erro não aparece em lugar nenhum. Quando a resposta é uma só, a tela mostra
// uma só.
export const VANTAGEM_MINIMA = 20
export function notaObvia(ranking) {
  if (!ranking?.length) return null
  const [primeira, segunda] = ranking
  if (primeira.score < 120) return null
  if (segunda && primeira.score - segunda.score < VANTAGEM_MINIMA) return null
  return primeira
}

// Rótulo de confiança do match, pra UI.
export function confiancaMatch(score) {
  if (score >= 120) return { label: 'forte', cor: 'var(--green)' }
  if (score >= 60) return { label: 'provável', cor: 'var(--gold-dark)' }
  return { label: 'fraco', cor: 'var(--text-mid)' }
}
