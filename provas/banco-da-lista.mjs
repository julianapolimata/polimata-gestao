// ===========================================================================
// PROVA: o banco da conta de recebimento é dado, não texto.
//
// Antes, "Banco" era um campo livre. "Sicoob", "SICOOB" e "756" conviviam no
// mesmo cadastro, e nenhum deles carregava o código COMPE — o número que
// identifica a instituição em boleto, TED e arquivo de retorno.
//
// A lista é a do Banco Central. O que se guarda é o código E o nome; o rótulo
// mostrado na tela é remontado a partir dos dois, e nunca é a fonte do dado.
//
// Rodar: npm run provas
// ===========================================================================
import { codigoCompe, rotuloBanco, bancoDoRotulo } from '../src/lib/bancosBacen.js'

let falhas = 0
const ok = (nome, cond, extra = '') => {
  console.log((cond ? '  OK   ' : '  FALHA') + ' ' + nome + (cond ? '' : ' → ' + extra))
  if (!cond) falhas++
}

const LISTA = [
  { codigo: '001', nome: 'Banco do Brasil S.A.' },
  { codigo: '341', nome: 'Itaú Unibanco S.A.' },
  { codigo: '756', nome: 'Banco Cooperativo Sicoob S.A.' },
]

// ── O código tem três dígitos, sempre ─────────────────────────────────────
// A API devolve o número inteiro (1, 341). Gravado assim, "1" nunca casaria
// com o "001" de um boleto.
ok('o código 1 vira 001', codigoCompe(1) === '001', codigoCompe(1))
ok('o código 756 continua 756', codigoCompe(756) === '756')
ok('"341" como texto continua 341', codigoCompe('341') === '341')
ok('sem código devolve vazio', codigoCompe(null) === '' && codigoCompe('') === '')

// ── O rótulo é remontado, não guardado ────────────────────────────────────
ok('rótulo junta código e nome',
  rotuloBanco('756', 'Banco Cooperativo Sicoob S.A.') === '756 — Banco Cooperativo Sicoob S.A.',
  rotuloBanco('756', 'Banco Cooperativo Sicoob S.A.'))
ok('cadastro antigo, só com nome, ainda aparece',
  rotuloBanco('', 'Sicoob') === 'Sicoob')

// ── Da escolha na lista de volta para os dois campos ──────────────────────
const escolhido = bancoDoRotulo('756 — Banco Cooperativo Sicoob S.A.', LISTA)
ok('escolher na lista guarda o código',
  escolhido.banco_codigo === '756' && escolhido.banco === 'Banco Cooperativo Sicoob S.A.',
  JSON.stringify(escolhido))

// Quem sabe o número digita o número.
const porNumero = bancoDoRotulo('341', LISTA)
ok('digitar só o número reconhece o banco',
  porNumero.banco_codigo === '341' && porNumero.banco === 'Itaú Unibanco S.A.',
  JSON.stringify(porNumero))

// ── A lista guia, não prende ──────────────────────────────────────────────
// Banco fora da lista (cooperativa pequena, conta no exterior): o que ela
// escreveu vale. O que NÃO pode é o sistema inventar um código.
const fora = bancoDoRotulo('Cooperativa de Crédito do Vale', LISTA)
ok('banco fora da lista é aceito pelo nome',
  fora.banco === 'Cooperativa de Crédito do Vale', JSON.stringify(fora))
ok('e não ganha código inventado', fora.banco_codigo === '', fora.banco_codigo)

// Campo apagado não deixa resíduo de um banco anterior.
const vazio = bancoDoRotulo('', LISTA)
ok('campo vazio limpa os dois', vazio.banco === '' && vazio.banco_codigo === '')

console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.')
process.exit(falhas ? 1 : 0)
