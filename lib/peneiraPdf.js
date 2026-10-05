// =============================================================================
// PENEIRA DO PDF — decide, de graça, se vale pagar para ler um documento.
//
// A leitura por IA é cobrada pelo tamanho do que se manda. Um PDF de inventário
// com quase um milhão de tokens custou R$ 15,31 para a leitura concluir, no
// fim, que não era nota fiscal. Medir o gasto depois não protege disso: a
// proteção tem que vir ANTES de pagar.
//
// Dois critérios, os dois lidos do próprio arquivo, sem IA nenhuma:
//
//   1. PÁGINAS — nota fiscal, guia, boleto e fatura são documentos curtos.
//      Relatório, contrato e inventário não são documento fiscal.
//
//   2. CNPJ DA EMPRESA — todo documento fiscal traz o CNPJ da empresa, como
//      emissor ou como destinatário. Se o documento tem texto e o CNPJ não
//      aparece nele, aquilo não é documento fiscal DELA.
//
// A regra do CNPJ só vale quando dá para ler texto no arquivo. Nota fotografada
// ou digitalizada não tem texto nenhum — e barrá-la seria perder uma nota de
// verdade para economizar centavos. Nesse caso o documento passa.
// =============================================================================

import zlib from 'node:zlib';

const soDigitos = s => String(s || '').replace(/\D/g, '');

/**
 * Texto que dá para extrair de um PDF: o que está solto no arquivo mais o que
 * está comprimido nos blocos internos (que é onde quase todo texto vive).
 */
export function textoDoPdf(buffer) {
  return extrairDoPdf(buffer).texto;
}

/**
 * O mesmo, com o relatório do que aconteceu.
 *
 * O relatório existe porque o fracasso aqui é SILENCIOSO: se nenhum bloco
 * descomprime, a função devolve o arquivo cru, que é texto para quem chama e
 * ruído binário na prática. Quem procura marcador não acha nada e conclui
 * "falta o marcador" — quando o que faltou foi a leitura. São consertos
 * opostos, e sem contar os blocos não dá para saber qual é qual.
 *
 * @returns {{texto, visivel, bytes, blocos, inflados, falhos}}
 */
export function extrairDoPdf(buffer) {
  let bruto;
  try {
    bruto = Buffer.isBuffer(buffer) ? buffer.toString('latin1') : String(buffer || '');
  } catch {
    return { texto: '', visivel: '', bytes: 0, blocos: 0, inflados: 0, falhos: 0 };
  }
  const vazio = { texto: '', visivel: '', bytes: bruto.length, blocos: 0, inflados: 0, falhos: 0 };
  if (!bruto.startsWith('%PDF')) return vazio;

  const partes = [bruto];
  let blocos = 0, inflados = 0, falhos = 0;
  // Cada bloco comprimido é descomprimido à parte. O limite existe para não
  // gastar tempo demais num arquivo gigante — e arquivo gigante já é barrado
  // pelo número de páginas de qualquer forma.
  const re = /stream\r?\n?([\s\S]*?)\r?\n?endstream/g;
  let m;
  while ((m = re.exec(bruto)) !== null && blocos < 500) {
    blocos++;
    const dados = Buffer.from(m[1], 'latin1');
    let aberto = null;
    try {
      aberto = zlib.inflateSync(dados);
    } catch {
      // Bloco cortado no fim (acontece quando o recorte erra por alguns bytes):
      // o modo estrito joga fora TUDO, inclusive o que já tinha aberto. Com
      // Z_SYNC_FLUSH ele entrega o que conseguiu — meia página de texto vale
      // mais que nenhuma. Bloco que não é deflate (imagem, fonte) continua
      // caindo fora, como antes.
      try { aberto = zlib.inflateSync(dados, { finishFlush: zlib.constants.Z_SYNC_FLUSH }); }
      catch { aberto = null; }
    }
    if (aberto) { partes.push(aberto.toString('latin1')); inflados++; } else { falhos++; }
  }
  const texto = partes.join('\n');
  // ── O QUE A PÁGINA MOSTRA ≠ O QUE ESTÁ NO ARQUIVO ────────────────────────
  //
  // O texto da página vive DENTRO dos blocos comprimidos. O arquivo cru em
  // volta deles é cabeçalho, dicionários e os próprios bytes comprimidos — e
  // num PDF de 14 mil bytes isso é a maior parte, vindo toda ANTES do conteúdo.
  //
  // Juntar os dois custou caro nos dois sentidos possíveis:
  //
  //   • falso positivo — "DARF" e "GNRE" casaram dentro do ruído binário, e
  //     dois contratos de aluguel viraram guia de imposto;
  //   • falso negativo — a amostra de diagnóstico, tirada do começo, mostrava
  //     só lixo e nomes de glifo da fonte ("five hyphen oacute one"),
  //     escondendo que o texto da página estava lá, mais adiante.
  //
  // Então 'visivel' passa a ser só o conteúdo dos blocos abertos. O arquivo
  // cru entra apenas quando NENHUM bloco abriu — aí ele é tudo que existe, e é
  // onde mora o texto dos PDFs que não comprimem nada (as notas da prefeitura
  // de Barueri são assim: 4 blocos, nenhum aberto, texto legível no arquivo).
  const conteudo = inflados > 0 ? partes.slice(1).join('\n') : bruto;
  return { texto, visivel: textoVisivel(conteudo), bytes: bruto.length, blocos, inflados, falhos };
}

