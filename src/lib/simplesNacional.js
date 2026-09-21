// =============================================================================
// SIMPLES NACIONAL — Tabelas dos Anexos III e V (vigência 01/01/2018) e helpers.
//
// FONTE ÚNICA das tabelas: texto consolidado da Lei Complementar 123/2006 no
// Planalto (Anexos III e V com redação da LC 155/2016):
//   https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm
// Regras de cálculo: LC 123/2006 art. 18 §§ 1º, 1º-A, 1º-B, 2º, 4º-A, 5º-I,
// 5º-J, 5º-K, 5º-M, 24, 25 e 26; art. 21 § 4º. Regulamento: Resolução CGSN
// 140/2018, arts. 21, 22 e 26.
//
// ATENÇÃO — não "arredonde de cabeça" nenhum número daqui: cada percentual foi
// conferido contra o texto legal. Se precisar mexer, confira na fonte acima.
// =============================================================================

/** Faixas do Anexo III — LC 123/2006, Anexo III (LC 155/2016, vigência 01/01/2018) */
export const ANEXO_III_FAIXAS = [
  { faixa: 1, ate: 180000.00,   aliquota: 0.060,  deduzir: 0.00      },
  { faixa: 2, ate: 360000.00,   aliquota: 0.112,  deduzir: 9360.00   },
  { faixa: 3, ate: 720000.00,   aliquota: 0.135,  deduzir: 17640.00  },
  { faixa: 4, ate: 1800000.00,  aliquota: 0.160,  deduzir: 35640.00  },
  { faixa: 5, ate: 3600000.00,  aliquota: 0.210,  deduzir: 125640.00 },
  { faixa: 6, ate: 4800000.00,  aliquota: 0.330,  deduzir: 648000.00 },
]

/**
 * Percentual de repartição dos tributos — Anexo III.
 * Conferido linha a linha contra o Anexo III da LC 123/2006 (Planalto).
 * As faixas 3 e 4 NÃO repetem a faixa 2 (erro anterior deste arquivo):
 * Cofins 13,64% / PIS 2,96% / ISS 32,50%.
 */
export const ANEXO_III_REPARTICAO = {
  1: { irpj: 0.0400, csll: 0.0350, cofins: 0.1282, pis: 0.0278, cpp: 0.4340, iss: 0.3350 },
  2: { irpj: 0.0400, csll: 0.0350, cofins: 0.1405, pis: 0.0305, cpp: 0.4340, iss: 0.3200 },
  3: { irpj: 0.0400, csll: 0.0350, cofins: 0.1364, pis: 0.0296, cpp: 0.4340, iss: 0.3250 },
  4: { irpj: 0.0400, csll: 0.0350, cofins: 0.1364, pis: 0.0296, cpp: 0.4340, iss: 0.3250 },
  5: { irpj: 0.0400, csll: 0.0350, cofins: 0.1282, pis: 0.0278, cpp: 0.4340, iss: 0.3350 },
  6: { irpj: 0.3500, csll: 0.1500, cofins: 0.1603, pis: 0.0347, cpp: 0.3050, iss: 0.0000 },
}

/** Faixas do Anexo V — serviços intelectuais (art. 18 §5º-I) quando o Fator R < 28% */
export const ANEXO_V_FAIXAS = [
  { faixa: 1, ate: 180000.00,   aliquota: 0.155,  deduzir: 0.00      },
  { faixa: 2, ate: 360000.00,   aliquota: 0.180,  deduzir: 4500.00   },
  { faixa: 3, ate: 720000.00,   aliquota: 0.195,  deduzir: 9900.00   },
  { faixa: 4, ate: 1800000.00,  aliquota: 0.205,  deduzir: 17100.00  },
  { faixa: 5, ate: 3600000.00,  aliquota: 0.230,  deduzir: 62100.00  },
  { faixa: 6, ate: 4800000.00,  aliquota: 0.305,  deduzir: 540000.00 },
]

/** Percentual de repartição dos tributos — Anexo V (Planalto, LC 155/2016) */
export const ANEXO_V_REPARTICAO = {
  1: { irpj: 0.2500, csll: 0.1500, cofins: 0.1410, pis: 0.0305, cpp: 0.2885, iss: 0.1400 },
  2: { irpj: 0.2300, csll: 0.1500, cofins: 0.1410, pis: 0.0305, cpp: 0.2785, iss: 0.1700 },
  3: { irpj: 0.2400, csll: 0.1500, cofins: 0.1492, pis: 0.0323, cpp: 0.2385, iss: 0.1900 },
  4: { irpj: 0.2100, csll: 0.1500, cofins: 0.1574, pis: 0.0341, cpp: 0.2385, iss: 0.2100 },
  5: { irpj: 0.2300, csll: 0.1250, cofins: 0.1410, pis: 0.0305, cpp: 0.2385, iss: 0.2350 },
  6: { irpj: 0.3500, csll: 0.1550, cofins: 0.1644, pis: 0.0356, cpp: 0.2950, iss: 0.0000 },
}

