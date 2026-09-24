// =============================================================================
// LEITOR DE XML FISCAL — lê a nota direto do arquivo, sem inteligência artificial.
//
// Por que existe: NF-e e NFS-e em XML já trazem cada dado num campo com nome
// próprio (<Numero>, <DataEmissao>, <ValorServicos>, <Cnpj>...). Mandar isso
// para a IA é pagar para ela adivinhar o que já está escrito — e aceitar que
// ela erre. Aqui os campos são lidos direto: custo zero e sem interpretação.
//
// Devolve EXATAMENTE o mesmo formato da leitura por IA, para o resto do
// sistema não mudar em nada — ou `null` quando não dá para ler com segurança.
// "Não dá" inclui faltar campo essencial (número, data, valor) e a nota não
// ser da empresa. Nesses casos quem lê é a IA, como antes.
//
// Layouts cobertos:
//   • NFS-e padrão ABRASF e suas variantes municipais (a maioria das cidades)
//   • NFS-e do Padrão Nacional (para quando a emissão migrar para ele)
//   • NF-e modelo 55 (mercadoria)
// =============================================================================

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

const soDigitos = s => String(s || '').replace(/\D/g, '');

function limpar(txt) {
  return String(txt || '')
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => ENTIDADES[e] || _)
    .replace(/&#(\d+);/g, (_, n) => {
      const c = Number(n);
      return c > 0 && c < 0x10000 ? String.fromCharCode(c) : '';
    })
    .trim();
}

// Conteúdo da PRIMEIRA tag com esse nome. Aceita prefixo de namespace
// (<ns2:Numero>) e atributos (<InfNfse Id="x">). O nome tem que bater inteiro:
// procurar "Numero" não pega <NumeroLote> nem <IdentificacaoTomador>.
function tag(xml, nome) {
  const re = new RegExp(`<(?:[\\w.-]+:)?${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${nome}\\s*>`, 'i');
  const m = String(xml || '').match(re);
  return m ? limpar(m[1]) : '';
}

// Primeiro valor não vazio entre vários nomes possíveis (cada município usa o seu).
const primeiraTag = (xml, nomes) => {
  for (const n of nomes) { const v = tag(xml, n); if (v) return v; }
  return '';
};

