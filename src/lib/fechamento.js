import { supabase } from './supabase'

// =============================================================================
// FECHAMENTO MENSAL — helpers compartilhados.
// Mês fechado = registro em `fechamentos` com status 'fechado'. O banco (trigger)
// recusa INSERT/DELETE e UPDATE fora dos campos de caixa/prova em mês fechado;
// aqui a tela pré-checa pra dar uma mensagem amigável ANTES do erro do banco.
// =============================================================================

export const MESES_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/** 'YYYY-MM' → 'set/26' */
export function mesLabel(ym) {
  if (!ym) return '—'
  const [y, m] = String(ym).split('-')
  return `${MESES_PT[Number(m) - 1] || m}/${String(y).slice(2)}`
}

// ── Cache em módulo ──────────────────────────────────────────────────────────
let _cache = null
let _inflight = null

/** Lista de fechamentos do usuário (RLS). Cacheada até invalidarFechamentos(). */
export async function fetchFechamentos() {
  if (_cache) return _cache
  if (_inflight) return _inflight
  _inflight = supabase.from('fechamentos').select('*')
    .then(({ data, error }) => {
      _inflight = null
      if (error) throw error
      _cache = data || []
      return _cache
    })
    .catch(e => { _inflight = null; throw e })
  return _inflight
}

export function invalidarFechamentos() {
  _cache = null
  _inflight = null
}

/** Competência de um lançamento (jsonb `data`): left(data_competencia || due, 7). */
export function competenciaDe(data) {
  const ref = data?.data_competencia || data?.due
  return ref ? String(ref).slice(0, 7) : null
}

/** true se a competência 'YYYY-MM' está fechada. */
export function mesFechado(fechamentos, comp) {
  if (!comp || !Array.isArray(fechamentos)) return false
  return fechamentos.some(f => f.competencia === comp && f.status === 'fechado')
}

/**
 * Se o erro veio das regras de fechamento (trigger/RPC), devolve o texto
 * em português (parte após o prefixo). Senão, null.
 */
const PREFIXOS = ['periodo_fechado:', 'mes_anterior_aberto:', 'mes_corrente:', 'justificativa_curta:', 'mes_seguinte_fechado:']
export function traduzErroFechamento(err) {
  const msg = String(err?.message || err?.details || err || '')
  for (const p of PREFIXOS) {
    const i = msg.indexOf(p)
    if (i >= 0) return msg.slice(i + p.length).trim() || msg
  }
  return null
}

/** Mensagem padrão da guarda de tela para um lançamento em mês fechado. */
export function msgMesFechado(comp) {
  return `O mês ${mesLabel(comp)} está fechado. Reabra em Fechamento Mensal com justificativa, ou lance na competência atual.`
}
