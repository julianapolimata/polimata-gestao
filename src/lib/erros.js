import { traduzErroFechamento } from './fechamento'

// =============================================================================
// ERROS EM PORTUGUÊS — uma única porta de entrada para a mensagem que a usuária lê.
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
// Registro: duas frases — o ESTADO (o que é verdade agora) e a CONDIÇÃO (o que
// a ação exige). Sem "não dá", sem "só", sem explicar por que a regra existe.
// A ordem importa: a busca é por texto.includes(chave), então a chave mais
// específica vem antes da mais curta que poderia casar dentro dela.
const CODIGOS_DO_SISTEMA = {
  // Conciliação
  transferencia_nao_compativel: 'Transferência incompatível com o lançamento escolhido. Confira valor, data e conta.',
  linha_da_fatura_indisponivel: 'Linha da fatura indisponível: já conciliada ou removida. Recarregue a fatura.',
  nenhuma_linha_selecionada: 'Nenhuma linha selecionada. Selecione ao menos uma linha do extrato.',
  extrato_nao_encontrado: 'Linha do extrato não encontrada. Recarregue a tela.',
  extrato_nao_pendente: 'Linha do extrato já conciliada. Recarregue a tela.',
  extrato_sem_conta: 'Linha do extrato sem conta vinculada. Reimporte o extrato na conta correspondente.',
  linha_indisponivel: 'Linha do extrato indisponível: já conciliada ou arquivada. Recarregue a tela.',
  contas_diferentes: 'Linhas de contas distintas. O agrupamento exige a mesma conta.',
  compra_indisponivel: 'Compra indisponível: já conciliada ou removida. Recarregue a tela.',
  conta_nao_e_cartao: 'A conta selecionada não é cartão de crédito. Escolha um cartão.',
  mesma_conta: 'Conta de origem e destino iguais. A transferência exige contas distintas.',
  // Lançamentos e documentos
  lancamento_nao_encontrado: 'Lançamento não encontrado. Recarregue a tela.',
  nf_pending_nao_encontrada: 'Documento não encontrado na caixa de entrada. Recarregue a tela.',
  importacao_nao_encontrada: 'Importação não encontrada. Recarregue a tela.',
  // Operação em lote
  lote_grande_demais: 'Seleção acima do limite de 500 itens. Divida em grupos menores.',
  lote_vazio: 'Nenhum item selecionado. Selecione ao menos um lançamento.',
  // Fechamento
  mes_nao_estava_fechado: 'Competência não estava encerrada. Recarregue a tela.',
  competencia_invalida: 'Competência inválida. Use o formato AAAA-MM.',
  // Destino e sessão
  target_invalido: 'Destino inválido. Recarregue a tela e repita a operação.',
  not_authenticated: 'Sessão expirada. Entre novamente.',
}

// Padrões de texto/código do Postgres e do Supabase.
// Ordem importa: o primeiro que casar vence.
const PADROES = [
  // Login e senha: o Supabase Auth responde em inglês e é a PRIMEIRA tela do
  // sistema — quem erra a senha não pode receber "Invalid login credentials".
  { codigos: [], testes: [/invalid login credentials/i], msg: 'E-mail ou senha incorretos.' },
  { codigos: [], testes: [/email not confirmed/i], msg: 'Esse e-mail ainda não foi confirmado. Procure o e-mail de acesso que enviamos.' },
  { codigos: [], testes: [/user already registered/i, /already been registered/i], msg: 'Já existe uma conta com esse e-mail.' },
  { codigos: [], testes: [/password should be at least/i, /password is too short/i], msg: 'A senha é curta demais — use pelo menos 6 caracteres.' },
  { codigos: [], testes: [/should be different from the old password/i], msg: 'A nova senha precisa ser diferente da atual.' },
  { codigos: [], testes: [/token has expired or is invalid/i, /otp_expired/i], msg: 'Esse link expirou. Peça um novo e-mail de redefinição.' },
  { codigos: [], testes: [/for security purposes, you can only request/i, /rate limit/i, /too many requests/i], msg: 'Você tentou várias vezes seguidas. Espere um minuto e tente de novo.' },
  { codigos: [], testes: [/auth session missing/i, /invalid refresh token/i], msg: 'Sua sessão expirou. Entre de novo.' },
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
