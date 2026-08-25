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
  const lday = ld.data_competencia || ld.due
  const nday = nd.data_emissao || nd.data_vencimento
  if (lday && nday) {
    const dias = Math.abs((new Date(lday) - new Date(nday)) / 86400000)
    if (dias <= 3) score += 20
    else if (dias <= 15) score += 10
    else if (dias <= 45) score += 3
  }
  return score
}

// Rankeia as NFs candidatas (só as com score > 0), maior primeiro.
export function rankearNFs(lanc, nfs) {
  return (nfs || [])
    .map(nf => ({ nf, score: pontuarNF(lanc, nf) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
}

// Rótulo de confiança do match, pra UI.
export function confiancaMatch(score) {
  if (score >= 120) return { label: 'forte', cor: 'var(--green)' }
  if (score >= 60) return { label: 'provável', cor: 'var(--gold-dark)' }
  return { label: 'fraco', cor: 'var(--text-mid)' }
}
