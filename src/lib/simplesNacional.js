// =============================================================================
// SIMPLES NACIONAL — Tabelas do Anexo III (2024-2026) e helpers de cálculo.
// Referência: Lei Complementar 123/2006, atualizada pela LC 155/2016.
// =============================================================================

/** Faixas do Anexo III (serviços comuns — consultoria) — RBT12 + alíquota nominal + parcela a deduzir */
export const ANEXO_III_FAIXAS = [
  { faixa: 1, ate: 180000.00,   aliquota: 0.060,  deduzir: 0.00      },
  { faixa: 2, ate: 360000.00,   aliquota: 0.112,  deduzir: 9360.00   },
  { faixa: 3, ate: 720000.00,   aliquota: 0.135,  deduzir: 17640.00  },
  { faixa: 4, ate: 1800000.00,  aliquota: 0.160,  deduzir: 35640.00  },
  { faixa: 5, ate: 3600000.00,  aliquota: 0.210,  deduzir: 125640.00 },
  { faixa: 6, ate: 4800000.00,  aliquota: 0.330,  deduzir: 648000.00 },
]

/** Percentual de cada tributo dentro do Simples (Anexo III) por faixa */
export const ANEXO_III_REPARTICAO = {
  1: { irpj: 0.04,   csll: 0.035, cofins: 0.1282, pis: 0.0278, cpp: 0.434, iss: 0.335 },
  2: { irpj: 0.04,   csll: 0.035, cofins: 0.1405, pis: 0.0305, cpp: 0.434, iss: 0.320 },
  3: { irpj: 0.04,   csll: 0.035, cofins: 0.1405, pis: 0.0305, cpp: 0.434, iss: 0.320 },
  4: { irpj: 0.04,   csll: 0.035, cofins: 0.1405, pis: 0.0305, cpp: 0.434, iss: 0.320 },
  5: { irpj: 0.041,  csll: 0.035, cofins: 0.1543, pis: 0.0335, cpp: 0.425, iss: 0.3115 },
  6: { irpj: 0.350,  csll: 0.150, cofins: 0.1303, pis: 0.0283, cpp: 0.341, iss: 0.000  },
}

/**
 * Calcula alíquota efetiva para uma RBT12 + faixa. Fórmula oficial:
 *   efetiva = (RBT12 × alíquota_nominal - parcela_deduzir) / RBT12
 */
export function calcularAliquotaEfetiva(rbt12, faixaInfo) {
  if (!rbt12 || rbt12 <= 0) return 0
  return Math.max(0, (rbt12 * faixaInfo.aliquota - faixaInfo.deduzir) / rbt12)
}

/** Descobre faixa a partir da RBT12 */
export function descobrirFaixa(rbt12) {
  for (const f of ANEXO_III_FAIXAS) {
    if (rbt12 <= f.ate) return f
  }
  return ANEXO_III_FAIXAS[ANEXO_III_FAIXAS.length - 1]
}

/**
 * Projeta DAS do próximo mês:
 *  - faturamento: soma das NFS-e emitidas neste mês (receivable)
 *  - alíquota efetiva atual (config) — sistema usa o último DAS como referência
 *  - opcionalmente já desconta retenções de ISS na fonte
 */
export function projetarDAS({ faturamentoMes, aliquotaEfetiva, retencaoIssTotal = 0 }) {
  const dasNominal = Number(faturamentoMes) * Number(aliquotaEfetiva)
  const dasLiquido = Math.max(0, dasNominal - Number(retencaoIssTotal || 0))
  return {
    faturamentoMes,
    aliquotaEfetiva,
    dasNominal,
    retencaoIss: retencaoIssTotal,
    dasLiquido,
  }
}

/** Distribui o valor do DAS entre os tributos conforme a repartição da faixa */
export function compor(dasLiquido, faixaNum) {
  const r = ANEXO_III_REPARTICAO[faixaNum] || ANEXO_III_REPARTICAO[3]
  return Object.fromEntries(
    Object.entries(r).map(([k, pct]) => [k, dasLiquido * pct])
  )
}

/** Dia 20 do mês seguinte ao período de apuração */
export function vencimentoDAS(periodoYM) {
  const [y, m] = String(periodoYM).split('-').map(Number)
  const venc = new Date(y, m, 20) // m=0-11 já é mês seguinte (mês atual no JS é m-1)
  return venc.toISOString().slice(0, 10)
}
