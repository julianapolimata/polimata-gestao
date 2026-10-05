// ===========================================================================
// PROVA: "o robô só paga para ler o que pode ser documento fiscal"
// (REGRAS.md, regra 9).
//
// Esta peneira nasceu de um prejuízo: um PDF de 379 páginas custou R$ 15,31
// numa leitura só, e 130 releituras repetidas comeram R$ 12,13 — um quarto do
// teto mensal. Mas errar para o outro lado é pior: economizar centavos e
// perder uma nota fiscal de verdade.
//
// Por isso a peneira é ASSIMÉTRICA de propósito: documento curto é sempre
// lido, mesmo sem texto nenhum, porque é onde moram as notas fotografadas.
//
// Os PDFs aqui são montados à mão, com a estrutura real (%PDF, /Type /Pages
// /Count, texto entre parênteses) — não são arquivos de mentira.
//
// Rodar: npm run provas
// ===========================================================================
import { peneirarPdf, paginasDoPdf, contemCnpj, temTexto, textoDoPdf } from '../lib/peneiraPdf.js'

const CNPJ = '12345678000190'

let falhas = 0
const ok = (nome, cond, extra = '') => {
  console.log((cond ? '  OK   ' : '  FALHA') + ' ' + nome + (cond ? '' : ' → ' + extra))
  if (!cond) falhas++
}

/** PDF mínimo, mas de estrutura verdadeira. */
function pdf({ paginas = 1, palavras = 0, cnpj = '', pedacos = false } = {}) {
  const texto = Array.from({ length: palavras }, (_, i) => `(Prestacao de servicos linha ${i}) Tj`).join('\n')
  const doc = cnpj
    ? (pedacos
        // O PDF às vezes escreve o número em pedaços, com coordenadas no meio.
        ? `(${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.) Tj 1 0 0 1 90 700 Tm (${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}) Tj (-${cnpj.slice(12)}) Tj`
        : `(CNPJ ${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}) Tj`)
    : ''
  return Buffer.from(
    `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n` +
    `2 0 obj\n<< /Type /Pages /Count ${paginas} /Kids [] >>\nendobj\n` +
    `3 0 obj\nBT\n${texto}\n${doc}\nET\nendobj\ntrailer\n%%EOF\n`,
    'latin1',
  )
}

// ── 1. O que não é PDF não é peneirado aqui ────────────────────────────────
{
  ok('arquivo que não é PDF passa adiante', peneirarPdf(Buffer.from('só um texto qualquer')).ler === true)
  ok('buffer vazio passa adiante', peneirarPdf(Buffer.from('')).ler === true)
  ok('texto de não-PDF não é extraído', textoDoPdf(Buffer.from('nao sou pdf')) === '')
}

// ── 2. Documento CURTO é sempre lido — mesmo sem texto nenhum ──────────────
// É onde moram as notas fotografadas. Perder uma para economizar centavos é
// mau negócio, e essa é a assimetria que a regra escolheu.
{
  for (const n of [1, 2, 3]) {
    const r = peneirarPdf(pdf({ paginas: n }), { cnpjEmpresa: CNPJ })
    ok(`${n} página(s), sem texto e sem CNPJ → lê assim mesmo`, r.ler === true, JSON.stringify(r))
  }
}

// ── 3. A partir da 4ª página, o CNPJ da empresa passa a ser exigido ────────
{
  const semCnpj = peneirarPdf(pdf({ paginas: 4, palavras: 60 }), { cnpjEmpresa: CNPJ })
  ok('4 páginas com texto e sem o CNPJ → NÃO lê', semCnpj.ler === false, JSON.stringify(semCnpj))
  ok('e diz por quê', semCnpj.motivo === 'sem_cnpj_da_empresa', semCnpj.motivo)

  const comCnpj = peneirarPdf(pdf({ paginas: 4, palavras: 60, cnpj: CNPJ }), { cnpjEmpresa: CNPJ })
  ok('4 páginas com texto e COM o CNPJ → lê', comCnpj.ler === true, JSON.stringify(comCnpj))
}

// ── 4. Digitalizado (sem texto legível) escapa da regra do CNPJ ────────────
// Não dá para procurar CNPJ onde não há texto — recusar aqui seria perder
// justamente a nota escaneada.
{
  const r = peneirarPdf(pdf({ paginas: 8 }), { cnpjEmpresa: CNPJ })
  ok('8 páginas sem texto legível → lê (é documento digitalizado)', r.ler === true, JSON.stringify(r))
}

