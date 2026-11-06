// ===========================================================================
// PROVA: as parcelas do empréstimo, e o saldo que não se inventa.
//
// O caso real: os três contratos mostravam R$ 38.345,11 de saldo e o
// Parcelamento do Simples Nacional aparecia com ZERO de 36 parcelas pagas,
// apesar de os pagamentos estarem no extrato. O número vinha do campo digitado
// no cadastro, que não se corrige sozinho.
//
// Rodar: npm run provas
// ===========================================================================
import { linhasDeParcelas, saldoApurado } from '../src/lib/parcelasEmprestimo.js'

let falhas = 0
const ok = (nome, cond, extra = '') => {
  console.log((cond ? '  OK   ' : '  FALHA') + ' ' + nome + (cond ? '' : ' → ' + extra))
  if (!cond) falhas++
}

// ── Um financiamento com juros: cada parcela vira duas linhas ─────────────
const comJuros = {
  data: {
    nome: 'Empréstimo Sicoob', credor: 'Sicoob', parcelas_total: 2,
    parcelas: [
      { numero: 1, vencimento: '2026-01-10', amortizacao: 800, juros: 200, pago: true },
      { numero: 2, vencimento: '2026-02-10', amortizacao: 820, juros: 180, pago: false },
    ],
  },
}
const l1 = linhasDeParcelas(comJuros, '2026-11-05')
ok('duas parcelas com juros viram quatro linhas', l1.length === 4, String(l1.length))
ok('o principal fica fora do resultado',
  l1[0].subcat === 'Amortização do principal (saída)', l1[0].subcat)
ok('e só o juro é despesa', l1[1].subcat === 'Juros de empréstimos', l1[1].subcat)
ok('a parcela quitada antes do sistema entra como história',
  l1[0].status === 'Pago' && l1[0].data_pagamento === '2026-01-10', l1[0].status)
ok('a que ainda vence nasce pendente, para a conciliação decidir',
  l1[2].status === 'Pendente' && l1[2].data_pagamento === null, l1[2].status)
ok('as duas linhas da mesma parcela têm o mesmo número',
  l1[0].parcela_atual === 1 && l1[1].parcela_atual === 1, '')
ok('a linha não traz código: quem numera é o banco', l1[0].codigo === undefined, '')
ok('nasce escriturada — não entra na fila de escrituração',
  l1[0].escriturado === true && l1[0].doc_status === 'dispensado', '')

// ── Um parcelamento fiscal, sem separação de juros ────────────────────────
const semJuros = {
  data: {
    nome: 'Parcelamento Simples Nacional', credor: 'Receita Federal', parcelas_total: 36,
    parcelas: [{ numero: 1, vencimento: '2026-03-20', valor: 1064.14, pago: false }],
  },
}
const l2 = linhasDeParcelas(semJuros)
ok('sem separação de juros, uma linha só', l2.length === 1, String(l2.length))
ok('e ela é amortização, não despesa financeira inventada',
  l2[0].subcat === 'Amortização do principal (saída)' && l2[0].value === 1064.14, l2[0].subcat)
ok('a descrição diz qual parcela de quantas',
  l2[0].desc === 'Parcelamento Simples Nacional — parcela 1/36', l2[0].desc)

// ── Contrato sem cronograma ───────────────────────────────────────────────
ok('contrato sem cronograma não gera linha nenhuma',
  linhasDeParcelas({ data: { nome: 'X' } }).length === 0, '')

// ── O SALDO QUE NÃO SE INVENTA ────────────────────────────────────────────
ok('sem parcelas lançadas, o saldo não é zero: é "não apurado"',
  saldoApurado(null) === null && saldoApurado({ linhas: 0, saldo: 0 }) === null, '')
ok('com parcelas lançadas, o saldo é a soma das não conciliadas',
  saldoApurado({ linhas: 4, saldo: 1000 }) === 1000, '')
ok('e tudo conciliado dá zero, que é um saldo de verdade',
  saldoApurado({ linhas: 4, saldo: 0 }) === 0, '')

console.log(falhas ? `\n${falhas} falha(s).` : '\nTodos os casos passaram.')
process.exit(falhas ? 1 : 0)
