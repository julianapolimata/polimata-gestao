// =============================================================================
// O PAPEL DO DOCUMENTO — reconhecido pelo que ele DIZ, não adivinhado.
//
// O sistema tinha um eixo só: "é nota fiscal?". Faltava o outro: o que este
// documento É. Sem ele, tudo vira candidato a lançamento — e o mesmo valor
// entra três vezes:
//
//   R$ 932,31 chegou como a GPS (o que se paga), como o Relatório Totalizador
//   do eSocial (o cálculo que a originou) e como o Recibo da DCTFWeb (a prova
//   de que foi declarada). Três documentos, um único desembolso.
//
// Por que NÃO pedir isso à IA: ela já erra. O mesmo arquivo foi classificado
// de formas diferentes a cada leitura — `Recibo_1201_*.pdf` já voltou como
// DARF, como Folha e como "Outro". Até o acento mudava o resultado:
// "Relatorio eSocial" deu Outro, "Relatório eSocial" deu GPS.
//
// E por que não pelo NOME do arquivo: o padrão "1201_" é do software do
// contador da Polímata. Outro cliente, outro contador, outro nome. O nome
// serve de reforço, nunca de prova.
//
// O que é igual em todo mundo é o TEXTO OFICIAL dentro do documento — S-5011,
// "Recibo de Entrega", DCTFWeb, "Documento de Arrecadação". Esses termos vêm
// do leiaute do governo, não de quem imprimiu o PDF.
//
// Custo zero: o texto já é extraído pela peneira, antes de a IA ser chamada.
// =============================================================================

export const PAPEIS = {
  obrigacao: 'Obrigação a pagar',
  documento_fiscal: 'Documento fiscal',
  pagamento_pf: 'Pagamento a pessoa física',
  comprovante: 'Comprovante de entrega',
  base_de_calculo: 'Base de cálculo',
  declaracao: 'Declaração',
  contrato: 'Contrato ou proposta',
};

/** Papéis que NÃO viram lançamento: são prova ou memória de cálculo. */
export const PAPEIS_SEM_LANCAMENTO = ['comprovante', 'base_de_calculo', 'declaracao', 'contrato'];

/** Um evento econômico, um lançamento. */
export const viraLancamento = papel => !!papel && !PAPEIS_SEM_LANCAMENTO.includes(papel);

/** Maiúsculas, sem acento, espaços colapsados — "Relatório" = "RELATORIO". */
const normal = s => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toUpperCase().replace(/\s+/g, ' ').trim();

/**
 * O marcador aparece como PALAVRA INTEIRA no texto?
 *
 * `includes` não serve. "DARF" tem quatro letras: ele casa dentro de "ADARFOO"
 * — e casou dentro do ruído binário de dois contratos de aluguel, que viraram
 * "guia de imposto" por causa disso. O marcador tem que estar cercado por
 * separador dos dois lados, que é exatamente como ele aparece num documento de
 * verdade.
 */
function temMarcador(texto, compacto, marcador) {
  // Marcador longo é procurado no texto COMPACTADO (sem espaço nem pontuação).
  //
  // Não é truque: é que o PDF não guarda frases, guarda instruções de desenho.
  // O mesmo "Prestação" sai como "(Pre)(stação)" para ajustar o espaçamento, e
  // os documentos do contador saem letra por letra — "(R)(E)(C)(I)(B)(O)".
  // Medido: o aditivo da Brascabos lê "Brasc abos Compon entes", e os PDFs do
  // escritório não entregam uma palavra inteira sequer. Procurar a frase com os
  // espaços no lugar é procurar algo que o arquivo nunca escreveu.
  //
  // Compactar só vale para marcador longo. Uma sequência de 8+ letras seguidas
  // não aparece por acaso — e agora que a busca vê só o texto da página, e não
  // mais o binário do arquivo, não há onde ela aparecer por acaso.
  const cru = marcador.replace(/[^A-Z0-9]/g, '');
  if (cru.length >= 8) return compacto.includes(cru);
  // Marcador curto continua exigindo fronteira de palavra: "DARF" casa dentro
  // de "ADARFOO", e foi assim que dois contratos de aluguel viraram guia.
  return new RegExp(`(?<![A-Z0-9])` + marcador + `(?![A-Z0-9])`).test(texto);
}

