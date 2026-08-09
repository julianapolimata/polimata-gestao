// =============================================================================
// Modelos de texto da NFS-e — variáveis programáveis na discriminação do serviço.
// A discriminação é escrita com marcadores tipo {cliente}; na emissão (Bloco 2)
// eles são trocados pelos valores reais do lançamento/contrato via preencherModelo.
// =============================================================================

/** Variáveis disponíveis nos modelos. `chave` sem chaves; exibimos {chave}. */
export const VARIAVEIS_NFSE = [
  { chave: 'cliente', descricao: 'Nome do cliente (tomador)' },
  { chave: 'cnpj_cliente', descricao: 'CNPJ/CPF do tomador' },
  { chave: 'contrato', descricao: 'Código/nome do contrato' },
  { chave: 'competencia', descricao: 'Competência — mês/ano (ex: 08/2026)' },
  { chave: 'periodo', descricao: 'Período do serviço (ex: 01/08 a 31/08/2026)' },
  { chave: 'mes', descricao: 'Mês por extenso (ex: agosto)' },
  { chave: 'ano', descricao: 'Ano (ex: 2026)' },
  { chave: 'valor', descricao: 'Valor do serviço (ex: R$ 1.500,00)' },
]

/**
 * Substitui as variáveis {chave} do texto pelos valores em `dados`.
 * Chaves ausentes viram string vazia. Não mexe em texto sem marcadores.
 */
export function preencherModelo(texto, dados = {}) {
  if (!texto) return ''
  let out = String(texto)
  for (const { chave } of VARIAVEIS_NFSE) {
    out = out.split(`{${chave}}`).join(dados[chave] != null ? String(dados[chave]) : '')
  }
  return out
}

/** Valores de exemplo para a pré-visualização no editor. */
export const EXEMPLO_MODELO = {
  cliente: 'Cliente Exemplo Ltda',
  cnpj_cliente: '12.345.678/0001-90',
  contrato: 'CTR-2026-001',
  competencia: '08/2026',
  periodo: '01/08/2026 a 31/08/2026',
  mes: 'agosto',
  ano: '2026',
  valor: 'R$ 1.500,00',
}
