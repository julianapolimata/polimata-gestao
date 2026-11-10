// ===========================================================================
// PROVA: o apelido do cartão identifica o fornecedor.
//
// A fatura do cartão não traz CNPJ — traz um texto abreviado e diferente a
// cada mês. O apelido é cadastrado por ela, uma vez, e passa a valer como
// identificação.
//
// O campo foi construído em 05/11/2026 e, até a auditoria de 10/11, NINGUÉM
// o lia. As compras nasciam com o descritivo cru no lugar do fornecedor, e a
// ficha da pessoa não encontrava nenhuma delas.
//
// Rodar: npm run provas
// ===========================================================================
import { pessoaPorApelido } from '../src/lib/vinculoPessoa.js'

let falhas = 0
const ok = (nome, cond, extra = '') => {
  console.log((cond ? '  OK   ' : '  FALHA') + ' ' + nome + (cond ? '' : ' → ' + extra))
  if (!cond) falhas++
}

const cadastro = [
  { id: 'p-google', data: { nome: 'GOOGLE CLOUD BRASIL LTDA', apelidos: ['GOOGLE *CLOUD', 'GOOGLE CLOU'] } },
  { id: 'p-nti', data: { nome: 'NTI BRASIL SOLUCOES DIGITAIS LTDA', apelidos: ['NTI BRASIL'] } },
  { id: 'p-sem', data: { nome: 'FORNECEDOR SEM APELIDO LTDA' } },
]

ok('o descritivo que CONTÉM o apelido identifica a pessoa',
  pessoaPorApelido(cadastro, 'GOOGLE *CLOUD      SAO PAULO BR')?.id === 'p-google', '')
ok('o segundo apelido do mesmo fornecedor também vale',
  pessoaPorApelido(cadastro, 'PAG*GOOGLE CLOU 12/24')?.id === 'p-google', '')
ok('acento e caixa não atrapalham',
  pessoaPorApelido(cadastro, 'nti brasil soluções')?.id === 'p-nti', '')
ok('descritivo de quem não está cadastrado não casa com ninguém',
  pessoaPorApelido(cadastro, 'UBER *TRIP SAO PAULO') === null, '')
ok('pessoa sem apelido não é alcançada por aqui',
  pessoaPorApelido(cadastro, 'FORNECEDOR SEM APELIDO') === null,
  'o nome não serve de prova: só o apelido cadastrado vale')
ok('apelido curto demais é ignorado — casaria com qualquer coisa',
  pessoaPorApelido([{ id: 'x', data: { apelidos: ['AB'] } }], 'ABACATE LTDA') === null, '')
ok('lista vazia não quebra', pessoaPorApelido([], 'QUALQUER') === null, '')
ok('descritivo vazio não casa', pessoaPorApelido(cadastro, '') === null, '')

console.log(falhas ? `\n${falhas} falha(s).` : '\nTodos os casos passaram.')
process.exit(falhas ? 1 : 0)
