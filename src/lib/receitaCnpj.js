// =============================================================================
// A CONSULTA DE CNPJ NA RECEITA, PARA AS TELAS.
//
// Existia uma só, escrita dentro do cadastro de pessoa. A tela de Dados da
// empresa pedia o CNPJ e não oferecia a busca — a mesma informação, digitada
// à mão num lugar e buscada no outro. Quem percebeu foi ela, na primeira vez
// que abriu a tela: "pq na tela de cadastro da empresa não tem o botão de
// buscar na receita???".
//
// ── OS TRÊS ESTADOS, E POR QUE ELES IMPORTAM ───────────────────────────────
//
//   confirmado     a Receita respondeu e o CNPJ existe;
//   inexistente    a Receita respondeu e o CNPJ NÃO existe;
//   nao_respondeu  a consulta não aconteceu — e o sistema NÃO SABE.
//
// Confundir os dois últimos foi o que fez a tela acusar o número da usuária
// durante meses, quando quem bloqueava a consulta era a política de segurança
// do próprio site. Silêncio não é acusação.
// =============================================================================

const FONTE = 'https://brasilapi.com.br/api/cnpj/v1/'

/**
 * @param {string} cnpjCru  como foi digitado
 * @returns {Promise<{estado, cnpj, detalhe?, dados?}>}
 */
export async function consultarCnpjNaReceita(cnpjCru) {
  const cnpj = String(cnpjCru || '').replace(/\D/g, '')
  if (cnpj.length !== 14) {
    return { estado: 'nao_respondeu', cnpj, detalhe: 'O CNPJ precisa de 14 dígitos.' }
  }

  let resposta
  try {
    resposta = await fetch(FONTE + cnpj)
  } catch {
    // A consulta não saiu: rede, serviço fora, bloqueio de segurança. Isso não
    // diz nada sobre o número, e tratar como "não existe" acusaria quem digitou.
    return { estado: 'nao_respondeu', cnpj, detalhe: 'A consulta à Receita não saiu. Tente de novo em instantes.' }
  }

  if (resposta.status === 404) {
    return { estado: 'inexistente', cnpj, detalhe: 'A Receita não reconhece este CNPJ.' }
  }
  if (!resposta.ok) {
    return { estado: 'nao_respondeu', cnpj, detalhe: `A Receita respondeu ${resposta.status}. Tente mais tarde.` }
  }

  let d
  try { d = await resposta.json() } catch {
    return { estado: 'nao_respondeu', cnpj, detalhe: 'A resposta da Receita veio ilegível.' }
  }

  return { estado: 'confirmado', cnpj, dados: camposDaReceita(d) }
}

/** O que a Receita devolve, nos nomes que as telas usam. */
export function camposDaReceita(d) {
  const telefone = String(d?.ddd_telefone_1 || '').replace(/\D/g, '')
  return {
    razao_social: d?.razao_social || '',
    nome_fantasia: d?.nome_fantasia || '',
    situacao: d?.descricao_situacao_cadastral || '',
    ativa: String(d?.descricao_situacao_cadastral || '').toLowerCase().includes('ativa'),
    logradouro: `${d?.logradouro || ''} ${d?.numero || ''}`.trim(),
    bairro: d?.bairro || '',
    cidade: d?.municipio || '',
    uf: d?.uf || '',
    cep: d?.cep ? String(d.cep).replace(/^(\d{5})(\d{3})$/, '$1-$2') : '',
    telefone: telefone.length > 2 ? `(${telefone.slice(0, 2)}) ${telefone.slice(2)}` : '',
    segmento: String(d?.cnae_fiscal_descricao || '').substring(0, 60),
    // O código da atividade principal, e não só a descrição: é ele que a
    // ficha fiscal da empresa guarda, e que vai na nota.
    cnae: String(d?.cnae_fiscal || '').replace(/\D/g, ''),
    porte: porteDe(d?.porte),
  }
}

/** O porte como o cadastro o nomeia. */
export function porteDe(bruto) {
  const p = String(bruto || '').toUpperCase()
  if (p.includes('MEI')) return 'MEI'
  if (p.includes('MICRO')) return 'ME'
  if (p.includes('PEQUENO') || p.includes('EPP')) return 'EPP'
  if (p.includes('GRANDE')) return 'Grande'
  if (p.includes('M')) return 'Médio'
  return ''
}
