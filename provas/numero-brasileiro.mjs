// ===========================================================================
// PROVA: dinheiro digitado em português vira o número certo.
//
// Nasceu de um prejuízo silencioso, achado em produção: o campo "Saldo Inicial
// (R$)" era <input type="number"> com placeholder "0,00". A Juliana digitou
// 3.215,81 e o banco guardou 3.21581 — três reais e vinte e um centavos no
// lugar de três mil duzentos e quinze reais. Sem erro, sem aviso, sem jeito de
// perceber olhando a tela.
//
// Errar aqui não dá tela vermelha: dá um número plausível e errado, que vai
// para o saldo, para o fluxo de caixa e para a DRE. É a pior categoria de bug.
//
// Rodar: npm run provas
// ===========================================================================
import { numeroBR } from '../src/lib/finance.js'

let falhas = 0
const ok = (nome, cond, extra = '') => {
  console.log((cond ? '  OK   ' : '  FALHA') + ' ' + nome + (cond ? '' : ' → ' + extra))
  if (!cond) falhas++
}
const eq = (entrada, esperado) =>
  ok(`"${entrada}" → ${esperado}`, numeroBR(entrada) === esperado, String(numeroBR(entrada)))

// ── O caso real ──────────────────────────────────────────────────────────
eq('3.215,81', 3215.81)
eq('3215,81', 3215.81)
eq('3215.81', 3215.81)       // teclado numérico, e como o banco devolve

// ── As duas convenções convivendo ────────────────────────────────────────
eq('1.234.567,89', 1234567.89)
eq('1234567.89', 1234567.89)
eq('0,01', 0.01)
eq('0.01', 0.01)
eq('1000', 1000)

// ── Milhar sem centavos: o caso que custa dinheiro ───────────────────────
//
// "3.215" é ambíguo para um computador e não é para uma pessoa: ninguém
// escreve três reais e vinte e um centavos e meio. Três dígitos depois do
// ponto, com até três antes, é milhar.
eq('3.215', 3215)
eq('1.234.567', 1234567)
// Mas duas casas depois do ponto é centavo, sempre.
eq('3.21', 3.21)
eq('189.07', 189.07)

// ── Negativos, como contador escreve ─────────────────────────────────────
eq('-189,07', -189.07)
eq('-189.07', -189.07)
ok('"(189,07)" entre parênteses é negativo', numeroBR('(189,07)') === -189.07, String(numeroBR('(189,07)')))

// ── Lixo em volta do número não atrapalha ────────────────────────────────
eq('R$ 3.215,81', 3215.81)
eq(' 3.215,81 ', 3215.81)

// ── O que NÃO é número devolve null, nunca zero ──────────────────────────
//
// Devolver 0 seria pior que devolver nada: um saldo que virou zero sozinho
// parece uma conta zerada, e ninguém procura o que parece certo.
ok('vazio → null', numeroBR('') === null)
ok('só espaço → null', numeroBR('   ') === null)
ok('texto → null', numeroBR('abc') === null)
ok('nulo → null', numeroBR(null) === null && numeroBR(undefined) === null)

// ── Número já numérico passa direto ──────────────────────────────────────
ok('número continua número', numeroBR(3215.81) === 3215.81)
ok('zero é zero, não null', numeroBR(0) === 0)
ok('NaN → null', numeroBR(NaN) === null)

console.log(falhas ? `\n${falhas} falha(s).` : '\n  todas passaram.')
process.exit(falhas ? 1 : 0)
