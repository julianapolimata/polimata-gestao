// =============================================================================
// Recorrências — cálculo de ocorrências de um "mestre" (não materializa nada;
// só projeta as datas). A materialização em receivable/payable é passo à parte.
// =============================================================================
import { today } from './finance'

export const FREQUENCIAS = [
  { v: 'mensal', l: 'Mensal', meses: 1 },
  { v: 'bimestral', l: 'Bimestral', meses: 2 },
  { v: 'trimestral', l: 'Trimestral', meses: 3 },
  { v: 'semestral', l: 'Semestral', meses: 6 },
  { v: 'anual', l: 'Anual', meses: 12 },
]

function mesesDe(freq) {
  return FREQUENCIAS.find(f => f.v === freq)?.meses || 1
}

// Data no mês-alvo com o dia clampado ao último dia do mês (ex.: dia 31 em fev).
function dataNoMes(ano, mes, dia) {
  const ultimo = new Date(ano, mes + 1, 0).getDate()
  return new Date(ano, mes, Math.min(dia, ultimo))
}

function ymd(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

function dadosDe(mestre) {
  return (mestre && mestre.data) ? mestre.data : (mestre || {})
}

/**
 * Datas de ocorrência (YYYY-MM-DD) entre `deISO` e `ateISO`, inclusive.
 * Respeita ativo, data_inicio, data_fim, frequência e dia de vencimento.
 */
export function ocorrenciasEntre(mestre, deISO, ateISO) {
  const d = dadosDe(mestre)
  if (d.ativo === false) return []
  if (!d.data_inicio) return []
  const dia = Number(d.dia_vencimento) || 1
  const passo = mesesDe(d.frequencia)
  const inicio = new Date(d.data_inicio + 'T12:00:00')
  const de = new Date(deISO + 'T12:00:00')
  const ate = new Date(ateISO + 'T12:00:00')
  const fim = d.data_fim ? new Date(d.data_fim + 'T12:00:00') : null
  const out = []
  for (let k = 0; k < 1200; k++) {
    const cur = dataNoMes(inicio.getFullYear(), inicio.getMonth() + passo * k, dia)
    if (cur > ate) break
    if (fim && cur > fim) break
    if (cur >= de) out.push(ymd(cur))
  }
  return out
}

/** Próxima ocorrência a partir de hoje (ou de `apartirISO`). null se encerrada. */
export function proximaOcorrencia(mestre, apartirISO) {
  const de = apartirISO || today()
  const anoTeto = Number(de.slice(0, 4)) + 5
  return ocorrenciasEntre(mestre, de, `${anoTeto}-12-31`)[0] || null
}

/** Valor mensal equivalente (pra somatórios comparáveis): valor ÷ meses do ciclo. */
export function valorMensalEquivalente(mestre) {
  const d = dadosDe(mestre)
  if (d.ativo === false) return 0
  return (Number(d.valor) || 0) / mesesDe(d.frequencia)
}
