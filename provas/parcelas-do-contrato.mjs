// ===========================================================================
// PROVA: a lista de parcelas que o pop-up mostra.
//
// O caso que obriga o agrupamento: o Sicoob tem 72 linhas em Contas a Pagar
// para 36 parcelas, porque amortização e juros são lançamentos separados.
// Listadas cruas, a parcela 1 apareceria duas vezes, com dois valores que não
// são o valor dela.
//
// E o caso que obriga a marca: as cinco primeiras parcelas do Simples Nacional
// foram dadas como pagas em 08/11/2026 por terem vencido antes do recorte de
// jan/2026. Ali não houve conciliação, e quem olha a lista precisa ver isso.
//
// Rodar: npm run provas
// ===========================================================================
import { parcelasDoContrato } from '../src/lib/contratoVisao.js'

let falhas = 0
const ok = (nome, cond, extra = '') => {
  console.log((cond ? '  OK   ' : '  FALHA') + ' ' + nome + (cond ? '' : ' → ' + extra))
  if (!cond) falhas++
}

// ── Cronograma que separa amortização de juros ───────────────────────────
const sicoob = parcelasDoContrato([
  { id: 'a', codigo: '200101', num: '1', due: '2026-02-20', st: 'Pago', val: '307.72', subcat: 'Amortização do principal (saída)', conciliado_em: '2026-02-21T10:00:00Z' },
  { id: 'b', codigo: '200102', num: '1', due: '2026-02-20', st: 'Pago', val: '442.33', subcat: 'Juros de empréstimos', conciliado_em: '2026-02-21T10:00:00Z' },
  { id: 'c', codigo: '200103', num: '2', due: '2026-03-20', st: 'Pendente', val: '311.45', subcat: 'Amortização do principal (saída)' },
  { id: 'd', codigo: '200104', num: '2', due: '2026-03-20', st: 'Pendente', val: '438.60', subcat: 'Juros de empréstimos' },
])
ok('72 linhas não viram 72 parcelas: duas linhas, uma parcela',
  sicoob.parcelas.length === 2, String(sicoob.parcelas.length))
ok('a parcela traz principal e juros em colunas próprias',
  sicoob.parcelas[0].principal === 307.72 && sicoob.parcelas[0].juros === 442.33,
  `${sicoob.parcelas[0].principal} / ${sicoob.parcelas[0].juros}`)
ok('e o total é a soma das duas', sicoob.parcelas[0].total === 750.05, String(sicoob.parcelas[0].total))
ok('a parcela só está paga quando as duas linhas estão',
  sicoob.parcelas[0].pago === true && sicoob.parcelas[1].pago === false, '')
ok('a lista guarda os dois códigos de lançamento',
  sicoob.parcelas[0].codigos.length === 2, String(sicoob.parcelas[0].codigos))
ok('e diz quando foi conciliada',
  String(sicoob.parcelas[0].conciliadoEm).startsWith('2026-02-21'), String(sicoob.parcelas[0].conciliadoEm))
ok('em ordem de número', sicoob.parcelas[0].numero === 1 && sicoob.parcelas[1].numero === 2, '')

// ── A parcela dada como paga por ser anterior ao recorte ─────────────────
const simples = parcelasDoContrato([
  { id: 'a', codigo: '200001', num: '1', due: '2025-08-08', st: 'Pago', val: '322.89',
    subcat: 'Amortização do principal (saída)', ajuste_historico: true,
    data_pagamento: '2025-08-08', data_pagamento_presumida: true },
  { id: 'b', codigo: '200006', num: '6', due: '2026-01-08', st: 'Pendente', val: '322.89',
    subcat: 'Amortização do principal (saída)' },
])
ok('a parcela ajustada vem marcada',
  simples.parcelas[0].ajusteHistorico === true, String(simples.parcelas[0].ajusteHistorico))
ok('e avisa que a data de pagamento é presumida, não medida',
  simples.parcelas[0].pagamentoPresumido === true, '')
ok('ela não tem conciliação nenhuma, e a lista mostra isso',
  simples.parcelas[0].conciliadoEm === null, String(simples.parcelas[0].conciliadoEm))
ok('sem juros no cronograma, a coluna de juros fica em zero',
  simples.parcelas[0].juros === 0, String(simples.parcelas[0].juros))

// ── Os ajustes nascidos na conciliação ───────────────────────────────────
const comAjustes = parcelasDoContrato([
  { id: 'a', codigo: '200001', num: '1', due: '2026-01-08', st: 'Pago', val: '322.89', subcat: 'Amortização do principal (saída)' },
  { id: 'j', codigo: '200900', due: '2026-01-12', st: 'Pago', val: '12.40', subcat: 'Juros pagos', ajuste_tipo: 'juros' },
  { id: 't', codigo: '200901', due: '2026-01-12', st: 'Pago', val: '9.90', subcat: 'Tarifas bancárias', ajuste_tipo: 'tarifa' },
])
ok('o ajuste não vira parcela', comAjustes.parcelas.length === 1, String(comAjustes.parcelas.length))
ok('ele aparece em lista própria', comAjustes.ajustes.length === 2, String(comAjustes.ajustes.length))
ok('o juro do ajuste entra na coluna de juros',
  comAjustes.ajustes[0].juros === 12.4 && comAjustes.ajustes[0].outros === 0, '')
ok('a tarifa não entra nem em principal nem em juros',
  comAjustes.ajustes[1].juros === 0 && comAjustes.ajustes[1].outros === 9.9, '')
ok('e cada ajuste diz de que tipo é',
  comAjustes.ajustes[0].tipo === 'juros' && comAjustes.ajustes[1].tipo === 'tarifa', '')

// ── Linha sem número de parcela ──────────────────────────────────────────
const semNumero = parcelasDoContrato([
  { id: 'x', codigo: '200500', due: '2026-05-10', st: 'Pendente', val: '100', subcat: 'Amortização do principal (saída)' },
])
ok('linha sem número ainda aparece, em vez de sumir',
  semNumero.parcelas.length === 1 && semNumero.parcelas[0].numero === null, '')

ok('contrato sem linha nenhuma devolve listas vazias',
  parcelasDoContrato([]).parcelas.length === 0 && parcelasDoContrato([]).ajustes.length === 0, '')

console.log(falhas ? `\n${falhas} falha(s).` : '\nTodos os casos passaram.')
process.exit(falhas ? 1 : 0)
