// Anular um par debito x estorno tira duas linhas da fila sem gerar lancamento.
// O risco e o inverso do de sempre: aqui o erro ESCONDE dinheiro. Por isso a
// maior parte desta prova sao os casos em que NAO pode parear.
import { acharParesEstorno, resumoDosPares, ehEstorno, semEstorno } from '../src/lib/paresEstorno.js'

let falhas = 0
const ok = (cond, oque) => { if (!cond) { falhas++; console.error('  X ' + oque) } }

let seq = 0
const linha = (dia, tipo, valor, descricao, conta = 'c1', status = 'pendente') =>
  ({ id: 'l' + (++seq), conta_id: conta, status, data: { data: dia, tipo, valor, descricao } })

// ── O caso real do extrato da Polimata ───────────────────────────────────
const reais = [
  linha('2026-04-22', 'saida', 2836.09, 'DEB.CONV.DEMAIS EMPRESAS'),
  linha('2026-04-22', 'entrada', 2836.09, 'ESTORNO DEB.CONV.DEMAIS EMPRESAS'),
  linha('2025-06-10', 'saida', 101.04, 'DEB. CONV. SEGUROS'),
  linha('2025-06-10', 'entrada', 101.04, 'ESTORNO DEB. CONV. SEGUROS'),
]
const achados = acharParesEstorno(reais)
ok(achados.length === 2, 'acha os dois pares reais')
ok(resumoDosPares(achados).linhas === 4, 'dois pares = quatro linhas fora da fila')
ok(Math.abs(resumoDosPares(achados).valor - 2937.13) < 0.005, 'soma o valor de um lado so')

// A pontuacao do OFX varia entre a linha e o estorno dela.
ok(acharParesEstorno([
  linha('2025-06-10', 'saida', 101.04, 'DEB. CONV. SEGUROS'),
  linha('2025-06-10', 'entrada', 101.04, 'ESTORNO DEB.CONV.SEGUROS'),
]).length === 1, 'ponto e espaco a mais nao impedem o par')

// ── O QUE NAO PODE PAREAR ────────────────────────────────────────────────
ok(acharParesEstorno([
  linha('2025-06-10', 'saida', 101.04, 'DEB. CONV. SEGUROS'),
  linha('2025-06-11', 'entrada', 101.04, 'ESTORNO DEB. CONV. SEGUROS'),
]).length === 0, 'dia diferente NAO pareia')

ok(acharParesEstorno([
  linha('2025-06-10', 'saida', 101.04, 'DEB. CONV. SEGUROS'),
  linha('2025-06-10', 'entrada', 101.05, 'ESTORNO DEB. CONV. SEGUROS'),
]).length === 0, 'um centavo de diferenca NAO pareia')

ok(acharParesEstorno([
  linha('2025-06-10', 'saida', 101.04, 'DEB. CONV. SEGUROS', 'c1'),
  linha('2025-06-10', 'entrada', 101.04, 'ESTORNO DEB. CONV. SEGUROS', 'c2'),
]).length === 0, 'contas diferentes NAO pareiam')

ok(acharParesEstorno([
  linha('2025-06-10', 'saida', 101.04, 'DEB. CONV. SEGUROS'),
  linha('2025-06-10', 'saida', 101.04, 'ESTORNO DEB. CONV. SEGUROS'),
]).length === 0, 'mesmo sentido NAO pareia')

// O caso que justifica exigir a descricao: um pagamento e um recebimento de
// mesmo valor no mesmo dia NAO sao um par -- sao dinheiro de verdade, dos dois
// lados. Sem a regra da descricao, os dois sumiriam.
ok(acharParesEstorno([
  linha('2025-06-10', 'saida', 1000, 'Pagamento Pix FORNECEDOR'),
  linha('2025-06-10', 'entrada', 1000, 'Recebimento Pix CLIENTE'),
]).length === 0, 'pagamento e recebimento de mesmo valor NAO sao par')

// Dois debitos iguais no dia e UM estorno: so um morre.
const doisUm = acharParesEstorno([
  linha('2025-06-10', 'saida', 101.04, 'DEB. CONV. SEGUROS'),
  linha('2025-06-10', 'saida', 101.04, 'DEB. CONV. SEGUROS'),
  linha('2025-06-10', 'entrada', 101.04, 'ESTORNO DEB. CONV. SEGUROS'),
])
ok(doisUm.length === 1, 'um estorno anula UM debito, nao os dois')

// Linha ja conciliada ou arquivada esta fora da conversa.
ok(acharParesEstorno([
  linha('2025-06-10', 'saida', 101.04, 'DEB. CONV. SEGUROS', 'c1', 'conciliado'),
  linha('2025-06-10', 'entrada', 101.04, 'ESTORNO DEB. CONV. SEGUROS'),
]).length === 0, 'linha ja conciliada nao entra em par')

// Descricao vazia dos dois lados nao pode virar par por igualdade de vazio.
ok(acharParesEstorno([
  linha('2025-06-10', 'saida', 50, 'ESTORNO'),
  linha('2025-06-10', 'entrada', 50, 'ESTORNO'),
]).length === 0, 'descricao vazia depois do ESTORNO nao pareia')

// ── Auxiliares ───────────────────────────────────────────────────────────
ok(ehEstorno('ESTORNO DEB.CONV.SEGUROS') === true, 'reconhece o estorno')
ok(ehEstorno('DEB.CONV.SEGUROS') === false, 'debito nao e estorno')
ok(ehEstorno('ESTORNOS DIVERSOS') === false, 'ESTORNOS (plural) nao e prefixo de estorno')
ok(semEstorno('ESTORNO DEB. CONV. SEGUROS') === 'DEB CONV SEGUROS', 'tira o prefixo e normaliza')

if (falhas) { console.error(falhas + ' falha(s)'); process.exit(1) }
console.log('  ok: pares se anulam; dia, valor, conta, sentido e descricao tem que bater')