// ── 5. O teto de páginas ───────────────────────────────────────────────────
// O caso que originou a peneira: 379 páginas, R$ 15,31 numa leitura.
{
  const gigante = peneirarPdf(pdf({ paginas: 379, palavras: 60, cnpj: CNPJ }), { cnpjEmpresa: CNPJ })
  ok('379 páginas → NÃO lê, nem com o CNPJ dentro', gigante.ler === false, JSON.stringify(gigante))
  ok('e o motivo é o tamanho', gigante.motivo === 'muitas_paginas', gigante.motivo)
  ok('o detalhe diz o número de páginas', /379/.test(gigante.detalhe || ''), gigante.detalhe)

  const noLimite = peneirarPdf(pdf({ paginas: 15, palavras: 60, cnpj: CNPJ }), { cnpjEmpresa: CNPJ })
  ok('exatamente 15 páginas ainda lê', noLimite.ler === true, JSON.stringify(noLimite))

  const passou = peneirarPdf(pdf({ paginas: 16, palavras: 60, cnpj: CNPJ }), { cnpjEmpresa: CNPJ })
  ok('16 páginas já não lê', passou.ler === false, JSON.stringify(passou))
}

// ── 6. Reconhecer o CNPJ nas formas em que ele aparece de verdade ──────────
{
  ok('CNPJ com pontuação é reconhecido',
    contemCnpj('Emitente CNPJ 12.345.678/0001-90 Ltda', CNPJ) === true)
  ok('CNPJ só com dígitos é reconhecido',
    contemCnpj('destinatario 12345678000190', CNPJ) === true)
  ok('CNPJ escrito em pedaços pelo PDF é reconhecido',
    contemCnpj(textoDoPdf(pdf({ paginas: 4, palavras: 60, cnpj: CNPJ, pedacos: true })), CNPJ) === true)
  ok('CNPJ de OUTRA empresa não é reconhecido',
    contemCnpj('CNPJ 99.999.999/0001-99', CNPJ) === false)
  ok('sem CNPJ configurado, não reconhece nada',
    contemCnpj('CNPJ 12.345.678/0001-90', '') === false)
}

// ── 7. Texto de verdade × imagem que parece texto ──────────────────────────
// Pedaço de imagem comprimida também cai entre parênteses. Por isso a conta é
// de PALAVRAS de 4+ letras, não de caracteres.
{
  ok('poucas palavras não contam como texto', temTexto('(abc) (de) (f)') === false)
  ok('muitas palavras de 4+ letras contam',
    temTexto(Array.from({ length: 50 }, () => '(prestacao)').join(' ')) === true)
  ok('lixo binário entre parênteses não vira texto',
    temTexto('(\x01\x02\x03) (\x7f\x80) (ab) (cd)') === false)
}

// ── 8. Contagem de páginas ─────────────────────────────────────────────────
{
  ok('lê o /Count declarado', paginasDoPdf('<< /Type /Pages /Count 7 /Kids [] >>') === 7)
  ok('sem /Count, conta os objetos de página',
    paginasDoPdf('/Type /Page x /Type /Page y /Type /Page z') === 3)
  ok('sem marcação nenhuma, devolve null', paginasDoPdf('documento sem estrutura') === null)
  ok('com vários /Count, fica com o maior (o documento inteiro)',
    paginasDoPdf('<< /Type /Pages /Count 2 >> ... << /Type /Pages /Count 9 >>') === 9)
}

// ── 9. Sem o CNPJ da empresa configurado ───────────────────────────────────
// Documentado aqui porque é uma escolha com consequência: sem CNPJ na
// configuração, todo documento longo COM texto é recusado. Curto continua
// passando, então nota fotografada não se perde.
{
  const longo = peneirarPdf(pdf({ paginas: 6, palavras: 60, cnpj: CNPJ }), { cnpjEmpresa: '' })
  ok('sem CNPJ configurado, documento longo é recusado', longo.ler === false, JSON.stringify(longo))
  const curto = peneirarPdf(pdf({ paginas: 2, palavras: 60, cnpj: CNPJ }), { cnpjEmpresa: '' })
  ok('mas documento curto continua sendo lido', curto.ler === true, JSON.stringify(curto))
}


// ── O relatório da leitura: qual das duas falhas aconteceu? ───────────────
//
// Quando nenhum marcador é encontrado num documento há duas explicações, com
// consertos OPOSTOS, e sem números não dá para saber qual é:
//
//   blocos > 0 e inflados = 0   → a descompactação falhou. O "texto" lido é o
//                                 arquivo binário cru, e procurar palavra ali
//                                 é procurar no escuro. Conserta-se o extrator.
//   inflados > 0 e nada casou   → leu bem; falta o MARCADOR na lista.
//
// Isto não é hipótese: a primeira lista de marcadores acertou 7 de 43 PDFs
// reais, e eu não sabia dizer qual das duas coisas tinha acontecido. Por isso
// o extrator passou a contar.
import zlib from 'node:zlib'
import { extrairDoPdf } from '../lib/peneiraPdf.js'

