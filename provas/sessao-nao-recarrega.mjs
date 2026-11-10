// ===========================================================================
// PROVA: renovar o token não pode equivaler a trocar de usuário.
//
// O defeito que esta prova tranca: o sistema recarregava a tela inteira toda
// vez que a aba voltava ao foco, porque o objeto do usuário chegava novo. Quem
// estava preenchendo um cadastro e saiu para consultar um dado perdia o que
// tinha digitado.
//
// Rodar: npm run provas
// ===========================================================================
import { usuarioQueContinua } from '../src/lib/sessao.js'

let falhas = 0
const ok = (nome, cond, extra = '') => {
  console.log((cond ? '  OK   ' : '  FALHA') + ' ' + nome + (cond ? '' : ' → ' + extra))
  if (!cond) falhas++
}

const ana = { id: 'u-1', email: 'ana@exemplo.com' }
// O mesmo usuário, como o supabase o devolve depois de renovar o token: outro
// objeto, mesmos dados.
const anaDeNovo = { id: 'u-1', email: 'ana@exemplo.com' }
const outra = { id: 'u-2', email: 'bia@exemplo.com' }

ok('token renovado devolve o MESMO objeto',
  usuarioQueContinua(ana, anaDeNovo) === ana)
ok('e não o que acabou de chegar',
  usuarioQueContinua(ana, anaDeNovo) !== anaDeNovo)

// O que não pode quebrar junto:
ok('trocar de usuário devolve o novo',
  usuarioQueContinua(ana, outra) === outra)
ok('sair devolve nulo, e as telas recarregam',
  usuarioQueContinua(ana, null) === null)
ok('entrar a partir do nada devolve o novo',
  usuarioQueContinua(null, ana) === ana)
ok('sem sessão dos dois lados continua sem sessão',
  usuarioQueContinua(null, null) === null)

// Sessão sem id não é sessão conhecida: na dúvida, o novo vale, porque o
// contrário seria segurar uma identidade que o servidor já não confirma.
ok('objeto sem id não é tratado como o mesmo',
  usuarioQueContinua({ email: 'x' }, ana) === ana)

console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.')
process.exit(falhas ? 1 : 0)
