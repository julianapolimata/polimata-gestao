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

console.log(falhas ? `\n${falhas} falha(s).` : '\n  todas passaram.')
process.exit(falhas ? 1 : 0)
