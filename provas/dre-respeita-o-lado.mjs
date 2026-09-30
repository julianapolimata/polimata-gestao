// ===========================================================================
// PROVA: a DRE respeita o LADO do lançamento, e não chuta a classificação.
//
// Dois erros que já custaram número errado em silêncio:
//  • os blocos declaram `tipoFin`, mas o agrupamento era só pela
//    classificação — uma ENTRADA com categoria de despesa era somada no bloco
//    de DESPESA, aumentando o gasto em vez de reduzi-lo;
//  • a classificação da categoria vinha da ÚLTIMA linha do plano, então
//    "Despesas Operacionais" sem subcategoria caía em Despesa FINANCEIRA por
//    causa do "Seguro Prestamista", que é a última linha da categoria.
//
// Rodar: npm run provas
// ===========================================================================
import { computeDRE } from '../src/lib/dre.js'

const ANO = '2026'

// Recorte do plano real da Polímata, com as duas armadilhas preservadas:
// "Despesas Operacionais" termina em Seguro Prestamista (Despesa Financeira), e
// "Despesas de Viagens" existe também no tipo Entrada (reembolso recebido).
const plano = [
  { tipo: 'Entrada', categoria: 'Receita de Serviços', subcategoria: 'Controles Internos', classificacao: 'Receita Bruta', ordem: 1 },
  { tipo: 'Entrada', categoria: 'Despesas de Viagens', subcategoria: 'Reembolso de despesas', classificacao: 'Despesas de Viagens', ordem: 2 },
  { tipo: 'Entrada', categoria: 'Conta transitória (a esclarecer)', subcategoria: 'A esclarecer', classificacao: 'Conta Transitória', ordem: 3 },
  { tipo: 'Saída', categoria: 'Despesas Operacionais', subcategoria: 'Aluguel', classificacao: 'Despesas Operacionais', ordem: 10 },
  { tipo: 'Saída', categoria: 'Despesas Operacionais', subcategoria: 'Softwares', classificacao: 'Despesas Operacionais', ordem: 11 },
  { tipo: 'Saída', categoria: 'Despesas Operacionais', subcategoria: 'Seguro Prestamista', classificacao: 'Despesas Financeiras', ordem: 12 },
  { tipo: 'Saída', categoria: 'Despesas Financeiras', subcategoria: 'Tarifas bancárias', classificacao: 'Despesas Financeiras', ordem: 13 },
]

const lanc = (value, cat, subcat, tipoEntrada) => ({
  id: `${tipoEntrada ? 'r' : 'p'}-${cat}-${subcat}-${value}`,
  value,
  data: { cat, subcat, data_competencia: `${ANO}-03-10`, escriturado: true, status: 'Pago' },
})
const rec = (v, cat, sub) => lanc(v, cat, sub, true)
const pay = (v, cat, sub) => lanc(v, cat, sub, false)

const bloco = (linhas, id) => linhas.find(l => l.id === id)
const foraDe = (linhas, motivo) =>
  Object.entries(linhas.fora.porCat).filter(([, v]) => v.motivo === motivo)

let falhas = 0
const ok = (nome, cond, extra = '') => {
  console.log((cond ? '  OK   ' : '  FALHA') + ' ' + nome + (cond ? '' : ' → ' + extra))
  if (!cond) falhas++
}

// ── 1. Entrada com categoria de despesa não vira despesa ────────────────────
{
  const linhas = computeDRE({
    receivable: [rec(500, 'Despesas de Viagens', 'Reembolso de despesas')],
    payable: [], plano, ano: ANO,
  })
  ok('entrada com categoria de despesa não entra no bloco de despesa',
    bloco(linhas, 'desp-op').total === 0, `desp-op = ${bloco(linhas, 'desp-op').total}`)
  ok('ela cai no rodapé com motivo "lado-errado"',
    foraDe(linhas, 'lado-errado').length === 1, JSON.stringify(linhas.fora.porCat))
}

// ── 2. Despesa sem subcategoria usa a classificação DOMINANTE da categoria ──
//     (a primeira linha do plano), não a última.
{
  const linhas = computeDRE({ receivable: [], payable: [pay(1000, 'Despesas Operacionais', '')], plano, ano: ANO })
  ok('despesa sem subcategoria vai para Despesas Operacionais',
    bloco(linhas, 'desp-op').total === 1000, `desp-op = ${bloco(linhas, 'desp-op').total}`)
  ok('e NÃO para Despesas Financeiras',
    bloco(linhas, 'desp-fin').total === 0, `desp-fin = ${bloco(linhas, 'desp-fin').total}`)
}

// ── 3. A subcategoria manda quando existe (Seguro Prestamista é financeira) ─
{
  const linhas = computeDRE({ receivable: [], payable: [pay(300, 'Despesas Operacionais', 'Seguro Prestamista')], plano, ano: ANO })
  ok('subcategoria financeira dentro de categoria operacional vai p/ Despesas Financeiras',
    bloco(linhas, 'desp-fin').total === 300 && bloco(linhas, 'desp-op').total === 0,
    JSON.stringify({ fin: bloco(linhas, 'desp-fin').total, op: bloco(linhas, 'desp-op').total }))
}

// ── 4. O caminho feliz continua feliz ───────────────────────────────────────
{
  const linhas = computeDRE({
    receivable: [rec(10000, 'Receita de Serviços', 'Controles Internos')],
    payable: [pay(2000, 'Despesas Operacionais', 'Softwares'), pay(50, 'Despesas Financeiras', 'Tarifas bancárias')],
    plano, ano: ANO,
  })
  ok('receita entra na Receita Bruta', bloco(linhas, 'rec-bruta').total === 10000)
  ok('lucro líquido = 10000 − 2000 − 50', bloco(linhas, 'resul-fin').total === 7950,
    `resul-fin = ${bloco(linhas, 'resul-fin').total}`)
  ok('nada caiu no rodapé', linhas.fora.count === 0, JSON.stringify(linhas.fora.porCat))
}

// ── 5. Conta transitória fica fora do resultado, mas aparece ────────────────
{
  const linhas = computeDRE({
    receivable: [rec(17.55, 'Conta transitória (a esclarecer)', 'A esclarecer')],
    payable: [], plano, ano: ANO,
  })
  ok('conta transitória não entra no resultado', bloco(linhas, 'resul-fin').total === 0)
  ok('e aparece no rodapé com o motivo certo', foraDe(linhas, 'nao-entra-no-resultado').length === 1,
    JSON.stringify(linhas.fora.porCat))
}

// ── 6. Categoria que não existe no plano não some calada ────────────────────
{
  const linhas = computeDRE({ receivable: [], payable: [pay(119, 'Operacional', '')], plano, ano: ANO })
  ok('categoria fora do plano cai no rodapé', foraDe(linhas, 'fora-do-plano').length === 1,
    JSON.stringify(linhas.fora.porCat))
  ok('e não entra em bloco nenhum', bloco(linhas, 'desp-op').total === 0)
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTodos os casos passaram.')
process.exit(falhas ? 1 : 0)
