// ===========================================================================
// PROVA: "o mesmo desembolso não entra duas vezes".
//
// O caso que originou esta regra está medido no banco: R$ 932,31 de INSS
// chegou em TRÊS documentos do mesmo mês —
//
//   • a GPS                        → é o que se paga        (um lançamento)
//   • o Relatório Totalizador      → é o cálculo que gerou  (nenhum)
//   • o Recibo da DCTFWeb          → é a prova da entrega   (nenhum)
//
// e R$ 10.319,71 chegou em QUATRO. Sem o papel, cada um deles é candidato a
// lançamento e a despesa triplica.
//
// A prova mais importante aqui é a de PRECEDÊNCIA: o recibo de entrega da
// DCTFWeb traz o valor do DARF dentro dele. Foi exatamente isso que fez a IA
// classificá-lo como DARF. A ordem das regras é o que conserta.
//
// Rodar: npm run provas
// ===========================================================================
import { reconhecerPapel, viraLancamento } from '../lib/papelDocumento.js'

let falhas = 0
const ok = (nome, cond, extra = '') => {
  console.log((cond ? '  OK   ' : '  FALHA') + ' ' + nome + (cond ? '' : ' → ' + extra))
  if (!cond) falhas++
}
const papelDe = (t, n) => (reconhecerPapel(t, n) || {}).papel || null

// ── 1. A precedência: o recibo da DCTFWeb NÃO é o DARF ────────────────────
//
// Texto no formato do documento real: o recibo de entrega mostra o débito
// apurado, com o valor da guia. Quem decide pelo valor erra.
const reciboDctfweb = `
  DCTFWeb - Declaracao de Debitos e Creditos Tributarios Federais
  RECIBO DE ENTREGA
  Numero do Recibo: 00.00.00000.0000000-00
  Periodo de Apuracao: 08/2026
  Documento de Arrecadacao - DARF
  Valor total do debito: 932,31
`
ok('recibo da DCTFWeb é comprovante, não DARF',
  papelDe(reciboDctfweb, '1201_Recibo_DCTFWeb_082026.pdf') === 'comprovante',
  papelDe(reciboDctfweb))
ok('e por isso NÃO vira lançamento',
  reconhecerPapel(reciboDctfweb).vira_lancamento === false)

// ── 2. A guia de verdade vira lançamento ──────────────────────────────────
const gps = `
  GUIA DA PREVIDENCIA SOCIAL - GPS
  Codigo de Pagamento 2100
  Competencia 08/2026
  Valor do INSS 932,31
`
ok('a GPS é obrigação', papelDe(gps, 'Guia_GPS_082026.pdf') === 'obrigacao', papelDe(gps))
ok('e vira lançamento', reconhecerPapel(gps).vira_lancamento === true)

// ── 3. O totalizador do eSocial é base de cálculo ─────────────────────────
const totalizador = `
  Relatorio Totalizador do eSocial
  Evento S-5011 - Informacoes das contribuicoes sociais consolidadas
  Contribuicao Patronal - CPP 932,31
`
ok('o totalizador é base de cálculo',
  papelDe(totalizador, 'Relatorio eSocial 082026.pdf') === 'base_de_calculo', papelDe(totalizador))
ok('e NÃO vira lançamento', reconhecerPapel(totalizador).vira_lancamento === false)

// ── 4. O desfecho: três documentos, UM lançamento ─────────────────────────
const oTrio = [gps, totalizador, reciboDctfweb]
const quantosLancam = oTrio.filter(t => reconhecerPapel(t)?.vira_lancamento).length
ok('os três documentos de R$ 932,31 geram 1 lançamento, não 3',
  quantosLancam === 1, `gerou ${quantosLancam}`)

// ── 5. O acento não pode mudar o resultado ────────────────────────────────
//
// Medido na prática: "Relatorio eSocial" a IA devolveu "Outro"; com acento,
// "Relatório eSocial", devolveu "GPS". O mesmo documento, dois resultados.
ok('"Relatório Totalizador" (com acento) = base de cálculo',
  papelDe('Relatório Totalizador da Empresa') === 'base_de_calculo')
ok('"Relatorio Totalizador" (sem acento) = o mesmo',
  papelDe('Relatorio Totalizador da Empresa') === 'base_de_calculo')
ok('caixa alta ou baixa não muda',
  papelDe('recibo de entrega') === papelDe('RECIBO DE ENTREGA'))