/**
 * Só o texto que o PDF realmente ESCREVE na página (fica entre parênteses).
 *
 * A diferença entre isto e o arquivo inteiro não é cosmética: o arquivo inteiro
 * carrega os blocos binários, e numa massa de bytes comprimidos qualquer
 * sequência curta aparece por acaso. Dois contratos de aluguel foram
 * classificados como guia de imposto porque a sequência "DARF" e a sequência
 * "GNRE" estavam lá dentro, no ruído. Quem procura texto tem que procurar no
 * texto.
 */
export function textoVisivel(texto) {
  return (texto.match(/\(((?:[^()\\]|\\.)*)\)/g) || []).join(' ');
}

/** Quantas páginas tem? Pelo total declarado, ou contando os objetos de página. */
export function paginasDoPdf(texto) {
  const declarados = [...String(texto || '').matchAll(/\/Type\s*\/Pages\b[\s\S]{0,400}?\/Count\s+(\d+)/g)]
    .map(m => Number(m[1]))
    .filter(n => Number.isFinite(n) && n > 0);
  if (declarados.length) return Math.max(...declarados);
  const objetos = String(texto || '').match(/\/Type\s*\/Page[^s]/g);
  return objetos ? objetos.length : null;
}

/**
 * O CNPJ da empresa aparece no documento? Procura os dígitos corridos e a forma
 * com pontuação, e também no texto visível concatenado — porque o PDF às vezes
 * escreve o número em pedaços, com coordenadas no meio.
 */
export function contemCnpj(texto, cnpjEmpresa) {
  const cnpj = soDigitos(cnpjEmpresa);
  if (!texto || cnpj.length !== 14) return false;

  const formatado = `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`;
  if (texto.includes(cnpj) || texto.includes(formatado)) return true;

  // Juntar só o texto visível evita que número de posicionamento entre no meio
  // do CNPJ e o descaracterize.
  return soDigitos(textoVisivel(texto)).includes(cnpj);
}

/**
 * Tem texto de verdade, ou é um documento digitalizado (só imagem)?
 *
 * Conta PALAVRAS, não caracteres: pedaço de imagem comprimida também cai entre
 * parênteses e parece texto se a gente só medir tamanho. Palavra de quatro
 * letras seguidas é coisa de documento escrito.
 */
export function temTexto(texto, minimoPalavras = 40) {
  const palavras = textoVisivel(texto).match(/[A-Za-zÀ-ÿ]{4,}/g);
  return (palavras ? palavras.length : 0) >= minimoPalavras;
}

/**
 * Vale pagar para ler este documento?
 *
 * @param {Buffer|string} buffer  conteúdo do arquivo
 * @param {object} opcoes
 * @param {string} opcoes.cnpjEmpresa
 * @param {number} [opcoes.maximoPaginas]
 * @returns {{ler, motivo?, detalhe?, paginas?, texto}}
 *   `texto` é o conteúdo extraído do PDF. Vai no retorno de propósito: abrir
 *   os blocos comprimidos é a parte cara desta função, e quem chama precisa do
 *   mesmo texto para reconhecer o PAPEL do documento (ver lib/papelDocumento.js).
 *   Extrair duas vezes seria pagar duas vezes pelo mesmo trabalho.
 */
export function peneirarPdf(buffer, { cnpjEmpresa, maximoPaginas = 15, paginasLivres = 3 } = {}) {
  const texto = textoDoPdf(buffer);
  // Não é PDF (ou não deu para abrir): quem decide é o resto do fluxo.
  if (!texto) return { ler: true, texto: '', visivel: '' };

  const paginas = paginasDoPdf(texto);
  if (paginas && paginas > maximoPaginas) {
    return {
      ler: false,
      paginas,
      motivo: 'muitas_paginas',
      detalhe: `${paginas} páginas — documento fiscal não tem esse tamanho (o limite é ${maximoPaginas})`,
      texto,
      visivel: textoVisivel(texto),
    };
  }

  // Documento curto é barato de ler e é onde moram as notas — inclusive as
  // fotografadas e digitalizadas, que não têm texto nenhum onde procurar CNPJ.
  // Aqui a economia não compensa o risco de perder uma nota de verdade.
  if (paginas !== null && paginas <= paginasLivres) return { ler: true, paginas, texto, visivel: textoVisivel(texto) };

  // Sem texto legível é documento digitalizado: a regra do CNPJ não se aplica.
  if (!temTexto(texto)) return { ler: true, paginas, texto, visivel: textoVisivel(texto) };

  if (!contemCnpj(texto, cnpjEmpresa)) {
    return {
      ler: false,
      paginas,
      motivo: 'sem_cnpj_da_empresa',
      detalhe: 'o CNPJ da empresa não aparece no documento — documento fiscal sempre traz, como emissor ou como destinatário',
      texto,
      visivel: textoVisivel(texto),
    };
  }

  return { ler: true, paginas, texto, visivel: textoVisivel(texto) };
}

export default peneirarPdf;
