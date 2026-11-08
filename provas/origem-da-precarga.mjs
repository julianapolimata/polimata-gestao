// ===========================================================================
// PROVA: a pré-carga diz de onde veio.
//
// A tela de Escrituração chega com os campos preenchidos. Três coisas bem
// diferentes podem tê-los preenchido, e elas pedem conferência diferente:
//
//   o próprio lançamento   já estava classificado assim;
//   a regra viva           o histórico daquele fornecedor é unânime;
//   a regra guardada       ela decidiu antes da limpeza, e os lançamentos que
//                          provavam já não existem.
//
// Campo preenchido sem dizer por quê convida a confirmar sem conferir. Esta
// prova fixa a procedência e, principalmente, que ela NÃO é guardada junto com
// a regra — senão a memória se apresentaria como regra viva na leitura seguinte.
//
// Rodar: npm run provas
// ===========================================================================
import { construirRegras } from '../src/lib/escrituracao.js'
import { juntarRegras, semProcedencia } from '../src/lib/memoriaRegras.js'

let falhas = 0
const ok = (nome, cond, extra = '') => {
  console.log((cond ? '  OK   ' : '  FALHA') + ' ' + nome + (cond ? '' : ' → ' + extra))
  if (!cond) falhas++
}

const manual = (cnpj, cat, subcat) => ({
  data: {
    escriturado: true, escriturado_por: 'manual',
    cnpj, cat, subcat, doc_status: 'vinculado', doc_motivo_dispensa: '',
  },
})

// ── A regra viva ─────────────────────────────────────────────────────────
const vivas = construirRegras([
  manual('11222333000144', 'Serviços de Terceiros', 'Contabilidade'),
  manual('11222333000144', 'Serviços de Terceiros', 'Contabilidade'),
  manual('11222333000144', 'Serviços de Terceiros', 'Contabilidade'),
])
const regra = vivas.get('cnpj:11222333000144')
ok('a regra viva se identifica como viva', regra?.origem === 'viva', String(regra?.origem))
ok('e diz em quantos lançamentos se apoia', regra?.quantos === 3, String(regra?.quantos))
ok('sem perder a classificação', regra?.cat === 'Serviços de Terceiros', String(regra?.cat))

// Histórico divergente continua sem virar regra.
const divergente = construirRegras([
  manual('99888777000166', 'Serviços de Terceiros', 'Contabilidade'),
  manual('99888777000166', 'Despesas Administrativas', 'Material'),
])
ok('histórico divergente não vira regra, e isso não mudou',
  divergente.get('cnpj:99888777000166') === undefined, '')

// ── A memória por baixo, a viva por cima ─────────────────────────────────
const memoria = new Map([
  ['cnpj:11222333000144', { cat: 'Antiga', subcat: '', doc_status: 'dispensado', doc_motivo_dispensa: '', origem: 'memoria', guardado_em: '2026-11-05' }],
  ['cnpj:55666777000188', { cat: 'Energia Elétrica', subcat: '', doc_status: 'vinculado', doc_motivo_dispensa: '', origem: 'memoria', guardado_em: '2026-11-05' }],
])
const juntas = juntarRegras(memoria, vivas)
ok('onde há regra viva, ela ganha da guardada',
  juntas.get('cnpj:11222333000144').cat === 'Serviços de Terceiros', juntas.get('cnpj:11222333000144').cat)
ok('e a procedência acompanha: passou a ser viva',
  juntas.get('cnpj:11222333000144').origem === 'viva', juntas.get('cnpj:11222333000144').origem)
ok('onde só há memória, ela vale e se identifica como memória',
  juntas.get('cnpj:55666777000188').origem === 'memoria', juntas.get('cnpj:55666777000188').origem)
ok('a memória carrega a data em que foi guardada',
  juntas.get('cnpj:55666777000188').guardado_em === '2026-11-05', '')

// ── A procedência NÃO é guardada ─────────────────────────────────────────
const guardavel = semProcedencia(regra)
ok('o que vai para a memória não leva "origem"', guardavel.origem === undefined, String(guardavel.origem))
ok('nem "quantos"', guardavel.quantos === undefined, String(guardavel.quantos))
ok('mas leva a classificação inteira',
  guardavel.cat === 'Serviços de Terceiros' && guardavel.subcat === 'Contabilidade'
  && guardavel.doc_status === 'vinculado', JSON.stringify(guardavel))
ok('e campo ausente vira string vazia, nunca undefined',
  semProcedencia({}).cat === '' && semProcedencia({}).doc_motivo_dispensa === '', '')

console.log(falhas ? `\n${falhas} falha(s).` : '\nTodos os casos passaram.')
process.exit(falhas ? 1 : 0)
