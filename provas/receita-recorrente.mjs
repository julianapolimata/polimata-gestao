// ===========================================================================
// PROVA: a receita recorrente dos contratos na projeção de fluxo.
//
// Dois defeitos reais, achados em 09/11/2026:
//
//   1. A projeção filtrava por `rec_ativa`, um campo que foi RETIRADO do
//      formulário de contrato. Cadastrar contrato não fazia a projeção
//      enxergar nada, e nada na tela dizia isso.
//   2. O valor era somado em TODOS os meses projetados, sem olhar início nem
//      fim. Contrato encerrado em março prometia receita em dezembro.
//
// Rodar: npm run provas
// ===========================================================================
import {
  valorMensalDe, valeNaCompetencia, receitaDosContratos, resumoDaRecorrencia,
} from '../src/lib/receitaRecorrente.js'

let falhas = 0
const ok = (nome, cond, extra = '') => {
  console.log((cond ? '  OK   ' : '  FALHA') + ' ' + nome + (cond ? '' : ' → ' + extra))
  if (!cond) falhas++
}

const contrato = (d) => ({ data: d })

// ── O valor mensal ──────────────────────────────────────────────────────
ok('lê o campo novo', valorMensalDe(contrato({ valor_mensal: 4000 })) === 4000, '')
ok('contrato antigo não perde o valor que já tinha',
  valorMensalDe(contrato({ rec_ativa: true, rec_valor_mensal: 3500 })) === 3500, '')
ok('o campo novo ganha do antigo quando os dois existem',
  valorMensalDe(contrato({ valor_mensal: 4000, rec_ativa: true, rec_valor_mensal: 3500 })) === 4000, '')
ok('contrato sem valor mensal devolve zero, não indefinido',
  valorMensalDe(contrato({})) === 0, '')
ok('valor antigo sem rec_ativa não vale: aquele campo dizia respeito a emitir nota',
  valorMensalDe(contrato({ rec_valor_mensal: 3500 })) === 0, '')

// ── A vigência, que era ignorada ────────────────────────────────────────
const anual = contrato({ valor_mensal: 5000, status: 'Ativo', start: '2026-03-01', end: '2026-08-31' })
ok('antes do início, não entra', valeNaCompetencia(anual, '2026-02') === false, '')
ok('no mês do início, entra', valeNaCompetencia(anual, '2026-03') === true, '')
ok('no mês do fim, ainda entra', valeNaCompetencia(anual, '2026-08') === true, '')
ok('depois do fim, não entra', valeNaCompetencia(anual, '2026-09') === false, '')

const semFim = contrato({ valor_mensal: 5000, status: 'Ativo', start: '2026-01-01' })
ok('contrato sem data de fim vale enquanto estiver Ativo',
  valeNaCompetencia(semFim, '2029-12') === true, '')

const encerrado = contrato({ valor_mensal: 5000, status: 'Encerrado', start: '2026-01-01' })
ok('contrato Encerrado não entra, mesmo dentro da vigência',
  valeNaCompetencia(encerrado, '2026-05') === false, '')
const negociando = contrato({ valor_mensal: 5000, status: 'Em negociação', start: '2026-01-01' })
ok('contrato Em negociação não entra: ainda não é receita',
  valeNaCompetencia(negociando, '2026-05') === false, '')
ok('contrato sem valor mensal não entra, mesmo Ativo',
  valeNaCompetencia(contrato({ status: 'Ativo' }), '2026-05') === false, '')

// ── A soma por mês ──────────────────────────────────────────────────────
const meses = [
  { ano: 2026, mes: 1 },  // fev
  { ano: 2026, mes: 2 },  // mar
  { ano: 2026, mes: 8 },  // set
]
const carteira = [
  contrato({ valor_mensal: 5000, status: 'Ativo', start: '2026-03-01', end: '2026-08-31' }),
  contrato({ valor_mensal: 1200, status: 'Ativo', start: '2026-01-01' }),
  contrato({ valor_mensal: 9000, status: 'Encerrado', start: '2026-01-01' }),
  contrato({ rec_ativa: true, rec_valor_mensal: 800, status: 'Ativo', start: '2026-01-01' }),
]
const soma = receitaDosContratos(carteira, meses)
ok('fevereiro: só os dois sem janela fechada', soma[0] === 2000, String(soma[0]))
ok('março: entra também o que começou em março', soma[1] === 7000, String(soma[1]))
ok('setembro: o que acabou em agosto já saiu', soma[2] === 2000, String(soma[2]))
ok('o encerrado nunca entra', !soma.includes(11000), String(soma))
ok('lista vazia devolve zeros, não quebra',
  receitaDosContratos([], meses).join(',') === '0,0,0', '')
ok('sem meses, devolve lista vazia', receitaDosContratos(carteira, []).length === 0, '')

// ── O que a tela diz ────────────────────────────────────────────────────
const resumoAtivo = resumoDaRecorrencia(anual)
ok('contrato ativo aparece como estando na projeção',
  resumoAtivo.naProjecao === true && resumoAtivo.valor === 5000, JSON.stringify(resumoAtivo))
ok('e diz até quando', resumoAtivo.ate === '2026-08', String(resumoAtivo.ate))
const resumoParado = resumoDaRecorrencia(encerrado)
ok('contrato fora da projeção diz POR QUE está fora',
  resumoParado.naProjecao === false && /Encerrado/.test(resumoParado.motivo), JSON.stringify(resumoParado))
ok('contrato pontual não gera linha de recorrência nenhuma',
  resumoDaRecorrencia(contrato({ status: 'Ativo' })) === null, '')

console.log(falhas ? `\n${falhas} falha(s).` : '\nTodos os casos passaram.')
process.exit(falhas ? 1 : 0)
