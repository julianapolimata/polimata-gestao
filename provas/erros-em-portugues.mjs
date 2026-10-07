// Nenhuma tela do sistema pode mostrar texto cru do Postgres ou do Supabase.
// A porta única é msgErro(); esta prova cobra os casos que a Juliana ja viu na
// tela e, principalmente, que a tradução NAO depende de quem chama lembrar.
import { msgErro, traduzErroConhecido } from '../src/lib/erros.js'

let falhas = 0
const ok = (cond, oque) => { if (!cond) { falhas++; console.error('  X ' + oque) } }

// O erro exato que ela recebeu ao criar a subcategoria pela tela.
const duplicado = { code: '23505', message: 'duplicate key value violates unique constraint "plano_contas_tipo_cat_sub_key"' }
ok(msgErro(duplicado, 'qualquer coisa') === 'Esse registro ja existe.'.replace('ja', 'já'),
  'erro conhecido vence o fallback de quem chamou')
ok(!/duplicate key|constraint/i.test(msgErro(duplicado)),
  'o texto cru do Postgres nao sobra na mensagem conhecida')

// A primeira tela do sistema: senha errada não pode falar inglês.
ok(traduzErroConhecido({ message: 'Invalid login credentials' }) === 'E-mail ou senha incorretos.',
  'login inválido traduzido')

// Erro DESCONHECIDO: a frase de contexto aparece, e o detalhe técnico fica
// visível entre parênteses — é o que ela manda pro suporte quando trava.
const estranho = { code: 'XX999', message: 'something exploded' }
const msg = msgErro(estranho, 'Não consegui fechar o período.')
ok(msg.startsWith('Não consegui fechar o período.'), 'fallback de contexto aparece')
ok(msg.includes('XX999') && msg.includes('something exploded'), 'detalhe técnico não é escondido')

// Rede caída não é culpa do banco.
ok(traduzErroConhecido(new TypeError('Failed to fetch'))?.includes('internet'), 'falha de rede traduzida')

if (falhas) { console.error(falhas + ' falha(s)'); process.exit(1) }
console.log('  ok: erros chegam em português, com o detalhe técnico preservado')