// ── As regras, EM ORDEM DE PRECEDÊNCIA ──────────────────────────────────────
//
// A ordem é a parte que importa, e tem um motivo concreto em cada degrau.
const REGRAS = [
  {
    papel: 'documento_fiscal',
    // ANTES de tudo, e é o degrau que protege contra o erro INVERSO. O canhoto
    // do DANFE diz "recibo de entrega do destinatário" — se o comprovante
    // viesse primeiro, uma nota fiscal de verdade seria arquivada como prova e
    // a despesa desapareceria de contas a pagar. Errar assim é pior que
    // contar em dobro: dobro se vê no extrato, falta não se vê em lugar nenhum.
    //
    // Estes marcadores são muito mais específicos que "recibo de entrega" —
    // nenhum recibo da DCTFWeb ou relatório do eSocial traz chave de acesso.
    marcadores: [
      'DANFE',
      'DOCUMENTO AUXILIAR DA NOTA FISCAL',
      'CHAVE DE ACESSO',
      // Lidos dos documentos de verdade, não supostos: a prefeitura de
      // Barueri escreve "NOTA FISCAL ELETRONICA DE SERVICOS" (minha lista
      // tinha as mesmas palavras em outra ordem) e o Padrão Nacional emite o
      // "DANFSe - Documento Auxiliar da NFS-e".
      'NOTA FISCAL ELETRONICA DE SERVICOS',
      'NOTA FISCAL DE SERVICOS ELETRONICA',
      'DANFSE',
      'NFS-E',
    ],
  },
  {
    papel: 'comprovante',
    // PRIMEIRO de todos, e é isto que conserta o erro da IA: o recibo de
    // entrega da DCTFWeb TRAZ DENTRO o valor do DARF. Quem olha o valor
    // conclui "é um DARF" — e aí a mesma dívida vira duas despesas. O recibo
    // prova que a declaração foi entregue; ele não é a dívida.
    marcadores: [
      'RECIBO DE ENTREGA',
      'COMPROVANTE DE ENTREGA',
      'RECIBO DA DECLARACAO',
      'NUMERO DO RECIBO',
    ],
    tipo_documento: 'Comprovante',
  },
  {
    papel: 'base_de_calculo',
    // Os totalizadores do eSocial e o espelho da folha. Também trazem valor
    // (a CPP), e também não são desembolso: são a conta que gerou a guia.
    // É daqui que sai a CPP do Fator R.
    marcadores: [
      'S-5011', 'S-5012', 'S5011', 'S5012',
      'RELATORIO TOTALIZADOR',
      'TOTALIZADOR DA EMPRESA',
      'ESPELHO DE PONTO',
      'ESPELHO DA FOLHA',
      'RESUMO DA FOLHA',
      'RELACAO DE LIQUIDO',
      'FOLHA DE PAGAMENTO - RESUMO',
    ],
    tipo_documento: 'Folha',
  },
  {
    papel: 'pagamento_pf',
    // Dinheiro que sai para pessoa física. Vira lançamento E conta no Fator R
    // (pelo valor BRUTO — ver REGRAS.md).
    marcadores: [
      'RECIBO DE PAGAMENTO DE SALARIO',
      'RECIBO DE PRO-LABORE', 'RECIBO DE PRO LABORE',
      'RECIBO MENSAL',
      'DEMONSTRATIVO DE PAGAMENTO',
      'CONTRACHEQUE', 'HOLERITE',
      'PRO-LABORE', 'PRO LABORE',
    ],
    tipo_documento: 'Pró-labore',
  },
  {
    papel: 'declaracao',
    // A declaração em si (sem ser o recibo dela — esse já saiu no 1º degrau).
    marcadores: ['PGDAS-D', 'PGDAS', 'DECLARACAO DE DEBITOS E CREDITOS'],
    tipo_documento: 'Declaração',
  },
  {
    papel: 'obrigacao',
    // O que se paga de verdade.
    marcadores: [
      'DOCUMENTO DE ARRECADACAO',
      'GUIA DA PREVIDENCIA SOCIAL',
      'GUIA DE RECOLHIMENTO',
      'SIMPLES NACIONAL - DAS',
      // O boleto brasileiro segue leiaute da FEBRABAN: estes dois campos estão
      // em todos eles, com estas palavras. Lidos do "NF 1029 - POLIMATA -
      // Boleto.pdf" dela, não supostos.
      'VALOR DO DOCUMENTO',
      'NOSSO NUMERO',
      'NOTA DE DEBITO',
      'DARF', 'GNRE',
    ],
  },
  {
    papel: 'contrato',
    // ÚLTIMO degrau, e por isso: contrato quase sempre fala de dinheiro, e
    // frequentemente traz um boleto junto. Se ele viesse antes, o boleto — que
    // é o que se paga — seria engolido pelo contrato que o originou.
    //
    // Por que existe: contrato, proposta e orçamento NÃO são conta a pagar.
    // São o acordo que um dia gera uma. Na caixa de entrada dela havia
    // R$ 90 mil assim — "P010_Aditivo Brascabos_2026.pdf" (R$ 80.010, uma
    // proposta de aditivo), um orçamento de plano de saúde, dois contratos de
    // locação e um termo de distrato — todos oferecendo "✓ Aprovar" como se
    // fossem despesas do mês.
    marcadores: [
      'TERMO DE DISTRATO',
      'PROPOSTA DE ADITIVO',
      'TERMO ADITIVO',
      'CONTRATO DE LOCACAO',
      'CONTRATO DE PRESTACAO DE SERVICOS',
      'NUMERO DO ORCAMENTO',
    ],
  },
];

