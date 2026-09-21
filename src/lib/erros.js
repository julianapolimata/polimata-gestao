import { traduzErroFechamento } from './fechamento'

// =============================================================================
// ERROS EM PORTUGUÊS — uma única porta de entrada pra mensagem que a usuária lê.
//
// Antes: ~50 lugares faziam `showToast('Erro: ' + e.message)` e jogavam na tela
// o texto cru do Postgres/Supabase, em inglês ("duplicate key value violates
// unique constraint…", "JWT expired"). Aqui traduzimos os casos conhecidos e,
// pro resto, damos uma frase honesta COM o detalhe técnico entre parênteses —
// nada é escondido, só deixa de ser a primeira coisa que ela vê.
//
// Uso típico:
//   import { msgErro } from '../lib/erros'
//   catch (e) { showToast(msgErro(e), 'error') }
//   catch (e) { showToast(msgErro(e, 'Não consegui excluir o lançamento.'), 'error') }
// =============================================================================

const FALLBACK = 'Não consegui concluir a operação.'

// Códigos que o próprio sistema levanta (RPC/edge/trigger) sem texto em português.
// Os prefixos COM texto em português (periodo_fechado: …) vêm de fechamento.js.
const CODIGOS_DO_SISTEMA = {
  transferencia_nao_compativel: 'Essa transferência não combina com o lançamento escolhido. Confira valor, data e conta antes de conciliar.',
  linha_da_fatura_indisponivel: 'Essa linha da fatura não está mais disponível — ela pode já ter sido conciliada ou removida. Recarregue a fatura.',
  compra_indisponivel: 'Essa compra não está mais disponível — ela pode já ter sido conciliada ou removida. Recarregue a tela.',
  conta_nao_e_cartao: 'Essa conta não é um cartão de crédito. Escolha um cartão para continuar.',
  not_authenticated: 'Sua sessão expirou. Entre de novo.',
}

// Padrões de texto/código do Postgres e do Supabase.
// Ordem importa: o primeiro que casar vence.
const PADROES = [
  { codigos: ['23505'], testes: [/duplicate key/i, /already exists/i, /unique constraint/i], msg: 'Esse registro já existe.' },
  { codigos: ['23503'], testes: [/foreign key/i, /violates foreign key constraint/i], msg: 'Esse item está ligado a outro registro e não pode ser removido.' },
  { codigos: ['23514'], testes: [/check constraint/i, /violates check/i], msg: 'Algum campo está com valor inválido.' },
  { codigos: ['23502'], testes: [/not-null/i, /not null constraint/i, /null value in column/i], msg: 'Falta preencher um campo obrigatório.' },
  { codigos: ['22P02'], testes: [/invalid input syntax/i], msg: 'Algum campo está com formato inválido.' },
  { codigos: ['PGRST301'], testes: [/jwt expired/i, /invalid token/i, /invalid jwt/i, /refresh token/i, /session (from session id )?not found/i], msg: 'Sua sessão expirou. Entre de novo.' },
  { codigos: ['42501'], testes: [/row-level security/i, /row level security/i, /permission denied/i, /not authorized/i], msg: 'Você não tem permissão para isso.' },
  { codigos: [], testes: [/failed to fetch/i, /networkerror/i, /network request failed/i, /err_internet_disconnected/i, /load failed/i], msg: 'Sem conexão com o servidor. Verifique a internet e tente de novo.' },
  { codigos: [], testes: [/timeout/i, /timed out/i, /canceling statement due to statement timeout/i], msg: 'O servidor demorou demais para responder. Tente de novo.' },
  { codigos: ['PGRST116'], testes: [/results contain 0 rows/i, /no rows returned/i], msg: 'Esse registro não foi encontrado — alguém pode tê-lo apagado enquanto você estava na tela.' },
  { codigos: ['413'], testes: [/payload too large/i, /file size/i, /maximum allowed size/i], msg: 'O arquivo é grande demais para o limite do sistema.' },
]

/** Todo o texto disponível do erro, pra casar padrões. */
function textoDe(err) {
  if (!err) return ''
  if (typeof err === 'string') return err
  return [err.message, err.details, err.hint, err.error_description, err.error]
    .filter(v => typeof v === 'string')
    .join(' · ')
}

function codigoDe(err) {
  if (!err || typeof err === 'string') return ''
  return String(err.code ?? err.status ?? err.statusCode ?? '')
}

/**
 * Detalhe técnico enxuto pra ir entre parênteses — o que aconteceu de verdade,
 * sem sumir da tela (é o que a Juliana manda pro suporte quando trava).
 */
export function detalheTecnico(err) {
  const codigo = codigoDe(err)
  const texto = textoDe(err) || (err ? String(err) : '')
  const bruto = [codigo && `código ${codigo}`, texto].filter(Boolean).join(': ')
  const limpo = bruto.replace(/\s+/g, ' ').trim()
  if (!limpo) return 'sem detalhe técnico'
  return limpo.length > 220 ? limpo.slice(0, 217) + '…' : limpo
}

/**
 * Tradução de um caso CONHECIDO. Devolve a frase em português, ou null quando
 * não reconhecemos o erro (aí quem chama monta a frase honesta com o detalhe).
 */
export function traduzErroConhecido(err) {
  if (!err) return null

  // 1) Regras de fechamento — a mensagem em português já vem do banco.
  const deFechamento = traduzErroFechamento(err)
  if (deFechamento) return deFechamento

  const texto = textoDe(err) || String(err || '')
  const codigo = codigoDe(err)

  // 2) Códigos do próprio sistema ("not_authenticated", "compra_indisponivel"…).
  for (const [chave, msg] of Object.entries(CODIGOS_DO_SISTEMA)) {
    if (texto.includes(chave) || codigo === chave) return msg
  }

  // 3) Postgres / Supabase / rede.
  for (const p of PADROES) {
    if (codigo && p.codigos.includes(codigo)) return p.msg
    if (p.testes.some(re => re.test(texto))) return p.msg
  }
  return null
}

/**
 * Frase em português pro erro. Sempre devolve algo legível: quando não
 * conhecemos o erro, devolve a frase honesta com o detalhe técnico no fim.
 */
export function traduzErro(err) {
  return traduzErroConhecido(err) || `${FALLBACK} (${detalheTecnico(err)})`
}

/**
 * Mensagem pronta pro toast.
 * - Erro conhecido → só a frase em português (já é clara sozinha).
 * - Erro desconhecido → `fallback` (ou a frase padrão) + detalhe técnico.
 *
 * @param {*} err erro do Supabase, Error, string…
 * @param {string} [fallback] contexto da ação: 'Não consegui excluir o lançamento.'
 */
export function msgErro(err, fallback) {
  const conhecido = traduzErroConhecido(err)
  if (conhecido) return conhecido
  return `${fallback || FALLBACK} (${detalheTecnico(err)})`
}

export default msgErro
