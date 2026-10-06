// ===========================================================================
// PROVA: "relatório de trabalho não é conta a pagar".
//
// Dois documentos estavam parados na caixa de entrada valendo, somados,
// R$ 260.643.649:
//
//   ACR 06-2025.pdf  →  R$ 138.143.664
//   ACR 02-2025.pdf  →  R$ 122.499.985
//
// Nenhum dos dois é da Polímata. A própria leitura os descreveu como
// "Relatório gerencial de Contas a Receber (Trade account receivables) -
// Balance Sheet": são papéis de trabalho da consultoria, do CLIENTE. O que
// virou "valor" foi o total de uma tabela de recebíveis.
//
// Um terceiro do mesmo tipo, "Conta Azul - Contas a Receber.pdf" de
// R$ 296.339, a Juliana já havia rejeitado à mão. A regra abaixo chega à
// mesma conclusão que ela — e é essa concordância que diz que a regra está
// certa, não o raciocínio de quem a escreveu.
//
// Rodar: npm run provas
// ===========================================================================
import { naoEhDocumentoFiscal } from '../lib/documentoFiscal.js'

let falhas = 0
const ok = (nome, cond, extra = '') => {
  console.log((cond ? '  OK   ' : '  FALHA') + ' ' + nome + (cond ? '' : ' → ' + extra))
  if (!cond) falhas++
}

// ── O caso real, com os campos exatamente como vieram do banco ────────────
const acr = {
  tipo_documento: 'Outro',
  valor_total: 138143664,
  emitente_nome: '',
  destinatario_nome: '',
  descricao: 'Relatório interno de Balance Sheet - Trade account receivables',
}
ok('o relatório de R$ 138 milhões não passa',
  naoEhDocumentoFiscal(acr) === 'sem_nenhuma_das_partes', String(naoEhDocumentoFiscal(acr)))
ok('e o motivo é específico, não um "não é fiscal" genérico',
  naoEhDocumentoFiscal(acr) !== 'outro_sem_valor')

// ── A regra antiga continua valendo ───────────────────────────────────────
ok('"Outro" sem valor nenhum continua barrado',
  naoEhDocumentoFiscal({ tipo_documento: 'Outro', valor_total: 0, emitente_nome: 'Alguém' })
    === 'outro_sem_valor')

// ── E o que TEM que passar ────────────────────────────────────────────────
//
// Esta é a metade que importa mais: uma porta que barra demais é pior que uma
// porta que barra de menos, porque a nota que não entra ninguém procura.
const nota = {
  tipo_documento: 'NFS-e', valor_total: 5131,
  emitente_nome: 'POLIMATA CONSULTORIA EM GRC LTDA',
  destinatario_nome: 'Brascabos Componentes Elétricos e Eletrônicos Ltda.',
}
ok('nota fiscal com as duas partes passa', naoEhDocumentoFiscal(nota) === null)

ok('guia de imposto passa — o emitente é o governo',
  naoEhDocumentoFiscal({ tipo_documento: 'DAS', valor_total: 1131.9,
    emitente_nome: 'Receita Federal do Brasil', destinatario_nome: '' }) === null)

ok('recibo de pró-labore passa — quem emite é a própria empresa',
  naoEhDocumentoFiscal({ tipo_documento: 'Pró-labore', valor_total: 3956.05,
    emitente_nome: 'POLIMATA CONSULTORIA EM GRC LTDA', destinatario_nome: '' }) === null)

ok('nota só com o destinatário passa (a IA às vezes não lê o emitente)',
  naoEhDocumentoFiscal({ tipo_documento: 'NFS-e', valor_total: 50.14,
    emitente_nome: '', destinatario_nome: 'POLIMATA CONSULTORIA EM GRC LTDA' }) === null)

ok('fatura em dólar com valor_total 0 e só o original passa',
  naoEhDocumentoFiscal({ tipo_documento: 'Outro', valor_total: 0, valor_original: 199.26,
    emitente_nome: 'Vercel Inc.', destinatario_nome: '' }) === null)

// ── Espaço em branco não conta como nome ──────────────────────────────────
ok('nome só com espaços é o mesmo que nome nenhum',
  naoEhDocumentoFiscal({ tipo_documento: 'Outro', valor_total: 999,
    emitente_nome: '   ', destinatario_nome: '\t' }) === 'sem_nenhuma_das_partes')

// ── E se a leitura não devolver nada ─────────────────────────────────────
ok('objeto vazio não vira lançamento',
  naoEhDocumentoFiscal({}) !== null)


// ── O MESMO número escrito de dois jeitos ────────────────────────────────
//
// A mesma nota chega duas vezes no mesmo e-mail: uma no XML e outra no PDF.
// O XML traz "43034"; o PDF traz "00043034", porque é assim que a prefeitura
// imprime. A trava de duplicidade comparava os dígitos — e "43034" tem
// dígitos diferentes de "00043034".
//
// Custou seis lançamentos em duplicidade, R$ 285,80, medidos no banco:
//
//   MAPDATA     jan/26  R$ 50,14   49002 e 00049002
//   MAPDATA     fev/26  R$ 50,14   51271 e 00051271
//   NTI Brasil  mar/26  R$ 50,14   53257 e 00053257
//   NTI Brasil  abr/26  R$ 50,14   55513 e 00055513
//   Clicksign   ago/26  R$ 42,62  741752 e 00741752
//   Clicksign   set/26  R$ 42,62  806204 e 00806204
import { numeroCanonico } from '../lib/documentoFiscal.js'

ok('"00043034" e "43034" são o mesmo documento',
  numeroCanonico('00043034') === numeroCanonico('43034'), numeroCanonico('00043034'))
ok('vale para os seis pares reais',
  [['00049002','49002'], ['00051271','51271'], ['00053257','53257'],
   ['00055513','55513'], ['00741752','741752'], ['00806204','806204']]
    .every(([a, b]) => numeroCanonico(a) === numeroCanonico(b)))
ok('pontuação da impressão não muda o número',
  numeroCanonico('12.345/678') === numeroCanonico('12345678'))

// ── E a metade que impede a trava de apagar despesa de verdade ───────────
//
// Normalizar demais é pior que de menos: uma trava que funde dois documentos
// diferentes faz uma despesa sumir, e falta não se enxerga em lugar nenhum.
ok('números de verdade diferentes continuam diferentes',
  numeroCanonico('43034') !== numeroCanonico('43035'))
ok('duas faturas seguidas do mesmo fornecedor no mesmo dia NÃO se fundem',
  numeroCanonico('44RCMPM3-0002') !== numeroCanonico('44RCMPM3-0003'),
  numeroCanonico('44RCMPM3-0002'))
ok('código com letra não vira só dígitos',
  numeroCanonico('44RCMPM3-0003').includes('rcmpm'), numeroCanonico('44RCMPM3-0003'))
ok('as duas parcelas do seguro continuam separadas',
  numeroCanonico('6832637008') !== numeroCanonico('6832637040'))

ok('vazio é vazio', numeroCanonico('') === '' && numeroCanonico(null) === '')
ok('número zero não vira vazio', numeroCanonico('000') === '0')

console.log(falhas ? `\n${falhas} falha(s).` : '\n  todas passaram.')
process.exit(falhas ? 1 : 0)