// "1.234,56", "1234.56" e "R$ 9.500,00" viram número. Devolve 0 se não for.
function valorNum(txt) {
  // Fora símbolo de moeda e espaço: o SIGISS grava o valor já formatado.
  let s = String(txt || '').replace(/[^\d,.-]/g, '').trim();
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

const primeiroValor = (xml, nomes) => {
  for (const n of nomes) { const v = valorNum(tag(xml, n)); if (v > 0) return v; }
  return 0;
};

// "2026-08-25T07:13:18" ou "25/08/2026" → "2026-08-25". Vazio se não for data.
function dataISO(txt) {
  const s = String(txt || '').trim();
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return '';
}

// CNPJ/CPF de dentro de um bloco de identificação (o número pode estar em
// <Cnpj>, <CNPJ> ou <CpfCnpj><Cnpj>).
const docDe = bloco => soDigitos(primeiraTag(bloco, ['Cnpj', 'CNPJ', 'Cpf', 'CPF']));

// A discriminação costuma ser um textão com cláusulas legais. Interessa a
// primeira linha, que é o que a pessoa lê para reconhecer o documento.
function resumo(txt, limite = 200) {
  const t = limpar(txt).replace(/\\s|\\n|\\r/g, '\n').replace(/\r/g, '\n');
  // Quebra em linha nova ou em fim de frase com espaço duplo — é como as
  // prefeituras separam o que foi prestado das cláusulas legais que vêm depois.
  const primeira = t.split(/\n|(?<=\.)\s{2,}/).map(l => l.trim()).find(l => l.length > 3) || t.trim();
  return primeira.length > limite ? primeira.slice(0, limite - 1).trim() + '…' : primeira;
}

// Vencimento não é campo do padrão ABRASF: quando existe, vem escrito na
// discriminação ("Vencimentos: Parc:1-20/08/2026"). Só vale data igual ou
// posterior à emissão — senão é data de outra coisa.
function vencimentoNoTexto(txt, emissao) {
  const t = limpar(txt).replace(/\\s|\\n/g, ' ');
  const candidatos = [
    /parc\w*\s*[:\s]\s*\d+\s*[-–]\s*(\d{2}\/\d{2}\/\d{4})/i,
    /venc\w*[^\d]{0,40}(\d{2}\/\d{2}\/\d{4})/i,
  ];
  for (const re of candidatos) {
    const m = t.match(re);
    const d = m && dataISO(m[1]);
    if (d && (!emissao || d >= emissao)) return d;
  }
  return null;
}

// ─── Layouts ────────────────────────────────────────────────────────────────

// NFS-e ABRASF (e variantes). O cabeçalho da nota (número, data, valores) vem
// antes do bloco da declaração — que repete <Numero> e <DataEmissao>, só que
// do RPS. Por isso o cabeçalho é recortado antes de procurar qualquer coisa.
function lerAbrasf(xml) {
  const raiz = primeiraTag(xml, ['InfNfse', 'InfNfeServPrestado', 'InfNfe']) || xml;
  const corte = raiz.search(/<(?:[\w.-]+:)?Declaracao[\w]*[\s>]/i);
  const cab = corte > 0 ? raiz.slice(0, corte) : raiz;

  const prestador = primeiraTag(xml, ['PrestadorServico', 'Prestador']);
  const tomador = primeiraTag(xml, ['TomadorServico', 'Tomador']);
  const discriminacao = primeiraTag(xml, ['Discriminacao', 'DescricaoServico']);
  const emissao = dataISO(primeiraTag(cab, ['DataEmissao', 'DataEmissaoNfe', 'Competencia']));

  return {
    tipo_documento: 'NFS-e',
    numero_nf: primeiraTag(cab, ['Numero', 'NumeroNfe', 'NumeroNota']),
    data_emissao: emissao,
    // Valor dos serviços é o valor da nota. O líquido só entra se o bruto não
    // vier — nunca o contrário, senão uma retenção viraria desconto no valor.
    valor_total: primeiroValor(xml, ['ValorServicos', 'ValorLiquidoNfse', 'ValorLiquidoNfe', 'BaseCalculo']),
    emitente_cnpj: docDe(prestador),
    emitente_nome: primeiraTag(prestador, ['RazaoSocial', 'NomeFantasia']),
    destinatario_cnpj: docDe(tomador),
    destinatario_nome: primeiraTag(tomador, ['RazaoSocial', 'NomeFantasia']),
    descricao: resumo(discriminacao) || 'Nota fiscal de serviço',
    data_vencimento: vencimentoNoTexto(discriminacao, emissao),
  };
}

// NFS-e do SIGISS — o emissor da prefeitura de Valinhos e de várias outras.
// Layout próprio: tudo em português, sem namespace, e com os valores já
// formatados em reais ("R$ 9.500,00") e a data em dd/mm/aaaa.
function lerSigiss(xml) {
  const nf = primeiraTag(xml, ['notafiscal']) || xml;
  const descricao = tag(nf, 'descricao');
  const emissao = dataISO(tag(nf, 'data_emissao'));

  return {
    tipo_documento: 'NFS-e',
    numero_nf: tag(nf, 'numero_nf'),
    data_emissao: emissao,
    valor_total: primeiroValor(nf, ['valor_servico', 'valor_nf']),
    emitente_cnpj: soDigitos(tag(nf, 'cnpj_cpf_prestador')),
    // O SIGISS costuma deixar a razão social do prestador em branco (quem
    // emitiu é o dono do portal). Sem nome aqui, quem nomeia o lançamento é o
    // destinatário — que é o certo numa nota de receita.
    emitente_nome: tag(nf, 'razao_social_prestador'),
    destinatario_cnpj: soDigitos(tag(nf, 'cnpj_cpf_destinatario')),
    destinatario_nome: tag(nf, 'razao_social_destinatario'),
    descricao: resumo(descricao) || tag(nf, 'descricao_classificacao_servico') || 'Nota fiscal de serviço',
    data_vencimento: vencimentoNoTexto(descricao, emissao),
  };
}

// NFS-e do Padrão Nacional (emissor nacional). Estrutura enxuta, com nomes
// curtos no estilo da NF-e.
function lerNfseNacional(xml) {
  const raiz = primeiraTag(xml, ['infNFSe']) || xml;
  const emit = primeiraTag(raiz, ['emit']) || primeiraTag(xml, ['emit']);
  const toma = primeiraTag(raiz, ['toma']) || primeiraTag(xml, ['toma']);
  const emissao = dataISO(primeiraTag(raiz, ['dhProc', 'dhEmi', 'dCompet']));
  const servico = primeiraTag(xml, ['xDescServ', 'xTribNac', 'xServ']);

  return {
    tipo_documento: 'NFS-e',
    numero_nf: primeiraTag(raiz, ['nNFSe', 'nDPS']),
    data_emissao: emissao,
    valor_total: primeiroValor(xml, ['vServPrest', 'vServ', 'vLiq', 'vNF']),
    emitente_cnpj: docDe(emit),
    emitente_nome: primeiraTag(emit, ['xNome', 'xFant']),
    destinatario_cnpj: docDe(toma),
    destinatario_nome: primeiraTag(toma, ['xNome', 'xFant']),
    descricao: resumo(servico) || 'Nota fiscal de serviço',
    data_vencimento: null,
  };
}

// NF-e modelo 55 (mercadoria).
function lerNfe(xml) {
  const raiz = primeiraTag(xml, ['infNFe']) || xml;
  const ide = primeiraTag(raiz, ['ide']);
  const emit = primeiraTag(raiz, ['emit']);
  const dest = primeiraTag(raiz, ['dest']);
  const totais = primeiraTag(raiz, ['ICMSTot']);
  const cobranca = primeiraTag(raiz, ['cobr']);

  return {
    tipo_documento: 'NF-e',
    numero_nf: primeiraTag(ide, ['nNF']),
    data_emissao: dataISO(primeiraTag(ide, ['dhEmi', 'dEmi'])),
    valor_total: primeiroValor(totais, ['vNF']) || primeiroValor(raiz, ['vNF']),
    emitente_cnpj: docDe(emit),
    emitente_nome: primeiraTag(emit, ['xNome', 'xFant']),
    destinatario_cnpj: docDe(dest),
    destinatario_nome: primeiraTag(dest, ['xNome', 'xFant']),
    descricao: resumo(primeiraTag(raiz, ['xProd'])) || 'Nota fiscal',
    data_vencimento: dataISO(primeiraTag(cobranca, ['dVenc'])) || null,
  };
}

// ─── Entrada pública ────────────────────────────────────────────────────────

/**
 * Lê um XML fiscal sem IA.
 *
 * @param {string} xml            conteúdo do arquivo
 * @param {object} opcoes
 * @param {string} opcoes.cnpjEmpresa  CNPJ da empresa dona do sistema
 * @returns {object|null} mesmo formato da leitura por IA, ou null quando o XML
 *   não entrega tudo com segurança (aí quem lê é a IA, como antes).
 */
export function lerXmlFiscal(xml, { cnpjEmpresa } = {}) {
  const texto = String(xml || '');
  if (!texto.includes('<')) return null;

  // O layout é reconhecido por uma tag que só existe nele. Não dá para usar
  // <infNFSe> do padrão nacional como pista: ignorando maiúsculas ele é igual
  // ao <InfNfse> do ABRASF, e um leitor cairia em cima do outro.
  // Um arquivo com VÁRIAS notas seria lido pela metade: só a primeira entraria
  // e as outras sumiriam sem ninguém saber. Melhor não ler.
  if ((texto.match(/<(?:[\w.-]+:)?notafiscal[\s>]/gi) || []).length > 1) return null;

  let bruto;
  try {
    if (/<(?:[\w.-]+:)?nNFSe[\s>]/i.test(texto)) bruto = lerNfseNacional(texto);
    else if (/<(?:[\w.-]+:)?nNF[\s>]/i.test(texto)) bruto = lerNfe(texto);
    else if (/<(?:[\w.-]+:)?notafiscal[\s>]/i.test(texto)) bruto = lerSigiss(texto);
    else if (/<(?:[\w.-]+:)?(?:PrestadorServico|InfNfse|InfNfeServPrestado)[\s>]/i.test(texto)) bruto = lerAbrasf(texto);
    else return null;
  } catch {
    return null;
  }

  // Campos sem os quais o lançamento não se sustenta. Faltou um: vai para a IA.
  if (!bruto.numero_nf || !bruto.data_emissao || !(bruto.valor_total > 0)) return null;

  // A direção (receita ou despesa) sai do CNPJ, não de palpite. Se a empresa
  // não aparece como emitente nem como destinatário, este XML não é dela —
  // pode ter vindo anexado por engano, e quem decide isso é a IA.
  const eu = soDigitos(cnpjEmpresa);
  if (!eu) return null;
  const ehSaida = bruto.emitente_cnpj === eu;
  const ehEntrada = bruto.destinatario_cnpj === eu;
  if (!ehSaida && !ehEntrada) return null;

  return {
    tipo: ehSaida ? 'saida' : 'entrada',
    tipo_documento: bruto.tipo_documento,
    numero_nf: bruto.numero_nf,
    emitente_nome: bruto.emitente_nome || '',
    emitente_cnpj: bruto.emitente_cnpj || '',
    destinatario_nome: bruto.destinatario_nome || '',
    destinatario_cnpj: bruto.destinatario_cnpj || '',
    descricao: bruto.descricao,
    valor_total: bruto.valor_total,
    moeda: 'BRL',
    valor_original: bruto.valor_total,
    data_emissao: bruto.data_emissao,
    data_vencimento: bruto.data_vencimento || null,
    // Campos de guia de imposto: XML de nota nunca é guia.
    periodo_apuracao: '',
    numero_documento: '',
    parte: (ehSaida ? bruto.destinatario_nome : bruto.emitente_nome) || 'Não identificado',
    categoria: 'Operacional',
  };
}

/**
 * A nota deste XML está cancelada?
 *
 * Existe separado da leitura porque a consequência é oposta: nota cancelada
 * não é documento ilegível que a IA resolve — é documento que NÃO pode virar
 * lançamento nenhum. Se o leitor apenas desistisse, a IA leria e criaria uma
 * conta a receber que não existe mais.
 *
 * @param {string} xml
 * @returns {boolean}
 */
export function notaCanceladaNoXml(xml) {
  const texto = String(xml || '');
  if (!texto.includes('<')) return false;

  // SIGISS e parecidos: um campo diz que sim.
  const marca = primeiraTag(texto, ['cancelada', 'Cancelada', 'situacao', 'Situacao'])
    .trim().toUpperCase();
  if (['S', 'SIM', '1', 'CANCELADA', 'CANCELADO'].includes(marca)) return true;

  // ABRASF e padrão nacional: existe um bloco de cancelamento, que vem vazio
  // (<CancelamentoNfse />) quando a nota está válida.
  const bloco = primeiraTag(texto, ['CancelamentoNfse', 'CancelamentoNFe', 'NfseCancelamento', 'infCanc']);
  return bloco.length > 10;
}

export default lerXmlFiscal;
