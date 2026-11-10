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

// ─────────────────────────────────────────────────────────────────────────────
// PAPEL É MÚLTIPLO.
//
// Uma pessoa pode ser cliente E fornecedora ao mesmo tempo — a Poli
// Instrumentos é o caso. O campo antigo `tipo` guardava UM texto, e por isso
// quem era os dois precisava de dois cadastros: a duplicidade entrando pela
// porta dos fundos.
//
// COMPATIBILIDADE, e ela não é opcional: `tipo` CONTINUA sendo gravado, como
// campo derivado. O webhook do Polímata CI decide por ele, e se o Gestão
// parasse de escrevê-lo cada cliente seria removido ou desativado de lá — com
// projetos e matrizes pendurados. A função `clientes-webhook` já foi para a
// v5, que entende os dois formatos; o campo derivado é o segundo cinto.
// ─────────────────────────────────────────────────────────────────────────────

export const PAPEIS = [
  { v: 'cliente', label: 'Cliente', antigo: 'Cliente' },
  { v: 'fornecedor', label: 'Fornecedor', antigo: 'Fornecedor' },
  { v: 'orgao_publico', label: 'Órgão Público', antigo: 'Órgão Público' },
  { v: 'funcionario', label: 'Funcionário', antigo: 'Funcionário' },
  { v: 'socio', label: 'Sócio', antigo: 'Sócio' },
  // INSTITUIÇÃO FINANCEIRA — decisão dela, 10/11/2026.
  //
  // O banco não fornece nada: ele empresta. É contraparte de DÍVIDA, não de
  // despesa operacional — a mesma distinção que separa amortização de juros.
  //
  // E não é só o empréstimo: tarifa bancária, IOF e multa já estão em
  // "Despesas Financeiras" no plano de contas, nunca em despesa com
  // fornecedor. Tudo que vem do banco é da relação financeira, então ele não
  // precisa do papel de fornecedor ao lado.
  //
  // Não tem `antigo` porque não existia no cadastro anterior: nenhum registro
  // de antes de 10/11/2026 pode ser traduzido para este papel.
  { v: 'instituicao_financeira', label: 'Instituição Financeira', antigo: '' },
]

/** Os papéis de um cadastro. Lê o formato novo; na falta, traduz o antigo. */
export function papeisDe(d) {
  if (Array.isArray(d?.papeis) && d.papeis.length) {
    return d.papeis.map((x) => String(x).trim().toLowerCase())
  }
  const t = String(d?.tipo || '').trim().toLowerCase()
  const achou = PAPEIS.find((p) => p.antigo.toLowerCase() === t)
  return achou ? [achou.v] : []
}

export function temPapel(d, papel) {
  return papeisDe(d).includes(String(papel).trim().toLowerCase())
}

/**
 * O campo `tipo`, derivado, que o Polímata CI ainda lê.
 * Cliente tem precedência: é o único papel que atravessa a ponte.
 */
export function tipoDerivado(papeis) {
  const l = (papeis || []).map((x) => String(x).trim().toLowerCase())
  if (l.includes('cliente')) return 'Cliente'
  const primeiro = PAPEIS.find((p) => l.includes(p.v))
  return primeiro ? primeiro.antigo : ''
}

/** Rótulo antigo (ex.: 'Órgão Público') → valor de papel. 'Prospect' é status. */
export function papelDoRotuloAntigo(rotulo) {
  const t = String(rotulo || '').trim().toLowerCase()
  if (!t) return null
  if (t === 'prospect') return 'cliente'
  // O papel novo é aceito pelo próprio valor: quem filtra por
  // 'instituicao_financeira' não precisa conhecer um rótulo antigo que nunca
  // existiu. Sem isto, `pessoasDosTipos` descartaria o filtro em silêncio.
  const direto = PAPEIS.find((p) => p.v === t)
  if (direto) return direto.v
  const achou = PAPEIS.find((p) => p.antigo && p.antigo.toLowerCase() === t)
  return achou ? achou.v : null
}

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
  const aceitos = tipos ? tipos.map(papelDoRotuloAntigo).filter(Boolean) : null
  return (pessoas || [])
    .filter(p => p.data?.nome)
    .filter(p => !aceitos || aceitos.some(v => temPapel(p.data, v)))
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

/**
 * Quem é este fornecedor, pelo apelido que ele usa na fatura do cartão.
 *
 * ── POR QUE O APELIDO EXISTE ────────────────────────────────────────────────
 *
 * A fatura do cartão não traz CNPJ. Traz um texto, abreviado e diferente a
 * cada mês: "GOOGLE *CLOUD", "GOOGLE CLOUD BRASIL", "GOOGLE CLOU". Nome
 * parecido não serve de prova em lugar nenhum deste sistema, e aqui não seria
 * diferente — por isso o apelido é CADASTRADO por ela, uma vez, e depois vale
 * como identificação.
 *
 * O campo foi construído em 05/11/2026 e, até a auditoria de 10/11, ninguém o
 * lia: as compras do cartão continuavam nascendo com o descritivo cru no lugar
 * do fornecedor. Campo escrito e nunca lido é promessa que a tela faz e o
 * sistema não cumpre.
 *
 * A comparação é por conteúdo, não por igualdade: o descritivo da fatura
 * CONTÉM o apelido, cercado de código de operadora e cidade. Apelido de menos
 * de três letras é ignorado — casaria com qualquer coisa.
 */
export function pessoaPorApelido(pessoas, descricao) {
  const texto = chaveNome(descricao)
  if (!texto) return null
  for (const p of pessoas || []) {
    const apelidos = Array.isArray(p?.data?.apelidos) ? p.data.apelidos : []
    for (const a of apelidos) {
      const alvo = chaveNome(a)
      if (alvo.length < 3) continue
      if (texto.includes(alvo)) return p
    }
  }
  return null
}
