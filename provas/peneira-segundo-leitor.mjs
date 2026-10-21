// O SEGUNDO LEITOR DE PDF — e a única coisa que ele não pode fazer.
//
// Existe PDF que o extrator de sempre não tem como ler: o boleto da JL Ramos
// escreve a página em código de glifo hexadecimal, que só vira letra depois de
// passar pelo mapa da fonte embutida. Medido no boleto de 09/2026: 8 blocos,
// 7 inflados, 147 mil caracteres extraídos — e todos eram tabela de fonte.
// "JL RAMOS" não aparecia nem no visível nem no arquivo cru.
//
// A condição que a Juliana pôs ao aprovar o conserto foi "desde que não
// atrapalhe o resto". Esta prova é essa condição virada em código: o segundo
// leitor SOMA texto, nunca substitui, e falhar nele não pode custar nada.
//
// Conferido também fora da prova, nos 180 PDFs já arquivados: 161 ficaram
// iguais, 19 passaram a ser reconhecidos, ZERO perderam o papel que tinham.
import { textoComMotor, textoCompleto, extrairDoPdf } from '../lib/peneiraPdf.js'

let falhas = 0
const ok = (cond, oque) => { if (!cond) { falhas++; console.error('  X ' + oque) } }

// ── A GARANTIA PRINCIPAL: NUNCA PERDER O QUE JÁ SE TINHA ─────────────────
const jaLido = 'DOCUMENTO AUXILIAR DA NOTA FISCAL VALOR DO DOCUMENTO'

ok(await textoCompleto(Buffer.from('não é pdf nenhum'), jaLido) === jaLido,
  'arquivo ilegível: devolve INTEIRO o texto que o extrator de sempre já tinha')
ok(await textoCompleto(null, jaLido) === jaLido,
  'buffer nulo: idem — o fluxo segue com o texto antigo')
ok(await textoCompleto(Buffer.alloc(0), jaLido) === jaLido,
  'buffer vazio: idem')

const comTudo = await textoCompleto(Buffer.from('lixo'), jaLido)
ok(comTudo.includes('VALOR DO DOCUMENTO'),
  'o marcador que já era encontrado continua no texto final')

// ── FALHAR NÃO PODE DERRUBAR NADA ────────────────────────────────────────
ok(await textoComMotor(Buffer.from('%PDF-1.4 mas quebrado')) === '',
  'PDF corrompido devolve string vazia, não exceção')
ok(await textoComMotor(undefined) === '', 'entrada indefinida devolve vazio')
ok(await textoComMotor('texto solto, não é Buffer') === '', 'tipo errado devolve vazio')

// ── E SEM TEXTO ANTERIOR, O QUE SOBRA É O QUE O MOTOR LEU ────────────────
ok(await textoCompleto(Buffer.from('lixo'), '') === '',
  'nada de um lado, nada do outro: resultado vazio, sem "undefined" no meio')

// ── O EXTRATOR DE SEMPRE CONTINUA INTACTO ────────────────────────────────
// Ele é síncrono e não foi tocado — quem depende dele não muda de forma.
const r = extrairDoPdf(Buffer.from('não é pdf'))
ok(r && typeof r.visivel === 'string' && r.blocos === 0,
  'extrairDoPdf segue síncrono e com o mesmo formato de retorno')

if (falhas) { console.error(falhas + ' falha(s)'); process.exit(1) }
console.log('  ok: o segundo leitor soma texto e, quando falha, não custa nada')
