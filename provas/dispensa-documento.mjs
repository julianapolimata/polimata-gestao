// ===========================================================================
// PROVA: "o documento fiscal é cobrado por NATUREZA, não por regra geral"
// (REGRAS.md, regra 2).
//
// Duas maneiras de errar, e as duas custam:
//  • cobrar nota de quem nunca vai ter (IOF, DAS, parcela de empréstimo) é
//    pedir um papel que não existe — e o sistema vira burocracia que se
//    contorna;
//  • dispensar quem deveria justificar é deixar passar baixa sem prova.
//
// A regra é por CATEGORIA do plano de contas, nunca por palavra na descrição:
// quem decide a natureza é a classificação contábil.
//
// Rodar: npm run provas
// ===========================================================================
import {
  CATEGORIAS_SEM_NOTA_FISCAL, dispensaDocumentoFiscal,
  exigeJustificativaNaBaixa, motivoDaDispensa,
} from '../src/lib/naturezas.js'

let falhas = 0
const ok = (nome, cond, extra = '') => {
  console.log((cond ? '  OK   ' : '  FALHA') + ' ' + nome + (cond ? '' : ' → ' + extra))
  if (!cond) falhas++
}

// ── 1. As três naturezas que nunca terão nota ──────────────────────────────
{
  const dispensadas = [
    ['Despesas Financeiras', 'extrato'],       // IOF, juros, tarifa
    ['Receita Financeira', 'extrato'],         // juros recebidos, descontos obtidos
    ['Empréstimos e Financiamentos', 'contrato'],
    ['Impostos sobre Receita', 'guia'],        // DAS
    ['Impostos sobre Folha', 'guia'],          // INSS, FGTS
    ['Impostos retidos na fonte', 'guia'],
    ['Outros Tributos', 'guia'],
    ['Parcelamento de Tributos', 'guia'],
  ]
  for (const [cat, palavra] of dispensadas) {
    ok(`"${cat}" dispensa nota`, dispensaDocumentoFiscal({ cat }) === true)
    ok(`"${cat}" não pede justificativa na baixa`, exigeJustificativaNaBaixa({ cat }) === false)
    ok(`"${cat}" explica que o documento é o ${palavra}`,
      new RegExp(palavra, 'i').test(motivoDaDispensa({ cat })), motivoDaDispensa({ cat }))
  }
}

// ── 2. "Receita Financeira" — a grafia que o plano usa de verdade ──────────
// Este era um bug: a lista dizia "Receitas Financeiras" (plural nas duas
// palavras), que não existe em plano nenhum. Resultado: o sistema pedia
// justificativa para um crédito do banco cujo documento é o próprio extrato.
// Ainda não tinha mordido só porque nenhum juro recebido foi lançado.
{
  ok('"Receita Financeira" (como está no plano) dispensa',
    dispensaDocumentoFiscal({ cat: 'Receita Financeira' }) === true)
  ok('e a grafia no plural também, por segurança',
    dispensaDocumentoFiscal({ cat: 'Receitas Financeiras' }) === true)
}

// ── 3. Todo o resto EXIGE justificativa ────────────────────────────────────
{
  const exigem = [
    'Serviços de Terceiros', 'Despesas Operacionais', 'Marketing e Comercial',
    'Deslocamento e Viagem', 'Pessoal / Mão de Obra', 'Receita de Serviços',
    'Materiais e Suprimentos', 'Capacitação e Desenvolvimento', 'Outras Despesas',
  ]
  for (const cat of exigem) {
    ok(`"${cat}" exige justificativa na baixa sem extrato`,
      exigeJustificativaNaBaixa({ cat }) === true && dispensaDocumentoFiscal({ cat }) === false)
    ok(`"${cat}" não inventa motivo de dispensa`, motivoDaDispensa({ cat }) === '')
  }
}

// ── 4. Sem categoria, não se presume nada ──────────────────────────────────
// "Lançamento ainda sem categoria exige justificativa: sem classificação não
// dá para saber a natureza, e o certo é perguntar, não presumir."
{
  ok('sem categoria → exige justificativa', exigeJustificativaNaBaixa({ cat: '' }) === true)
  ok('categoria nula → exige justificativa', exigeJustificativaNaBaixa({ cat: null }) === true)
  ok('objeto vazio → exige justificativa', exigeJustificativaNaBaixa({}) === true)
  ok('undefined → exige justificativa', exigeJustificativaNaBaixa(undefined) === true)
  ok('sem categoria não dispensa', dispensaDocumentoFiscal({ cat: '' }) === false)
}

// ── 5. A natureza sai da CATEGORIA, não da descrição ───────────────────────
// Se a palavra na descrição valesse, bastaria escrever "IOF" no texto para
// escapar da justificativa — e o controle seria contornável por digitação.
{
  const disfarcado = { cat: 'Serviços de Terceiros', desc: 'IOF juros tarifa DAS imposto empréstimo', supplier: 'TARIFA BANCARIA' }
  ok('palavra na descrição não dispensa nada', dispensaDocumentoFiscal(disfarcado) === false,
    JSON.stringify(disfarcado))
  ok('e a justificativa continua exigida', exigeJustificativaNaBaixa(disfarcado) === true)

  const semPalavra = { cat: 'Despesas Financeiras', desc: 'cobranca mensal', supplier: 'SICOOB' }
  ok('e a categoria certa dispensa mesmo sem palavra nenhuma',
    dispensaDocumentoFiscal(semPalavra) === true)
}

// ── 6. Acento e caixa não separam a mesma categoria ────────────────────────
// O plano é digitado por gente; "Emprestimos" sem acento é a mesma natureza.
{
  for (const cat of [
    'Emprestimos e Financiamentos',
    'EMPRÉSTIMOS E FINANCIAMENTOS',
    '  Empréstimos e Financiamentos  ',
    'empréstimos e financiamentos',
  ]) {
    ok(`"${cat.trim()}" é reconhecida`, dispensaDocumentoFiscal({ cat }) === true)
  }
}

// ── 7. A lista exportada é a fonte, e bate com as funções ──────────────────
{
  ok('a lista não está vazia', CATEGORIAS_SEM_NOTA_FISCAL.length > 0)
  ok('toda categoria da lista realmente dispensa',
    CATEGORIAS_SEM_NOTA_FISCAL.every(cat => dispensaDocumentoFiscal({ cat })),
    JSON.stringify(CATEGORIAS_SEM_NOTA_FISCAL.filter(cat => !dispensaDocumentoFiscal({ cat }))))
  ok('toda categoria da lista tem um motivo escrito',
    CATEGORIAS_SEM_NOTA_FISCAL.every(cat => motivoDaDispensa({ cat }).length > 0),
    JSON.stringify(CATEGORIAS_SEM_NOTA_FISCAL.filter(cat => !motivoDaDispensa({ cat }))))
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTodos os casos passaram.')
process.exit(falhas ? 1 : 0)
