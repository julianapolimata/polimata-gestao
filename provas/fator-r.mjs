// ===========================================================================
// PROVA: o Fator R decide o Anexo, e o Anexo decide o imposto.
//
// É a conta mais cara do sistema: Anexo III começa em 6% e Anexo V em 15,5%.
// Na receita da Polímata (RBT12 ≈ R$ 193 mil) a diferença passa de R$ 15 mil
// por ano. Um erro de arredondamento na fronteira dos 28% troca o anexo.
//
// Base: LC 123/2006 art. 18 §§ 5º-J a 5º-M; Resolução CGSN 140/2018 art. 26.
//
// Rodar: npm run provas
// ===========================================================================
import {
  calcularFatorR, anexoPorFatorR, folhaMinimaParaAnexoIII,
  proporcionalizarRBT12, FATOR_R_LIMITE,
} from '../src/lib/simplesNacional.js'

let falhas = 0
const ok = (nome, cond, extra = '') => {
  console.log((cond ? '  OK   ' : '  FALHA') + ' ' + nome + (cond ? '' : ' → ' + extra))
  if (!cond) falhas++
}

// ── 1. O limite é 28%, não 25% ─────────────────────────────────────────────
ok('o limite legal é 28%', FATOR_R_LIMITE === 0.28, String(FATOR_R_LIMITE))

// ── 2. A fronteira ─────────────────────────────────────────────────────────
ok('exatamente 28% → Anexo III', anexoPorFatorR(0.28) === 'III')
ok('um fio abaixo de 28% → Anexo V', anexoPorFatorR(0.2799999) === 'V')
ok('bem acima → Anexo III', anexoPorFatorR(0.45) === 'III')

// ── 3. Sem base para calcular, vale o Anexo V ──────────────────────────────
// O Anexo III é a EXCEÇÃO, que precisa ser provada pela folha. Na dúvida, o
// sistema não pode presumir o imposto menor.
ok('receita zero não dá Fator R', calcularFatorR({ folha12: 5000, rbt12: 0 }) === null)
ok('sem Fator R o anexo é o V (o mais caro, que é a regra geral)', anexoPorFatorR(null) === 'V')
ok('valor inválido também cai no Anexo V', anexoPorFatorR(NaN) === 'V' && anexoPorFatorR(Infinity) === 'V')
ok('folha zero dá Fator R zero, não nulo', calcularFatorR({ folha12: 0, rbt12: 100000 }) === 0)

// ── 4. A folha mínima anunciada TEM que bastar ─────────────────────────────
// A tela diz "faltam R$ X de folha para o Anexo III". Se a pessoa lança
// exatamente X e o sistema continua no Anexo V, a tela mentiu — e a diferença
// é de milhares de reais. Testado com valores quebrados de propósito, porque é
// onde o ponto flutuante morde (foi assim que 550 − 549,99 virou "menos de um
// centavo" na regra da fatura).
for (const rbt12 of [192908.55, 100000, 33333.33, 1, 7, 0.07, 999999.99, 123456.78]) {
  const minima = folhaMinimaParaAnexoIII(rbt12)
  const anexo = anexoPorFatorR(calcularFatorR({ folha12: minima, rbt12 }))
  ok(`folha mínima de RBT12 ${rbt12} realmente alcança o Anexo III`, anexo === 'III',
    `folha ${minima} → fator ${calcularFatorR({ folha12: minima, rbt12 })} → Anexo ${anexo}`)
}

// ── 5. Um centavo a menos que a mínima não pode virar Anexo III ────────────
{
  const rbt12 = 192908.55
  const minima = folhaMinimaParaAnexoIII(rbt12)
  const anexo = anexoPorFatorR(calcularFatorR({ folha12: minima - 0.01, rbt12 }))
  ok('um centavo abaixo da folha mínima fica no Anexo V', anexo === 'V',
    `folha ${minima - 0.01} → Anexo ${anexo}`)
}

// ── 6. O caso real da Polímata ─────────────────────────────────────────────
// Pró-labore R$ 4.443,77/mês + CPP R$ 549,23/mês, RBT12 real de set/26.
{
  const rbt12 = 192908.55
  const folha12 = (4443.77 + 549.23) * 12
  const fator = calcularFatorR({ folha12, rbt12 })
  ok('Fator R real fica acima de 28%', fator > 0.28, `${(fator * 100).toFixed(2)}%`)
  ok('e coloca a empresa no Anexo III', anexoPorFatorR(fator) === 'III')
  ok('a margem é apertada — menos de 5 pontos', fator - 0.28 < 0.05, `${((fator - 0.28) * 100).toFixed(2)} pontos`)
}

// ── 7. Início de atividade: média × 12 ─────────────────────────────────────
{
  ok('3 meses somando 30 mil → RBT12 de 120 mil', proporcionalizarRBT12(30000, 3) === 120000,
    String(proporcionalizarRBT12(30000, 3)))
  ok('zero mês não divide por zero', proporcionalizarRBT12(30000, 0) === 0)
  ok('12 meses devolve a própria soma', proporcionalizarRBT12(180000, 12) === 180000)
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTodos os casos passaram.')
process.exit(falhas ? 1 : 0)