// ── 6. O recibo de pró-labore: dinheiro que sai para pessoa física ────────
const reciboProlabore = `
  Recibo de pagamento de salario / pro-labore
  Competencia: 08/2026
  Total de Proventos (BRUTO) 4.443,77
  Liquido a receber 4.000,00
`
ok('o recibo mensal é pagamento a pessoa física',
  papelDe(reciboProlabore, '1201_Recibo_mensal_082026.pdf') === 'pagamento_pf',
  papelDe(reciboProlabore))
ok('e vira lançamento (é desembolso de verdade)',
  reconhecerPapel(reciboProlabore).vira_lancamento === true)
ok('o nome do arquivo do contador confirma, mas só como reforço',
  reconhecerPapel(reciboProlabore, '1201_Recibo_mensal_082026.pdf').reforco_nome === 'RECIBO MENSAL')

// ── 7. A declaração e o recibo DELA são coisas diferentes ─────────────────
ok('o PGDAS-D em si é declaração',
  papelDe('Extrato do Simples Nacional PGDAS-D - Apuracao 08/2026') === 'declaracao')
ok('o recibo de entrega do PGDAS-D é comprovante',
  papelDe('PGDAS-D Recibo de Entrega da Declaracao Numero do Recibo 123') === 'comprovante')
ok('nenhum dos dois vira lançamento',
  !viraLancamento('declaracao') && !viraLancamento('comprovante'))

// ── 8. O que ele NÃO reconhece, ele devolve para a IA ─────────────────────
//
// Reconhecedor que adivinha é pior que reconhecedor que se cala: ele erra com
// a autoridade de quem é determinístico.
ok('texto sem marcador nenhum → null (a IA decide, como antes)',
  reconhecerPapel('Prezada, segue em anexo conforme combinado. Atenciosamente.') === null)
ok('texto vazio → null', reconhecerPapel('') === null && reconhecerPapel(null) === null)

// ── 9. O NOME do arquivo nunca decide sozinho ────────────────────────────
//
// "1201_" é o padrão do software do contador DELA. Outro cliente, outro
// contador, outro nome — e aí um reconhecedor que confia no nome para de
// funcionar sem avisar. Esta prova trava isso.
ok('nome "Recibo_1201_x.pdf" com texto vazio de marcadores → null',
  reconhecerPapel('Documento anexo.', '1201_Recibo_mensal_092026.pdf') === null)

// ── 10. A evidência fica guardada ─────────────────────────────────────────
//
// Quem conferir depois precisa ver POR QUE o sistema decidiu, em vez de
// confiar. É o que separa isto de um palpite.
const r = reconhecerPapel(reciboDctfweb)
ok('o marcador que decidiu fica registrado',
  Array.isArray(r.marcadores) && r.marcadores.includes('RECIBO DE ENTREGA'),
  JSON.stringify(r.marcadores))


// ── 11. O erro INVERSO: nota fiscal arquivada como prova ──────────────────
//
// O canhoto do DANFE diz, com estas palavras, "RECIBO DE ENTREGA". Se a regra
// do comprovante viesse primeiro, uma nota de verdade seria arquivada como
// evidência e a despesa simplesmente não existiria em contas a pagar.
//
// Dobro se enxerga no extrato. Falta não se enxerga em lugar nenhum. Por isso
// documento fiscal é o PRIMEIRO degrau, e não o último.
const danfeComCanhoto = `
  DANFE - Documento Auxiliar da Nota Fiscal Eletronica
  CHAVE DE ACESSO 3526 0812 3456 7800 0190 5500 1000 0001 2310 0000 0017
  RECIBO DE ENTREGA - Recebemos de POLIMATA os produtos constantes na nota
  VALOR TOTAL DA NOTA 1.250,00
`
ok('DANFE com canhoto continua sendo documento fiscal',
  papelDe(danfeComCanhoto, 'NFe_12345.pdf') === 'documento_fiscal', papelDe(danfeComCanhoto))
ok('e vira lançamento', reconhecerPapel(danfeComCanhoto).vira_lancamento === true)
ok('a NFS-e em PDF também',
  papelDe('Nota Fiscal de Servicos Eletronica - NFS-e numero 72') === 'documento_fiscal')
ok('e o recibo da DCTFWeb não ganhou chave de acesso por isso',
  papelDe(reciboDctfweb) === 'comprovante')

console.log(falhas ? `\n${falhas} falha(s).` : '\n  todas passaram.')
process.exit(falhas ? 1 : 0)
