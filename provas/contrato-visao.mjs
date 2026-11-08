// ===========================================================================
// PROVA: principal e juros, previsto e realizado.
//
// Os três contratos reais, com a diferença que importa entre eles: o Sicoob
// abre amortização e juros no cronograma; os dois parcelamentos vêm com a
// parcela cheia. Nesses, o juro só aparece quando ela concilia o pagamento e
// tipa a diferença — e é isso que esta prova fixa.
//
// Rodar: npm run provas
// ===========================================================================
import { consolidarContratos } from '../src/lib/contratoVisao.js'

let falhas = 0
const ok = (nome, cond, extra = '') => {
  console.log((cond ? '  OK   ' : '  FALHA') + ' ' + nome + (cond ? '' : ' → ' + extra))
  if (!cond) falhas++
}

// ── O Sicoob: cronograma separa amortização de juros ─────────────────────
const sicoob = consolidarContratos([
  { id: 'a', emprestimo_id: 'EMP1', num: '1', due: '2026-01-10', st: 'Pago', val: '800', subcat: 'Amortização do principal (saída)' },
  { id: 'b', emprestimo_id: 'EMP1', num: '1', due: '2026-01-10', st: 'Pago', val: '200', subcat: 'Juros de empréstimos' },
  { id: 'c', emprestimo_id: 'EMP1', num: '2', due: '2026-02-10', st: 'Pendente', val: '820', subcat: 'Amortização do principal (saída)' },
  { id: 'd', emprestimo_id: 'EMP1', num: '2', due: '2026-02-10', st: 'Pendente', val: '180', subcat: 'Juros de empréstimos' },
])['EMP1']
ok('o principal previsto soma só amortização', sicoob.principal.previsto === 1620, String(sicoob.principal.previsto))
ok('o juro previsto soma só juros', sicoob.juros.previsto === 380, String(sicoob.juros.previsto))
ok('o principal realizado é o que foi conciliado', sicoob.principal.realizado === 800, String(sicoob.principal.realizado))
ok('o juro realizado também', sicoob.juros.realizado === 200, String(sicoob.juros.realizado))
ok('o principal em aberto é o saldo devedor', sicoob.principal.emAberto === 820, String(sicoob.principal.emAberto))
ok('duas linhas da mesma parcela continuam sendo uma parcela', sicoob.total === 2, String(sicoob.total))
ok('e uma parcela só está paga quando as duas linhas estão', sicoob.pagas === 1, String(sicoob.pagas))
ok('o próximo vencimento é o menor em aberto', sicoob.proxima === '2026-02-10', String(sicoob.proxima))

// ── O parcelamento fiscal: a parcela vem cheia ───────────────────────────
const fiscal0 = consolidarContratos([
  { id: 'a', emprestimo_id: 'EMP3', num: '1', due: '2026-03-20', st: 'Pendente', val: '322.89', subcat: 'Amortização do principal (saída)' },
  { id: 'b', emprestimo_id: 'EMP3', num: '2', due: '2026-04-20', st: 'Pendente', val: '322.89', subcat: 'Amortização do principal (saída)' },
])['EMP3']
ok('sem juros no cronograma, o previsto fica VAZIO, não zero',
  fiscal0.juros.previsto === null, String(fiscal0.juros.previsto))
ok('e o realizado começa em zero, à espera da conciliação',
  fiscal0.juros.realizado === 0, String(fiscal0.juros.realizado))

// Ela concilia a primeira parcela e tipa R$ 12,40 de juros/multa.
const fiscal1 = consolidarContratos([
  { id: 'a', emprestimo_id: 'EMP3', num: '1', due: '2026-03-20', st: 'Pago', val: '322.89', subcat: 'Amortização do principal (saída)' },
  { id: 'b', emprestimo_id: 'EMP3', num: '2', due: '2026-04-20', st: 'Pendente', val: '322.89', subcat: 'Amortização do principal (saída)' },
  { id: 'j', emprestimo_id: 'EMP3', due: '2026-03-20', st: 'Pago', val: '12.40', subcat: 'Juros pagos', ajuste_tipo: 'juros' },
])['EMP3']
ok('o juro medido na conciliação entra no realizado',
  fiscal1.juros.realizado === 12.4, String(fiscal1.juros.realizado))
ok('e o previsto continua vazio: o contrato não disse nada sobre juros',
  fiscal1.juros.previsto === null, String(fiscal1.juros.previsto))
ok('a tela sabe que esse juro foi medido, não estimado',
  fiscal1.juros.medidoNaConciliacao === 12.4, String(fiscal1.juros.medidoNaConciliacao))
ok('o ajuste da conciliação NÃO vira uma parcela a mais',
  fiscal1.total === 2, String(fiscal1.total))
ok('e não entra no principal', fiscal1.principal.previsto === 645.78, String(fiscal1.principal.previsto))
ok('uma parcela paga, uma em aberto', fiscal1.pagas === 1 && fiscal1.principal.emAberto === 322.89,
  `${fiscal1.pagas} / ${fiscal1.principal.emAberto}`)

// ── O juro de mora num contrato que JÁ previa juros ──────────────────────
// Previsto e realizado divergem, e é legítimo: pagou com atraso.
const comMora = consolidarContratos([
  { id: 'a', emprestimo_id: 'EMP1', num: '1', due: '2026-01-10', st: 'Pago', val: '800', subcat: 'Amortização do principal (saída)' },
  { id: 'b', emprestimo_id: 'EMP1', num: '1', due: '2026-01-10', st: 'Pago', val: '200', subcat: 'Juros de empréstimos' },
  { id: 'm', emprestimo_id: 'EMP1', due: '2026-01-15', st: 'Pago', val: '35', subcat: 'Juros pagos', ajuste_tipo: 'juros' },
])['EMP1']
ok('o juro de mora soma ao realizado sem mexer no previsto',
  comMora.juros.previsto === 200 && comMora.juros.realizado === 235,
  `${comMora.juros.previsto} / ${comMora.juros.realizado}`)

// ── A TARIFA COBRADA JUNTO COM A PARCELA ─────────────────────────────────
// Ela fica ligada ao contrato, e isso é verdade. Mas tarifa não amortiza
// dívida nenhuma: sem guarda, ela entraria no principal e inflaria o saldo.
const comTarifa = consolidarContratos([
  { id: "a", emprestimo_id: "EMP1", num: "1", due: "2026-01-10", st: "Pago", val: "800", subcat: "Amortização do principal (saída)" },
  { id: "t", emprestimo_id: "EMP1", due: "2026-01-10", st: "Pago", val: "9.90", subcat: "Tarifas bancárias", ajuste_tipo: "tarifa" },
])["EMP1"];
ok("tarifa da conciliação não entra no principal",
  comTarifa.principal.previsto === 800, String(comTarifa.principal.previsto));
ok("e não vira uma parcela a mais", comTarifa.total === 1, String(comTarifa.total));
ok("nem entra nos juros", comTarifa.juros.realizado === 0, String(comTarifa.juros.realizado));

// ── Contrato sem linha nenhuma ───────────────────────────────────────────
ok('contrato sem linhas não aparece no consolidado',
  consolidarContratos([])['EMP1'] === undefined, '')

console.log(falhas ? `\n${falhas} falha(s).` : '\nTodos os casos passaram.')
process.exit(falhas ? 1 : 0)
