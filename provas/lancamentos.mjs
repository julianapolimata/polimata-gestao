// A relação dos lançamentos junta duas tabelas numa lista só. O que não pode
// acontecer: um lançamento sumir da lista sem a pessoa ter pedido, e a soma
// não bater com o que está na tela.
import { unificar, filtrar, totais, situacaoDe, paraCSV, ordenar, contarSemData, resumoDoGrupo } from '../src/lib/lancamentos.js'

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

// PERÍODO — o bug que a Juliana pegou: filtrar por pagamento em maio/2025
// devolvia 223 lançamentos, quase todos, porque as linhas sem data de
// pagamento passavam direto. Filtro que não filtra mente o número na tela.
const porCompetencia = filtrar(todos, { campoData: 'competencia', de: '2025-01-01', ate: '2025-12-31' })
ok(porCompetencia.length === 0, 'sem a data escolhida a linha NÃO entra no período')
ok(contarSemData(todos, { campoData: 'competencia', de: '2025-01-01', ate: '2025-12-31' }) === 3,
  'mas a tela avisa quantas ficaram de fora — o cuidado vira aviso, não silêncio')
ok(contarSemData(todos, { campoData: 'pagamento' }) === 0,
  'sem período escolhido não há o que avisar')
ok(contarSemData(todos, { campoData: 'pagamento', tipo: 'Entrada', de: '2025-01-01' }) === 0,
  'o aviso respeita os outros filtros: não conta o que já estava fora')

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

// ── PARCELAS E GRUPO ─────────────────────────────────────────────────────
// A Juliana viu 10 linhas "SebraeSp 1/10 ... 10/10", cada uma com seu codigo,
// e perguntou se nao deveria ser um codigo so. Nao: cada parcela e um titulo
// com vencimento, baixa e conciliacao proprios. O que faltava era MOSTRAR o
// vinculo -- que ja estava gravado em parent_id (compra) e emprestimo_id
// (contrato), e que nenhuma tela exibia.
const compra = 'c0ffee00-0000-4000-8000-000000000001'
const contrato = 'c0ffee00-0000-4000-8000-000000000002'
const parceladas = unificar({
  plano,
  receber: [],
  pagar: [
    { id: 's1', codigo: '200322', parent_id: compra, data: { supplier: 'SebraeSp', value: 220, status: 'Pago', data_pagamento: '2025-05-22', parcela_atual: 1, parcela_total: 10 } },
    { id: 's2', codigo: '200323', parent_id: compra, data: { supplier: 'SebraeSp', value: 220, status: 'Pago', data_pagamento: '2025-06-22', parcela_atual: 2, parcela_total: 10 } },
    { id: 's3', codigo: '200324', parent_id: compra, data: { supplier: 'SebraeSp', value: 220, status: 'Pendente', due: '2025-07-22', parcela_atual: 3, parcela_total: 10 } },
    { id: 'e1', codigo: '200403', emprestimo_id: contrato, data: { supplier: 'Sicoob', value: 46.72, status: 'Pago', data_pagamento: '2026-02-20', parcela_atual: 1, parcela_total: 36 } },
    { id: 'x1', codigo: '200900', data: { supplier: 'Padaria', value: 10, status: 'Pago', data_pagamento: '2025-05-02' } },
  ],
})

ok(parceladas.find(l => l.codigo === '200322').parcela === '1/10', 'mostra a parcela como 1/10')
ok(parceladas.find(l => l.codigo === '200900').parcela === '', 'lancamento avulso nao finge ser parcela')
ok(parceladas.find(l => l.codigo === '200322').grupoTipo === 'compra', 'parent_id = compra no cartao')
ok(parceladas.find(l => l.codigo === '200403').grupoTipo === 'contrato', 'emprestimo_id = contrato')

// Cada parcela guarda o codigo DELA -- e isso que permite cita-la sozinha.
const codigos = parceladas.filter(l => l.grupoId === compra).map(l => l.codigo)
ok(new Set(codigos).size === 3, 'as parcelas da mesma compra tem codigos diferentes')

ok(filtrar(parceladas, { grupo: compra }).length === 3, 'da para pedir a compra inteira')

const r = resumoDoGrupo(parceladas, compra)
ok(r.parcelasDoContrato === 10 && r.parcelasNoSistema === 3,
  'o resumo nao esconde que so 3 das 10 parcelas estao no sistema')
ok(r.pagas === 2 && r.valor === 660, 'soma e contagem de pagas do grupo')
ok(resumoDoGrupo(parceladas, 'nao-existe') === null, 'grupo inexistente devolve null')


// O NUMERO DO DOCUMENTO. O codigo identifica o lancamento dentro do sistema;
// o numero da nota identifica o papel que existe fora dele. A Juliana nao
// achava o segundo em lugar nenhum -- ele era gravado e nunca exibido.
const comNota = unificar({ plano, receber: [], pagar: [
  { id: 'n1', codigo: '200700', data: { supplier: 'JL Ramos', value: 500, status: 'Pago', data_pagamento: '2025-08-10', numero_nf: '0001234' } },
] })
ok(comNota[0].numeroNf === '0001234', 'o numero da nota chega na lista')
ok(filtrar(comNota, { busca: '0001234' }).length === 1, 'da para buscar pelo numero da nota')
ok(paraCSV(comNota).includes('0001234'), 'o CSV leva o numero do documento')
ok(unificar({ plano, pagar: [{ id: 'z', codigo: '1', data: {} }], receber: [] })[0].numeroNf === '',
  'sem nota, o campo fica vazio em vez de inventar')

if (falhas) { console.error(falhas + ' falha(s)'); process.exit(1) }
console.log('  ok: as duas tabelas numa lista só, com o placar batendo com o filtro')