/**
 * Reconhece o papel pelo texto do documento.
 *
 * @param {string} texto         texto extraído do PDF (ou o XML, ou o corpo)
 * @param {string} [nomeArquivo] reforço, nunca prova
 * @returns {{papel, rotulo, tipo_documento?, marcadores, reforco_nome}|null}
 *   null = não reconheceu; quem decide é a IA, como antes.
 */
export function reconhecerPapel(texto, nomeArquivo = '') {
  const t = normal(texto);
  if (!t) return null;
  // A mesma coisa sem espaço nem pontuação — ver temMarcador().
  const tc = t.replace(/[^A-Z0-9]/g, '');

  for (const regra of REGRAS) {
    const achados = regra.marcadores.filter(m => temMarcador(t, tc, m));
    if (!achados.length) continue;
    return {
      papel: regra.papel,
      rotulo: PAPEIS[regra.papel],
      tipo_documento: regra.tipo_documento,
      vira_lancamento: viraLancamento(regra.papel),
      // A evidência fica guardada: quem conferir depois vê POR QUE o sistema
      // decidiu assim, em vez de ter que confiar.
      marcadores: achados,
      reforco_nome: pistaDoNome(nomeArquivo, regra.papel),
    };
  }
  return null;
}

/**
 * O nome do arquivo concorda? Só reforço — some num contador diferente, então
 * nunca decide sozinho.
 */
function pistaDoNome(nomeArquivo, papel) {
  // "_", "-" e "." são só separadores em nome de arquivo:
  // "1201_Recibo_mensal_082026.pdf" e "Recibo mensal 08-2026.pdf" são o mesmo
  // nome escrito por dois programas diferentes.
  const n = normal(String(nomeArquivo || '').replace(/[_.-]+/g, ' '));
  if (!n) return null;
  const pistas = {
    comprovante: ['RECIBO'],
    base_de_calculo: ['RELATORIO ESOCIAL', 'ESPELHO', 'RESUMO'],
    pagamento_pf: ['RECIBO MENSAL', 'PRO LABORE', 'HOLERITE', 'CONTRACHEQUE'],
    obrigacao: ['GUIA', 'DAS', 'DARF', 'GPS'],
    declaracao: ['PGDAS'],
  }[papel] || [];
  return pistas.find(p => n.includes(p)) || null;
}

export default reconhecerPapel;
