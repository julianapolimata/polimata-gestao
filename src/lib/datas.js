// =============================================================================
// DATAS — o calendário do sistema, sem depender do navegador.
//
// O campo `<input type="date">` abre o calendário DO CHROME: fonte do Windows,
// cores do sistema, nada da identidade da casa. Não há CSS que alcance aquele
// painel — ele é desenhado pelo navegador, fora da página. A única saída é
// desenhar o nosso.
//
// Aqui fica só a conta. O desenho está em src/components/CampoData.jsx, e a
// separação é de propósito: data é onde mais se erra em silêncio, e erro de
// data não aparece na tela — aparece no fechamento do mês, três semanas
// depois.
//
// ── A ARMADILHA DO FUSO ─────────────────────────────────────────────────────
//
// `new Date('2025-05-22')` é interpretado como MEIA-NOITE EM UTC. No Brasil
// (UTC-3) isso vira 21/05 às 21h, e `.toISOString().slice(0,10)` devolve
// "2025-05-21": um dia a menos, sem aviso, sempre para trás.
//
// Por isso nada aqui usa Date para converter texto, e nada usa toISOString.
// A data do sistema é uma STRING "AAAA-MM-DD", e as contas de calendário usam
// Date apenas com ano/mês/dia separados (`new Date(2025, 4, 22)`), que é local
// e não passa por fuso nenhum.
// =============================================================================

export const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]

export const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

const d2 = n => String(n).padStart(2, '0')

/** Hoje em AAAA-MM-DD, pelo relógio local — nunca por UTC. */
export function hojeISO(agora = new Date()) {
  return `${agora.getFullYear()}-${d2(agora.getMonth() + 1)}-${d2(agora.getDate())}`
}

/** A string é uma data AAAA-MM-DD que existe de verdade? (31/02 não existe) */
export function ehISO(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ''))
  if (!m) return false
  const [, a, mes, dia] = m.map(Number)
  if (mes < 1 || mes > 12) return false
  return dia >= 1 && dia <= diasNoMes(a, mes - 1)
}

/** Quantos dias tem o mês (mes é 0-11). O dia 0 do mês seguinte é o último deste. */
export function diasNoMes(ano, mes) {
  return new Date(ano, mes + 1, 0).getDate()
}

/** "2025-05-22" → "22/05/2025". Vazio continua vazio. */
export function paraBR(iso) {
  if (!ehISO(iso)) return ''
  const [a, m, d] = String(iso).split('-')
  return `${d}/${m}/${a}`
}

/**
 * O que a pessoa digitou → AAAA-MM-DD, ou null se não dá para entender.
 *
 * Aceita o que se digita de verdade: 22/05/2025, 22-05-2025, 22052025,
 * 22/5/25 e até 22/05 (assume o ano de referência, que é o ano corrente).
 * Ano de dois dígitos vira 20XX — este sistema guarda lançamentos de 2025 em
 * diante, não de 1925.
 */
export function deBR(texto, anoReferencia = new Date().getFullYear()) {
  const limpo = String(texto ?? '').trim()
  if (!limpo) return null

  // Já veio no formato do banco.
  if (ehISO(limpo)) return limpo

  const partes = limpo.split(/[^\d]+/).filter(Boolean)
  let dia, mes, ano

  if (partes.length >= 3) {
    [dia, mes, ano] = partes.map(Number)
  } else if (partes.length === 2) {
    [dia, mes] = partes.map(Number)
    ano = anoReferencia
  } else if (partes.length === 1 && (partes[0].length === 8 || partes[0].length === 6)) {
    const s = partes[0]
    dia = Number(s.slice(0, 2)); mes = Number(s.slice(2, 4)); ano = Number(s.slice(4))
  } else {
    return null
  }

  if (!Number.isFinite(dia) || !Number.isFinite(mes) || !Number.isFinite(ano)) return null
  if (ano < 100) ano += 2000
  if (mes < 1 || mes > 12) return null
  if (dia < 1 || dia > diasNoMes(ano, mes - 1)) return null
  if (ano < 1900 || ano > 2200) return null

  return `${ano}-${d2(mes)}-${d2(dia)}`
}

/** Soma meses a um AAAA-MM-DD mantendo o dia dentro do mês de destino. */
export function somarMeses(iso, n) {
  if (!ehISO(iso)) return iso
  const [a, m, d] = String(iso).split('-').map(Number)
  const alvoMes = m - 1 + n
  const ano = a + Math.floor(alvoMes / 12)
  const mes = ((alvoMes % 12) + 12) % 12
  // 31/01 + 1 mês não vira 03/03: trava no último dia de fevereiro.
  const dia = Math.min(d, diasNoMes(ano, mes))
  return `${ano}-${d2(mes + 1)}-${d2(dia)}`
}

/**
 * A grade do mês: sempre 6 semanas de 7 dias, para o calendário não mudar de
 * altura ao trocar de mês (pular de 5 para 6 linhas empurra o botão de baixo
 * no meio do clique).
 *
 * Cada célula: { iso, dia, doMes }.
 */
export function gradeDoMes(ano, mes) {
  const primeiro = new Date(ano, mes, 1)
  const comecoDaGrade = new Date(ano, mes, 1 - primeiro.getDay())
  const celulas = []
  for (let i = 0; i < 42; i++) {
    const dt = new Date(comecoDaGrade.getFullYear(), comecoDaGrade.getMonth(), comecoDaGrade.getDate() + i)
    celulas.push({
      iso: `${dt.getFullYear()}-${d2(dt.getMonth() + 1)}-${d2(dt.getDate())}`,
      dia: dt.getDate(),
      doMes: dt.getMonth() === mes && dt.getFullYear() === ano,
    })
  }
  return celulas
}

/** Ano e mês (0-11) de um AAAA-MM-DD, ou do mês corrente quando não há data. */
export function mesDe(iso, agora = new Date()) {
  if (ehISO(iso)) {
    const [a, m] = String(iso).split('-').map(Number)
    return { ano: a, mes: m - 1 }
  }
  return { ano: agora.getFullYear(), mes: agora.getMonth() }
}

/** Comparar datas AAAA-MM-DD é comparar texto — nenhuma conversão envolvida. */
export function foraDoLimite(iso, min, max) {
  if (!ehISO(iso)) return false
  if (min && iso < min) return true
  if (max && iso > max) return true
  return false
}
