// ===========================================================================
// PROVA: o banco não é fornecedor.
//
// Pergunta dela, em 10/11/2026, quando eu ia mandá-la cadastrar o Sicoob como
// fornecedor: "fornecedor é a classificação mais adequada? o que ele tá me
// fornecendo?". E depois, quando argumentei que a tarifa seria o serviço:
// "são tarifas, n faz sentido ser fornecedor".
//
// Ela estava certa nas duas. O banco empresta: é contraparte de DÍVIDA, não de
// despesa operacional. E no plano de contas dela, tarifa bancária e IOF já
// estão em "Despesas Financeiras" — nunca em despesa com fornecedor.
//
// Rodar: npm run provas
// ===========================================================================
import {
  PAPEIS, papeisDe, temPapel, tipoDerivado, papelDoRotuloAntigo, pessoasDosTipos,
} from '../src/lib/vinculoPessoa.js'

let falhas = 0
const ok = (nome, cond, extra = '') => {
  console.log((cond ? '  OK   ' : '  FALHA') + ' ' + nome + (cond ? '' : ' → ' + extra))
  if (!cond) falhas++
}

ok('o papel existe na lista',
  PAPEIS.some(p => p.v === 'instituicao_financeira'), '')
ok('e tem rótulo em português',
  PAPEIS.find(p => p.v === 'instituicao_financeira')?.label === 'Instituição Financeira', '')

const sicoob = { nome: 'SICOOB CREDIRIOCLARO', papeis: ['instituicao_financeira'] }
ok('o banco tem o papel', temPapel(sicoob, 'instituicao_financeira'), '')
ok('e NÃO é fornecedor', !temPapel(sicoob, 'fornecedor'), '')

// ── O filtro de credores ────────────────────────────────────────────────
const cadastro = [
  { id: 'b', data: sicoob },
  { id: 'r', data: { nome: 'Receita Federal do Brasil', tipo: 'Órgão Público' } },
  { id: 'f', data: { nome: 'FORNECEDOR QUALQUER', tipo: 'Fornecedor' } },
  { id: 'c', data: { nome: 'CLIENTE QUALQUER', tipo: 'Cliente' } },
]
const credores = pessoasDosTipos(cadastro, ['instituicao_financeira', 'Órgão Público', 'Fornecedor'])
ok('o banco aparece na lista de credores', credores.some(p => p.id === 'b'), '')
ok('a Receita também, pelos parcelamentos', credores.some(p => p.id === 'r'), '')
ok('fornecedor continua aceito: há contratos antigos cadastrados assim',
  credores.some(p => p.id === 'f'), '')
ok('cliente não é credor', !credores.some(p => p.id === 'c'), '')

// ── O filtro pelo valor do papel precisa funcionar ──────────────────────
//
// `pessoasDosTipos` traduz cada item por `papelDoRotuloAntigo`. Como este papel
// não tem rótulo antigo, sem a aceitação pelo próprio valor o filtro seria
// descartado em silêncio — e a lista de credores viria sem o banco.
ok('o papel novo é aceito pelo próprio valor',
  papelDoRotuloAntigo('instituicao_financeira') === 'instituicao_financeira',
  String(papelDoRotuloAntigo('instituicao_financeira')))
ok('e os rótulos antigos continuam traduzindo',
  papelDoRotuloAntigo('Órgão Público') === 'orgao_publico', '')
ok('rótulo desconhecido continua devolvendo nulo',
  papelDoRotuloAntigo('Coisa Nenhuma') === null, '')
ok('rótulo vazio não vira papel', papelDoRotuloAntigo('') === null, '')

// ── Compatibilidade com o cadastro antigo ───────────────────────────────
ok('cadastro antigo, sem papéis, continua traduzido pelo tipo',
  papeisDe({ tipo: 'Fornecedor' }).includes('fornecedor'), '')
ok('o tipo derivado do banco não vira "Cliente" por acidente',
  tipoDerivado(['instituicao_financeira']) === '',
  'não há rótulo antigo para este papel — e inventar um poria o banco numa lista errada')
ok('cliente continua tendo precedência quando há vários papéis',
  tipoDerivado(['fornecedor', 'cliente']) === 'Cliente', '')

console.log(falhas ? `\n${falhas} falha(s).` : '\nTodos os casos passaram.')
process.exit(falhas ? 1 : 0)