/** Anexos disponíveis nesta calculadora (serviços). */
export const ANEXOS = {
  III: { faixas: ANEXO_III_FAIXAS, reparticao: ANEXO_III_REPARTICAO },
  V:   { faixas: ANEXO_V_FAIXAS,   reparticao: ANEXO_V_REPARTICAO   },
}

/** Fator R: limite legal de 28% (LC 123/2006, art. 18, §§ 5º-J e 5º-M). */
export const FATOR_R_LIMITE = 0.28

/** Percentual efetivo máximo do ISS: 5% (LC 123/2006, art. 18, § 1º-B, I). */
export const TETO_ISS_EFETIVO = 0.05

const TRIBUTOS_FEDERAIS = ['irpj', 'csll', 'cofins', 'pis', 'cpp']

function anexoValido(anexo) {
  const a = String(anexo || 'III').toUpperCase()
  return ANEXOS[a] ? a : 'III'
}

/** Tabela de faixas de um anexo (default: III, para não quebrar chamadas antigas). */
export function faixasDoAnexo(anexo = 'III') {
  return ANEXOS[anexoValido(anexo)].faixas
}

/**
 * Descobre a faixa a partir da RBT12.
 * @param {number} rbt12
 * @param {'III'|'V'} [anexo='III'] — parâmetro OPCIONAL: sem ele, comporta-se
 *   exatamente como antes (Anexo III).
 */
export function descobrirFaixa(rbt12, anexo = 'III') {
  const faixas = faixasDoAnexo(anexo)
  for (const f of faixas) {
    if (rbt12 <= f.ate) return f
  }
  return faixas[faixas.length - 1]
}

/**
 * Alíquota efetiva (LC 123/2006, art. 18, § 1º-A):
 *   efetiva = (RBT12 × alíquota_nominal − parcela_a_deduzir) / RBT12
 */
export function calcularAliquotaEfetiva(rbt12, faixaInfo) {
  if (!rbt12 || rbt12 <= 0) return 0
  return Math.max(0, (rbt12 * faixaInfo.aliquota - faixaInfo.deduzir) / rbt12)
}

/** Repartição "de tabela" (sem o teto do ISS) de uma faixa de um anexo. */
export function reparticaoDaFaixa(faixaNum, anexo = 'III') {
  const tabela = ANEXOS[anexoValido(anexo)].reparticao
  return tabela[faixaNum] || tabela[1]
}

/**
 * Repartição EFETIVA, já com o teto do ISS do art. 18, § 1º-B, I: o percentual
 * efetivo do ISS não passa de 5 pontos percentuais; o excedente vai, de forma
 * proporcional, para os tributos federais da mesma faixa.
 *
 * Esta regra geral reproduz exatamente a tabela especial da 5ª faixa do Anexo
 * III (que vale quando a alíquota efetiva passa de 14,92537% = 5% ÷ 33,50%).
 */
export function reparticaoEfetiva(faixaNum, aliquotaEfetiva = 0, anexo = 'III') {
  const base = reparticaoDaFaixa(faixaNum, anexo)
  const aliq = Number(aliquotaEfetiva) || 0
  const issBase = Number(base.iss) || 0
  if (aliq <= 0 || issBase <= 0) return { ...base }
  if (aliq * issBase <= TETO_ISS_EFETIVO + 1e-12) return { ...base }

  const issShare = TETO_ISS_EFETIVO / aliq          // fração que dá exatos 5 p.p.
  const excedente = issBase - issShare
  const somaFed = TRIBUTOS_FEDERAIS.reduce((s, k) => s + (Number(base[k]) || 0), 0)
  const out = { iss: issShare }
  for (const k of TRIBUTOS_FEDERAIS) {
    const p = Number(base[k]) || 0
    out[k] = somaFed > 0 ? p + excedente * (p / somaFed) : p
  }
  return out
}

/**
 * Fração do ISS dentro da alíquota efetiva daquela faixa/anexo — é ESTE número
 * (e não o valor retido pelo tomador) que deixa de ser recolhido no DAS sobre a
 * receita que sofreu retenção de ISS (art. 18, § 4º-A, II e art. 21, § 4º, VII).
 */
export function percentualIssDaFaixa(faixaNum, aliquotaEfetiva = 0, anexo = 'III') {
  return Number(reparticaoEfetiva(faixaNum, aliquotaEfetiva, anexo).iss) || 0
}

/** Fator R = folha de salários 12 meses ÷ receita bruta 12 meses (art. 18, § 5º-K). */
export function calcularFatorR({ folha12, rbt12 }) {
  const f = Number(folha12) || 0
  const r = Number(rbt12) || 0
  if (r <= 0) return null           // sem receita não há razão a calcular
  return f / r
}

/**
 * Anexo que vale por causa do Fator R, para os serviços do art. 18, § 5º-I
 * (consultoria, auditoria, gestão, etc.): ≥ 28% → Anexo III; < 28% → Anexo V.
 * Sem base para calcular (receita zero), fica no Anexo V — que é a regra geral
 * desses serviços; o Anexo III é a exceção que precisa ser provada pela folha.
 */
export function anexoPorFatorR(fatorR) {
  if (fatorR == null || !Number.isFinite(fatorR)) return 'V'
  return fatorR >= FATOR_R_LIMITE ? 'III' : 'V'
}

