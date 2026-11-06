// =============================================================================
// A CONSULTA À RECEITA — e os três estados que ela pode devolver.
//
// O que isto conserta: o CNPJ que a IA lê de um PDF às vezes sai com um dígito
// trocado. Três deles viraram fornecedor, e fornecedor com CNPJ errado não casa
// com nada depois — nem com a nota do mês seguinte, nem com o extrato, nem com
// o cadastro que ela já tinha. A duplicidade entra por aí.
//
// A DISTINÇÃO QUE IMPORTA, e que a tela de cadastro já aprendeu a fazer:
//
//   confirmado     a Receita respondeu, e o CNPJ existe;
//   inexistente    a Receita respondeu, e o CNPJ NÃO existe — a leitura errou;
//   nao_respondeu  a consulta não aconteceu. O sistema NÃO SABE.
//
// Tratar "não sei" como "não existe" foi o que fez a tela acusar o número da
// usuária por meses, quando quem bloqueava a consulta era a política de
// segurança do próprio site. Aqui o silêncio nunca vira acusação.
// =============================================================================

const FONTE = 'https://brasilapi.com.br/api/cnpj/v1/';

// Cache da execução: o mesmo fornecedor costuma mandar vários documentos no
// mesmo lote, e a Receita não precisa ser consultada uma vez por anexo.
const memoria = new Map();

/**
 * @param {string} cnpjCru      como veio do documento
 * @param {object} [opcoes]
 * @param {Function} [opcoes.buscar]  substituto de fetch (usado nas provas)
 * @param {number} [opcoes.timeoutMs] o padrão são 8 segundos
 * @returns {Promise<{estado, cnpj, razao_social?, situacao?, detalhe?}>}
 */
export async function consultarCnpj(cnpjCru, { buscar, timeoutMs = 8000 } = {}) {
  const cnpj = String(cnpjCru || '').replace(/\D/g, '');
  // CNPJ brasileiro tem 14 dígitos. Menos que isso não é consulta que falhou:
  // é número que não chegou a ser CNPJ.
  if (cnpj.length !== 14) {
    return { estado: 'nao_respondeu', cnpj, detalhe: 'não tem 14 dígitos' };
  }
  if (memoria.has(cnpj)) return memoria.get(cnpj);

  const fetchar = buscar || globalThis.fetch;
  if (!fetchar) return { estado: 'nao_respondeu', cnpj, detalhe: 'sem fetch neste ambiente' };

  let resposta;
  try {
    const aborta = AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined;
    resposta = await fetchar(FONTE + cnpj, aborta ? { signal: aborta } : undefined);
  } catch (e) {
    // A consulta não saiu: rede, tempo esgotado, serviço fora. Isso não diz
    // nada sobre o CNPJ, e por isso NÃO é cacheado — a próxima tentativa pode
    // responder.
    return { estado: 'nao_respondeu', cnpj, detalhe: e?.message || 'a consulta não saiu' };
  }

  if (resposta.status === 404) {
    const veredito = { estado: 'inexistente', cnpj };
    memoria.set(cnpj, veredito);
    return veredito;
  }
  if (!resposta.ok) {
    // 429 e 5xx são do serviço, não do número.
    return { estado: 'nao_respondeu', cnpj, detalhe: `a Receita respondeu ${resposta.status}` };
  }

  let d;
  try { d = await resposta.json(); } catch {
    return { estado: 'nao_respondeu', cnpj, detalhe: 'resposta ilegível' };
  }
  const veredito = {
    estado: 'confirmado',
    cnpj,
    razao_social: d?.razao_social || '',
    nome_fantasia: d?.nome_fantasia || '',
    situacao: d?.descricao_situacao_cadastral || '',
  };
  memoria.set(cnpj, veredito);
  return veredito;
}

/** Usado pelas provas, para cada caso começar limpo. */
export function limparMemoriaDaReceita() { memoria.clear(); }

export default consultarCnpj;