const pdfComBloco = conteudo => {
  const z = zlib.deflateSync(Buffer.from(conteudo, 'latin1'))
  return Buffer.concat([
    Buffer.from('%PDF-1.7\n1 0 obj\n<</Filter/FlateDecode>>stream\n', 'latin1'),
    z,
    Buffer.from('\nendstream\nendobj\n', 'latin1'),
  ])
}

const bom = extrairDoPdf(pdfComBloco('BT (GUIA DA PREVIDENCIA SOCIAL) Tj ET'))
ok('bloco que abre é contado como aberto', bom.blocos === 1 && bom.inflados === 1,
  JSON.stringify({ b: bom.blocos, i: bom.inflados }))
ok('e o texto da página aparece no visível',
  bom.visivel.includes('GUIA DA PREVIDENCIA SOCIAL'), bom.visivel.slice(0, 80))

const ruim = Buffer.concat([
  Buffer.from('%PDF-1.7\n1 0 obj\n<</Filter/FlateDecode>>stream\n', 'latin1'),
  Buffer.from([0x78, 0x9c, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]),
  Buffer.from('\nendstream\nendobj\n', 'latin1'),
])
const falho = extrairDoPdf(ruim)
ok('bloco que não abre é contado como falho',
  falho.blocos === 1 && falho.inflados === 0 && falho.falhos === 1,
  JSON.stringify({ b: falho.blocos, i: falho.inflados, f: falho.falhos }))

// ── Bloco cortado no fim: o estrito joga fora TUDO ───────────────────────
//
// zlib no modo estrito entende "faltou o fim" como "não li nada" e descarta até
// o que já tinha aberto. Meia página de texto vale mais que nenhuma — e um
// recorte que erra por poucos bytes é comum num PDF.
const inteiro = pdfComBloco('BT (DOCUMENTO DE ARRECADACAO) Tj ET')
const cortado = Buffer.concat([
  inteiro.slice(0, inteiro.length - 22),           // tira o fim do bloco
  Buffer.from('\nendstream\nendobj\n', 'latin1'),
])
const recuperado = extrairDoPdf(cortado)
ok('bloco cortado no fim ainda entrega o que deu para abrir',
  recuperado.inflados === 1, JSON.stringify({ i: recuperado.inflados, f: recuperado.falhos }))

ok('o que não é PDF devolve relatório zerado, não exceção',
  extrairDoPdf(Buffer.from('isto nao e um pdf')).blocos === 0)


// ── O visível é a PÁGINA, não o arquivo ──────────────────────────────────
//
// Os dois erros que custaram esta rodada vieram de misturar as duas coisas:
// "DARF" casou dentro do ruído binário do arquivo (dois contratos de aluguel
// viraram guia de imposto), e a amostra de diagnóstico, tirada do começo, só
// mostrava lixo — escondendo que o texto da página estava lá, mais adiante.
const comRuido = Buffer.concat([
  Buffer.from('%PDF-1.7\n% DARF GNRE ruido solto no arquivo\n1 0 obj\n<</Filter/FlateDecode>>stream\n', 'latin1'),
  zlib.deflateSync(Buffer.from('BT (RECIBO DE ENTREGA) Tj ET', 'latin1')),
  Buffer.from('\nendstream\nendobj\n', 'latin1'),
])
const r = extrairDoPdf(comRuido)
ok('o visível traz o texto da página', r.visivel.includes('RECIBO DE ENTREGA'), r.visivel)
ok('e NÃO traz o que está solto no arquivo',
  !r.visivel.includes('DARF') && !r.visivel.includes('GNRE'), r.visivel)
ok('o texto completo continua tendo tudo (a peneira usa ele p/ CNPJ e páginas)',
  r.texto.includes('DARF') && r.texto.includes('RECIBO DE ENTREGA'))

// Quando NADA abre, o arquivo cru é tudo que existe — e é lá que mora o texto
// dos PDFs que não comprimem nada (as notas da prefeitura de Barueri são
// assim: 4 blocos, nenhum aberto, e o texto legível no arquivo).
const semCompressao = Buffer.from(
  '%PDF-1.7\n1 0 obj\n<<>>stream\nBT (NOTA FISCAL ELETRONICA DE SERVICOS) Tj ET\nendstream\nendobj\n', 'latin1')
const r2 = extrairDoPdf(semCompressao)
ok('PDF sem compressão nenhuma ainda entrega o texto',
  r2.inflados === 0 && r2.visivel.includes('NOTA FISCAL ELETRONICA DE SERVICOS'),
  JSON.stringify({ i: r2.inflados, v: r2.visivel.slice(0, 60) }))

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTodos os casos passaram.')
process.exit(falhas ? 1 : 0)