/** Folha mínima, nos 12 meses, para o Fator R alcançar 28% da receita. */
export function folhaMinimaParaAnexoIII(rbt12) {
  return Math.max(0, (Number(rbt12) || 0) * FATOR_R_LIMITE)
}

/**
 * RBT12 de empresa em início de atividade (LC 123/2006, art. 18, § 2º;
 * Resolução CGSN 140/2018, art. 22, §§ 2º e 3º): média aritmética da receita
 * bruta dos meses já existentes × 12.
 */
export function proporcionalizarRBT12(somaReceitas, mesesComAtividade) {
  const meses = Number(mesesComAtividade) || 0
  if (meses <= 0) return 0
  return ((Number(somaReceitas) || 0) / meses) * 12
}

/**
 * Projeta o DAS do período.
 *
 * Modo NOVO (quando `receitaComRetencaoIss` é informada) — segregação de
 * receitas do art. 18, § 4º-A, II:
 *   DAS = receita_sem_retenção × alíq. efetiva
 *       + receita_com_retenção × alíq. efetiva × (1 − %ISS da faixa)
 * ou seja: sobre a receita que sofreu retenção, o que deixa de ser recolhido é
 * a PARCELA DO ISS dentro da alíquota efetiva — não o valor retido pelo tomador.
 *
 * Modo LEGADO (sem `receitaComRetencaoIss`): mantém o comportamento antigo
 * (DAS nominal − valor retido), para não quebrar chamadas existentes.
 *
 * `retencaoIssEstimadaTotal` é a parte dos ajustes de ISS que não deu para
 * amarrar a nenhuma receita: ela cai no método antigo, só para aquele valor.
 */
export function projetarDAS({
  faturamentoMes,
  aliquotaEfetiva,
  retencaoIssTotal = 0,
  receitaComRetencaoIss = null,
  percentualIssFaixa = 0,
  retencaoIssEstimadaTotal = 0,
}) {
  const receita = Number(faturamentoMes) || 0
  const aliq = Number(aliquotaEfetiva) || 0
  const dasNominal = receita * aliq

  if (receitaComRetencaoIss == null) {
    const dasLiquido = Math.max(0, dasNominal - (Number(retencaoIssTotal) || 0))
    return {
      metodo: 'legado',
      faturamentoMes: receita,
      aliquotaEfetiva: aliq,
      dasNominal,
      receitaSemRetencao: receita,
      receitaComRetencao: 0,
      percentualIssFaixa: 0,
      abatimentoIss: 0,
      abatimentoEstimado: Number(retencaoIssTotal) || 0,
      retencaoIss: Number(retencaoIssTotal) || 0,
      dasLiquido,
    }
  }

  const comRet = Math.min(Math.max(0, Number(receitaComRetencaoIss) || 0), receita)
  const semRet = Math.max(0, receita - comRet)
  const pctIss = Math.min(1, Math.max(0, Number(percentualIssFaixa) || 0))
  const abatimentoIss = comRet * aliq * pctIss
  const abatimentoEstimado = Math.max(0, Number(retencaoIssEstimadaTotal) || 0)
  const dasLiquido = Math.max(0, semRet * aliq + comRet * aliq * (1 - pctIss) - abatimentoEstimado)

  return {
    metodo: 'segregado',
    faturamentoMes: receita,
    aliquotaEfetiva: aliq,
    dasNominal,
    receitaSemRetencao: semRet,
    receitaComRetencao: comRet,
    percentualIssFaixa: pctIss,
    abatimentoIss,
    abatimentoEstimado,
    retencaoIss: Number(retencaoIssTotal) || 0,
    dasLiquido,
  }
}

/**
 * Distribui o valor do DAS entre os tributos conforme a repartição da faixa.
 * `anexo` e `aliquotaEfetiva` são OPCIONAIS — sem eles o comportamento é o
 * mesmo de antes (Anexo III, repartição de tabela).
 */
export function compor(dasLiquido, faixaNum, anexo = 'III', aliquotaEfetiva = 0) {
  const r = aliquotaEfetiva > 0
    ? reparticaoEfetiva(faixaNum, aliquotaEfetiva, anexo)
    : reparticaoDaFaixa(faixaNum, anexo)
  return Object.fromEntries(
    Object.entries(r).map(([k, pct]) => [k, dasLiquido * pct])
  )
}

const isoLocal = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Dia 20 do mês seguinte ao período de apuração (YYYY-MM-DD, sem deslocamento de fuso) */
export function vencimentoDAS(periodoYM) {
  const [y, m] = String(periodoYM).split('-').map(Number)
  return isoLocal(new Date(y, m, 20)) // m=1-12 do período → índice m no JS já é o mês seguinte
}

/** Último dia do período de apuração (YYYY-MM-DD) — data de competência da guia DAS */
export function ultimoDiaDoMes(periodoYM) {
  const [y, m] = String(periodoYM).split('-').map(Number)
  return isoLocal(new Date(y, m, 0)) // dia 0 do mês seguinte = último dia do período
}
