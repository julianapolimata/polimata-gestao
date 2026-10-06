// ===========================================================================
// PROVA: "as linhas do extrato que são a mesma coisa resolvem juntas".
//
// Medido no extrato dela: 393 linhas pendentes em 88 descrições distintas.
// 345 das linhas estão em 40 grupos repetidos. "DÉB.IOF" aparece 22 vezes e
// soma R$ 18,12 no período INTEIRO — o sistema pedia 22 decisões por dezoito
// reais, e ninguém atravessa isso.
//
// O RISCO desta funcionalidade é o oposto do risco das outras: aqui o erro é
// JUNTAR O QUE NÃO É IGUAL, e aí o dinheiro de uma pessoa vai para a conta de
// outra com um clique só. Por isso a maior parte das provas abaixo é sobre o
// que o agrupamento tem que RECUSAR juntar.
//
// Rodar: npm run provas
// ===========================================================================
import { agruparPendentes, chaveDoGrupo, resumoDoAgrupamento, lancamentosDoGrupo, grupoSem }
  from '../src/lib/agruparExtrato.js'

let falhas = 0
const ok = (nome, cond, extra = '') => {
  console.log((cond ? '  OK   ' : '  FALHA') + ' ' + nome + (cond ? '' : ' → ' + extra))
  if (!cond) falhas++
}

const linha = (id, descricao, valor, data, tipo = 'saida') => ({ id, data: { descricao, valor, data, tipo } })

// ── O caso real: o IOF ───────────────────────────────────────────────────
const iof = [
  linha('a', 'DÉB.IOF', 0.82, '2025-06-10'),
  linha('b', 'DÉB.IOF', 0.82, '2025-07-10'),
  linha('c', 'DÉB.IOF', 0.82, '2025-08-10'),
]
const g = agruparPendentes(iof)
ok('três linhas de IOF viram um grupo', g.length === 1 && g[0].quantas === 3)
ok('o grupo soma o período inteiro', Math.abs(g[0].total - 2.46) < 0.001, String(g[0].total))
ok('e sabe que o valor é sempre o mesmo', g[0].valorUnico === 0.82, String(g[0].valorUnico))
ok('e de quando até quando', g[0].periodo.de === '2025-06-10' && g[0].periodo.ate === '2025-08-10')

// ── O QUE NÃO PODE SER JUNTADO ──────────────────────────────────────────
//
// Este é o caso que mandou a primeira versão desta função para o lixo. Ela
// normalizava a descrição (tirava os dígitos) para formar grupos maiores, e
// contra o extrato real juntava dois Pix para PESSOAS DIFERENTES:
// "***.156.628-**" (43 linhas, R$ 151.160) com "***.985.018-**" (6 linhas,
// R$ 5.750). Classificar os dois juntos poria o dinheiro de uma na conta da
// outra — com um clique.
const doisPix = [
  linha('p1', 'Pagamento Pix ***.156.628-** · PIX EMITIDO OUTRA IF', 3500, '2026-01-05'),
  linha('p2', 'Pagamento Pix ***.156.628-** · PIX EMITIDO OUTRA IF', 3500, '2026-02-05'),
  linha('p3', 'Pagamento Pix ***.985.018-** · PIX EMITIDO OUTRA IF', 950, '2026-01-07'),
]
const gp = agruparPendentes(doisPix)
ok('Pix para CPFs diferentes NÃO entram no mesmo grupo', gp.length === 2, String(gp.length))
ok('e cada grupo fica com as suas linhas',
  gp[0].quantas === 2 && gp[1].quantas === 1)

ok('CNPJs diferentes também ficam separados',
  agruparPendentes([
    linha('x', 'Pagamento Pix 00.394.460 0058-87 · PIX EMITIDO OUTRA IF', 100, '2026-01-01'),
    linha('y', 'Pagamento Pix 57.077.301 0001-30 · PIX EMITIDO OUTRA IF', 100, '2026-01-01'),
  ]).length === 2)

// Entrada e saída com o MESMO texto são coisas opostas — um estorno carrega a
// descrição do pagamento que estornou.
ok('entrada e saída com o mesmo texto não se juntam',
  agruparPendentes([
    linha('e1', 'Pagamento Pix 24.038.490 0001-83', 13, '2026-03-01', 'saida'),
    linha('e2', 'Pagamento Pix 24.038.490 0001-83', 13, '2026-03-02', 'entrada'),
  ]).length === 2)

ok('linha sem descrição não entra em grupo nenhum',
  chaveDoGrupo(linha('z', '', 50, '2026-01-01')) === null)
ok('nem espaço em branco vira descrição',
  chaveDoGrupo(linha('z', '   ', 50, '2026-01-01')) === null)

// ── A ordem: o maior ganho primeiro ─────────────────────────────────────
const variados = agruparPendentes([
  linha('u1', 'COMPRA AVULSA', 9, '2026-01-01'),
  ...Array.from({ length: 5 }, (_, i) => linha('m' + i, 'MENSALIDADE SICOOB TAG', 9.9, `2026-0${i + 1}-15`)),
  linha('d1', 'DOIS A', 20, '2026-01-01'), linha('d2', 'DOIS A', 20, '2026-02-01'),
])
ok('o grupo maior vem primeiro', variados[0].quantas === 5, variados.map(x => x.quantas).join(','))

