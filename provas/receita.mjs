// ===========================================================================
// PROVA: a consulta à Receita distingue "não existe" de "não sei".
//
// Essa distinção não é detalhe. Confundir as duas foi o que fez a tela de
// cadastro acusar o número da usuária durante meses, quando quem bloqueava a
// consulta era a política de segurança do próprio site. Aqui o mesmo erro
// custaria mais caro: o robô marcaria como inválido o CNPJ de um fornecedor
// de verdade toda vez que a BrasilAPI estivesse fora do ar.
//
// Rodar: npm run provas
// ===========================================================================
import { consultarCnpj, limparMemoriaDaReceita } from '../lib/receita.js'

let falhas = 0
const ok = (nome, cond, extra = '') => {
  console.log((cond ? '  OK   ' : '  FALHA') + ' ' + nome + (cond ? '' : ' → ' + extra))
  if (!cond) falhas++
}
const VALIDO = '48948776000164'

// ── A Receita respondeu que existe ────────────────────────────────────────
limparMemoriaDaReceita()
let chamadas = 0
const respondeOk = async () => {
  chamadas++
  return { ok: true, status: 200, json: async () => ({
    razao_social: 'POLIMATA CONSULTORIA LTDA',
    descricao_situacao_cadastral: 'ATIVA',
  }) }
}
const achou = await consultarCnpj(VALIDO, { buscar: respondeOk })
ok('CNPJ que existe volta confirmado', achou.estado === 'confirmado', achou.estado)
ok('e traz a razão social da Receita', achou.razao_social === 'POLIMATA CONSULTORIA LTDA', achou.razao_social)

// O mesmo fornecedor manda vários documentos no mesmo lote.
await consultarCnpj(VALIDO, { buscar: respondeOk })
await consultarCnpj('48.948.776/0001-64', { buscar: respondeOk })
ok('o mesmo CNPJ não é consultado de novo no mesmo lote', chamadas === 1, `${chamadas} chamadas`)

// ── A Receita respondeu que NÃO existe ────────────────────────────────────
limparMemoriaDaReceita()
const naoExiste = await consultarCnpj('11111111111111', {
  buscar: async () => ({ ok: false, status: 404 }),
})
ok('404 vira "inexistente"', naoExiste.estado === 'inexistente', naoExiste.estado)

// ── A consulta NÃO aconteceu ──────────────────────────────────────────────
limparMemoriaDaReceita()
const caiu = await consultarCnpj(VALIDO, {
  buscar: async () => { throw new Error('getaddrinfo ENOTFOUND') },
})
ok('rede fora do ar vira "não respondeu", nunca "inexistente"',
  caiu.estado === 'nao_respondeu', caiu.estado)

limparMemoriaDaReceita()
const limite = await consultarCnpj(VALIDO, { buscar: async () => ({ ok: false, status: 429 }) })
ok('limite de uso do serviço também é "não respondeu"', limite.estado === 'nao_respondeu', limite.estado)

limparMemoriaDaReceita()
const servidor = await consultarCnpj(VALIDO, { buscar: async () => ({ ok: false, status: 503 }) })
ok('serviço fora também é "não respondeu"', servidor.estado === 'nao_respondeu', servidor.estado)

// E o mais importante: a falha não fica guardada. A próxima tentativa tenta.
limparMemoriaDaReceita()
let tentativas = 0
const instavel = async () => {
  tentativas++
  if (tentativas === 1) throw new Error('timeout')
  return { ok: true, status: 200, json: async () => ({ razao_social: 'FORNECEDOR LTDA' }) }
}
await consultarCnpj(VALIDO, { buscar: instavel })
const segunda = await consultarCnpj(VALIDO, { buscar: instavel })
ok('a falha não é guardada: a segunda tentativa consulta de novo',
  segunda.estado === 'confirmado' && tentativas === 2, `${segunda.estado}, ${tentativas} tentativas`)

// ── Número que nem chegou a ser CNPJ ──────────────────────────────────────
limparMemoriaDaReceita()
let nunca = 0
const curto = await consultarCnpj('123', { buscar: async () => { nunca++; return { ok: true, status: 200, json: async () => ({}) } } })
ok('número curto não vira "inexistente" — é "não respondeu"', curto.estado === 'nao_respondeu', curto.estado)
ok('e não gasta uma consulta', nunca === 0, `${nunca} chamadas`)

console.log(falhas ? `\n${falhas} falha(s).` : '\nTodos os casos passaram.')
process.exit(falhas ? 1 : 0)
