// =============================================================================
// O VÍNCULO COM O CADASTRO — uma porta só.
//
// O defeito que isto fecha: o sistema guardava o NOME da pessoa como texto, em
// quatro tabelas (`payable`/`receivable`, `projects`, `contracts` e
// `emprestimos_financiamentos`). Quem lia depois tentava adivinhar de quem era
// aquele texto.
//
// A prova de que adivinhar por nome não funciona está no próprio banco:
// `projects.client` diz "PLANCUS … EIRELI" e `pessoas.nome` diz "PLANCUS …
// LTDA". A empresa trocou de natureza jurídica e o projeto ficou com o nome
// antigo — nenhuma comparação de texto encontraria as duas.
//
// A regra: o texto continua gravado (nada que lê hoje quebra), e ao lado dele
// vai `pessoa_id`. Quem lê passa a PREFERIR o identificador quando ele existe.
// =============================================================================

/**
 * Chave de comparação de nome: sem acento, sem caixa, sem espaço sobrando.
 * DELIBERADAMENTE não adivinha por semelhança — ou o nome é o mesmo, ou não é.
 * Foi adivinhação por semelhança que criou a duplicidade que estamos desfazendo.
 */
export function chaveNome(v) {
  return String(v || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim()
}

/** A pessoa cujo nome é exatamente este, entre as aceitas. Senão, null. */
export function acharPessoa(pessoas, nome) {
  const alvo = chaveNome(nome)
  if (!alvo) return null
  return (pessoas || []).find(p => chaveNome(p.data?.nome) === alvo) || null
}

/** As pessoas dos papéis aceitos, em ordem alfabética. `tipos` null = todas. */
export function pessoasDosTipos(pessoas, tipos) {
  return (pessoas || [])
    .filter(p => p.data?.nome)
    .filter(p => !tipos || tipos.includes(p.data?.tipo))
    .sort((a, b) => String(a.data.nome).localeCompare(String(b.data.nome), 'pt-BR'))
}

/**
 * O que a tela mostra para confirmar o vínculo.
 *
 * Decisão da Juliana, 05/11/2026: aqui vai o NOME, não o CNPJ — "o número do
 * CNPJ não diz nada". O campo acima já mostra a razão social, então o que
 * ajuda é o nome fantasia, que é como ela chama a empresa no dia a dia.
 * Sem fantasia, o código do cadastro basta.
 */
export function rotuloDoVinculo(pessoa) {
  if (!pessoa) return ''
  const cod = pessoa.codigo || ''
  const apelido = String(pessoa.data?.fantasia || '').trim()
  if (cod && apelido) return `Vinculado ao cadastro ${cod} · ${apelido}`
  if (apelido) return `Vinculado ao cadastro · ${apelido}`
  if (cod) return `Vinculado ao cadastro ${cod}`
  return 'Vinculado ao cadastro'
}

/** Estilos do aviso, iguais nas quatro telas. */
export const estiloVinculoOk = {
  marginTop: 5, fontSize: 11, color: 'var(--green)',
}
export const estiloVinculoFalta = {
  marginTop: 5, fontSize: 11, color: 'var(--text-mid)',
}