// ── O resumo que a tela mostra ANTES de ela clicar ──────────────────────
//
// "393 linhas em 88 decisões" é o que faz alguém começar. "393 linhas" é o
// que faz desistir.
const r = resumoDoAgrupamento(variados)
ok('o resumo conta as linhas', r.linhas === 8, JSON.stringify(r))
ok('o resumo conta as decisões que sobram', r.decisoes === 3, JSON.stringify(r))
ok('e separa o que é avulso', r.avulsas === 1, JSON.stringify(r))

// ── O lançamento guarda a data DA SUA linha ─────────────────────────────
//
// Um grupo resolvido com uma decisão não pode virar um lançamento só com a
// soma: isso apagaria quando cada despesa aconteceu, e é a competência que
// fecha o mês. Cinco linhas de mensalidade em cinco meses são cinco
// lançamentos, um em cada mês.
const grupoMensalidade = variados[0]
const lancs = lancamentosDoGrupo(grupoMensalidade, { cat: 'Despesas Financeiras', subcat: 'Tarifas' })
ok('um lançamento por linha, não um com a soma', lancs.length === 5)
ok('cada um com a data da sua linha',
  lancs.map(l => l.lanc.data_competencia).join(',') === '2026-01-15,2026-02-15,2026-03-15,2026-04-15,2026-05-15',
  lancs.map(l => l.lanc.data_competencia).join(','))
ok('cada um com o valor da sua linha', lancs.every(l => l.lanc.value === 9.9))
ok('cada um amarrado à sua linha do extrato',
  new Set(lancs.map(l => l.extrato_id)).size === 5)
ok('saída vira conta a pagar', lancs.every(l => l.target === 'payable'))
ok('entrada vira conta a receber',
  lancamentosDoGrupo(
    agruparPendentes([linha('r1', 'Recebimento Pix TERRA CONTTEMPOR', 5000, '2026-01-01', 'entrada')])[0],
    { cat: 'Receita de Serviços' },
  )[0].target === 'receivable')

ok('fica o rastro de que nasceu de uma decisão de grupo',
  lancs[0].lanc.criado_em_grupo === 'MENSALIDADE SICOOB TAG' && lancs[0].lanc.criado_em_grupo_tamanho === 5)

// ── Sem categoria, não cria nada ────────────────────────────────────────
//
// Lançamento sem classificação não entra na DRE e vira trabalho invisível
// depois. Melhor não criar que criar errado em lote.
ok('sem categoria não gera lançamento nenhum',
  lancamentosDoGrupo(grupoMensalidade, { cat: '' }).length === 0)
ok('grupo vazio não gera lançamento', lancamentosDoGrupo(null, { cat: 'X' }).length === 0)

// ── Nada quebra com entrada vazia ───────────────────────────────────────
ok('lista vazia devolve nenhum grupo', agruparPendentes([]).length === 0)
ok('lista nula devolve nenhum grupo', agruparPendentes(null).length === 0)
ok('resumo de nada não quebra', resumoDoAgrupamento(null).linhas === 0)

// ── Tirar uma linha do lote recalcula TUDO ───────────────────────────────
//
// Pedido dela ao ver o grupo "JUROS CONTA GARANTIDA — 12 lançamentos de
// valores diferentes": poder ver as linhas e excluir alguma.
//
// Tirar linha não é esconder. Se o total e o VALOR FIXO não forem recalculados,
// a oferta de recorrência sai errada nos dois sentidos: um grupo quase-fixo do
// qual ela tira a linha diferente continuaria "variável" e não ofereceria nada;
// e — pior — um grupo do qual ela tira linhas até sobrarem valores iguais
// ofereceria uma recorrência calculada sobre o que ficou de fora.
const misto = agruparPendentes([
  linha('j1', 'JUROS CONTA GARANTIDA', 10, '2026-01-10'),
  linha('j2', 'JUROS CONTA GARANTIDA', 10, '2026-02-10'),
  linha('j3', 'JUROS CONTA GARANTIDA', 77.5, '2026-03-10'),
])[0]
ok('o grupo inteiro tem valores diferentes', misto.valorUnico === null)

const semAEstranha = grupoSem(misto, new Set(['j3']))
ok('sem a linha diferente, sobram 2', semAEstranha.quantas === 2)
ok('e o total é recalculado', Math.abs(semAEstranha.total - 20) < 0.001, String(semAEstranha.total))
ok('e o valor passa a ser fixo', semAEstranha.valorUnico === 10, String(semAEstranha.valorUnico))
ok('e o período encolhe junto',
  semAEstranha.periodo.ate === '2026-02-10', semAEstranha.periodo.ate)
ok('e os lançamentos criados são só os que ficaram',
  lancamentosDoGrupo(semAEstranha, { cat: 'Despesas Financeiras' }).length === 2)

ok('sem exclusão nenhuma, devolve o mesmo grupo', grupoSem(misto, new Set()) === misto)
ok('excluir todas devolve null (não há lote vazio)',
  grupoSem(misto, new Set(['j1', 'j2', 'j3'])) === null)
ok('grupo nulo não quebra', grupoSem(null, new Set(['x'])) === null)
ok('id que não existe no grupo não tira nada',
  grupoSem(misto, new Set(['nao-existe'])).quantas === 3)

console.log(falhas ? `\n${falhas} falha(s).` : '\n  todas passaram.')
process.exit(falhas ? 1 : 0)
