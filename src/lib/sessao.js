// =============================================================================
// A IDENTIDADE DA SESSÃO.
//
// Regra de uma linha, com um defeito de uma tarde atrás dela.
//
// O supabase avisa sobre a sessão em mais situações do que entrar e sair: o
// token é renovado de tempos em tempos, e a aba voltar ao foco também dispara
// o aviso. Em todas elas o usuário é o mesmo, e o objeto que chega é novo.
//
// Dezenove telas do sistema carregam seus dados num efeito que depende desse
// objeto. Objeto novo, efeito dispara, tela recarrega do banco — e o que
// estava sendo digitado, e ainda não foi salvo, é substituído pelo que está
// gravado.
//
// Relato dela, 10/11/2026: "se eu mudo de tela pra pegar uma informação pra
// inserir no sistema, ele atualiza a tela e eu perco o que estava digitando".
// Consultar um CNPJ em outra aba e voltar é o caminho que o próprio sistema
// pede — e era o caminho que apagava o trabalho.
// =============================================================================

/**
 * Qual objeto de usuário deve continuar valendo.
 *
 * Devolve o ATUAL quando é a mesma pessoa, para que nada mais abaixo perceba
 * uma mudança que não houve. Devolve o NOVO quando a pessoa mudou — inclusive
 * ao sair, quando o novo é nulo e todas as telas precisam mesmo recarregar.
 */
export function usuarioQueContinua(atual, novo) {
  if (atual?.id && novo?.id && atual.id === novo.id) return atual
  return novo
}
