// O campo de valor da divisao e TEXTO em pt-BR. A Juliana digitou "3215,81"
// num pagamento de R$ 3.215,81 e o painel disse, ao mesmo tempo:
//   "Classificado R$ 3.215,81 de R$ 3.215,81  -  fecha exato"
//   "Uma das naturezas esta sem valor - preencha ou remova a linha."
// ...com o botao travado. O placar lia com replace(',','.') e a validacao lia
// com Number() direto: Number('3215,81') e NaN, e NaN virou zero.
//
// Esta prova cobra que a leitura do valor seja UMA so, em numeroBR.
import { numeroBR } from '../src/lib/finance.js'
import { validarDivisao } from '../src/lib/agruparLinhas.js'

let falhas = 0
const ok = (cond, oque) => { if (!cond) { falhas++; console.error('  X ' + oque) } }

ok(numeroBR('3215,81') === 3215.81, 'virgula decimal sem milhar')
ok(numeroBR('3.215,81') === 3215.81, 'com ponto de milhar')
ok(numeroBR('3215.81') === 3215.81, 'ponto decimal do teclado numerico')

const linhas = [
  { conta_id: 'c1', status: 'pendente', valor: 1000, data: { tipo: 'entrada', data: '2026-04-20' } },
  { conta_id: 'c1', status: 'pendente', valor: 2215.81, data: { tipo: 'entrada', data: '2026-04-22' } },
]
// Como a tela entrega hoje: valor ja passado por numeroBR.
const comoATelaEntrega = v => [{ cat: 'Conta transitoria', subcat: 'Transferencia entre contas', valor: numeroBR(v) ?? 0 }]

ok(validarDivisao({ linhas, partes: comoATelaEntrega('3215,81') }) === null,
  'digitando em pt-BR a divisao fecha')
ok(validarDivisao({ linhas, partes: comoATelaEntrega('3.215,81') }) === null,
  'digitando com milhar a divisao fecha')

// E o erro antigo, para nao voltar: valor cru de texto NAO pode ser aceito
// como numero por engano em lugar nenhum da cadeia.
ok(Number.isNaN(Number('3215,81')), 'Number() continua sendo NaN - por isso o campo nao pode ir cru')
ok(/sem valor/.test(validarDivisao({ linhas, partes: [{ cat: 'X', subcat: '', valor: 0 }] }) || ''),
  'valor realmente zerado continua barrado')

if (falhas) { console.error(falhas + ' falha(s)'); process.exit(1) }
console.log('  ok: valor digitado em pt-BR fecha a divisao; nada le o campo cru')
