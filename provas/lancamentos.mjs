// A relação dos lançamentos junta duas tabelas numa lista só. O que não pode
// acontecer: um lançamento sumir da lista sem a pessoa ter pedido, e a soma
// não bater com o que está na tela.
import { unificar, filtrar, totais, situacaoDe, paraCSV, ordenar } from '../src/lib/lancamentos.js'

let falhas = 0
const ok = (cond, oque) => { if (!cond) { falhas++; console.error('  X ' + oque) } }

const plano = [
  { tipo: 'Saída', categoria: 'Despesas Operacionais', subcategoria: 'Seguro Prestamista', classificacao: 'Despesas Financeiras' },
  { tipo: 'Saída', categoria: 'Despesas Operacionais', subcategoria: 'Seguro de Vida', classificacao: 'Despesas Operacionais' },
  { tipo: 'Entrada', categoria: 'Receita de Serviços', subcategoria: 'Consultoria', classificacao: 'Receita Operacional' },
]

const pagar = [
  { id: 'p1', codigo: '200596', data: { supplier: 'DÉB.SEGURO PRESTAMISTA', desc: 'DÉB.SEGURO PRESTAMISTA', value: 2.59, cat: 'Despesas Operacionais', subcat: 'Seguro Prestamista', status: 'Pago', data_pagamento: '2025-05-23', due: '2025-05-23' } },
  { id: 'p2', codigo: '200100', data: { supplier: 'Seguradora', value: 101.04, cat: 'Despesas Operacionais', subcat: 'Seguro de Vida', status: 'Pendente', due: '2026-01-16' } },
]
const receber = [
  { id: 'r1', codigo: '100010', data: { client: 'Cliente A', value: 5000, cat: 'Receita de Serviços', subcat: 'Consultoria', status: 'Recebido', data_pagamento: '2025-05-10', due: '2025-05-05' } },
]

const todos = unificar({ pagar, receber, plano })
ok(todos.length === 3, 'junta as duas tabelas')

const prestamista = todos.find(l => l.codigo === '200596')
ok(prestamista.tipo === 'Saída', 'payable vira Saída')
ok(prestamista.classificacao === 'Despesas Financeiras',
  'a classificação vem do plano, não do lançamento')
ok(prestamista.situacao === 'realizado' && prestamista.data === '2025-05-23',
  'realizado mostra a data em que o dinheiro andou')

const emAberto = todos.find(l => l.codigo === '200100')
ok(emAberto.situacao === 'aberto' && emAberto.data === '2026-01-16',
  'em aberto mostra o vencimento')

// A busca tem que achar pelo nome, pelo código E pela categoria -- quem procura
// "como ficou o prestamista" digita a palavra, não o código.
for (const q of ['prestamista', '200596', 'Despesas Financeiras', 'SEGURO']) {
  ok(filtrar(todos, { busca: q }).some(l => l.codigo === '200596'), 'busca por "' + q + '"')
}

// Período: linha SEM a data escolhida não pode sumir calada.
const semCompetencia = filtrar(todos, { campoData: 'competencia', de: '2025-01-01', ate: '2025-12-31' })
ok(semCompetencia.length === 3, 'sem o campo de data escolhido, a linha permanece')

ok(filtrar(todos, { campoData: 'pagamento', de: '2025-05-01', ate: '2025-05-31' })
  .filter(l => l.pagamento).length === 2, 'filtro por data de pagamento')

ok(filtrar(todos, { situacao: 'realizado' }).length === 2, 'só os realizados')
ok(filtrar(todos, { tipo: 'Entrada' }).length === 1, 'só as entradas')
ok(filtrar(todos, { classificacao: 'Despesas Financeiras' }).length === 1, 'filtro por grupo da DRE')

// O placar tem que bater com a lista -- somar de cabeça é onde entra o erro.
const t = totais(todos)
ok(t.quantidade === 3, 'conta as linhas da tela')
ok(t.entradas === 5000 && t.saidas === 103.63, 'separa entradas de saídas')
ok(t.resultado === 4896.37, 'o resultado é a diferença')

const tFiltrado = totais(filtrar(todos, { tipo: 'Saída' }))
ok(tFiltrado.entradas === 0 && tFiltrado.saidas === 103.63,
  'o placar acompanha o filtro, não o total geral')

ok(ordenar(todos, 'valor', 'desc')[0].valor === 5000, 'ordena por valor')

const csv = paraCSV(todos)
ok(csv.split('\n').length === 4, 'CSV tem cabeçalho + uma linha por lançamento')
ok(csv.includes('2,59'), 'CSV usa vírgula decimal, como o Excel em português espera')
ok(csv.includes('Despesas Financeiras'), 'CSV leva a classificação junto')

ok(situacaoDe({ status: 'Provisão' }) === 'previsto', 'provisão é previsto, não realizado')

if (falhas) { console.error(falhas + ' falha(s)'); process.exit(1) }
console.log('  ok: as duas tabelas numa lista só, com o placar batendo com o filtro')
