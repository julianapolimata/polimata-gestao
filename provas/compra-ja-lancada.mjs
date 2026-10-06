// ===========================================================================
// PROVA: "a nota não vira despesa de novo se a compra já está no cartão".
//
// O caso real: a assinatura da Clicksign de dez/2025, R$ 40,88. A compra está
// lançada pelo cartão desde 01/06/2026; a nota ("NFSE_00256943_ODU3.pdf")
// continua na fila oferecendo "✓ Aprovar". Aprovar dobraria a despesa.
//
// O sistema já evitava isso, mas só de um lado: o pareamento roda ao IMPORTAR
// A FATURA. Quando a ordem se inverte — a compra chega primeiro e a nota
// depois — ninguém conferia, porque a aprovação acontece na tela.
//
// Rodar: npm run provas
// ===========================================================================
import { comprasQuePodemSerEsta, avisoDeCompraJaLancada, JANELA_DIAS_COMPRA }
  from '../src/lib/compraJaLancada.js'

let falhas = 0
const ok = (nome, cond, extra = '') => {
  console.log((cond ? '  OK   ' : '  FALHA') + ' ' + nome + (cond ? '' : ' → ' + extra))
  if (!cond) falhas++
}

const compraCartao = (extra = {}) => ({
  id: 'C1', cartao_id: 'cartao-1',
  data: { value: 40.88, data_competencia: '2025-12-25', desc: 'CLICKSIGN*Clicksi SAO PAULO', ...extra },
})
const notaDez = { valor: 40.88, data_emissao: '2025-12-25' }

// ── O caso real ──────────────────────────────────────────────────────────
ok('a nota de dez/25 encontra a compra já lançada',
  comprasQuePodemSerEsta(notaDez, [compraCartao()]).length === 1)
const aviso = avisoDeCompraJaLancada(comprasQuePodemSerEsta(notaDez, [compraCartao()]))
ok('o aviso diz QUAL lançamento é o suspeito',
  aviso.detalhe.includes('CLICKSIGN') && aviso.detalhe.includes('2025-12-25'), aviso?.detalhe)
ok('e diz o que fazer em vez de só alarmar',
  aviso.sugestao.toLowerCase().includes('anexe'))

// ── E as de out e nov/25, que NÃO têm compra: podem ser aprovadas ────────
//
// Esta é a metade que importa. Aviso que aparece sempre vira ruído, e aí a
// pessoa clica em "lançar mesmo assim" sem ler — e o aviso deixa de proteger
// exatamente quando ele seria necessário.
ok('nota sem compra correspondente não gera aviso',
  comprasQuePodemSerEsta({ valor: 40.88, data_emissao: '2025-10-25' }, [compraCartao()]).length === 0)
ok('e aviso de lista vazia é nulo, não uma caixa vazia',
  avisoDeCompraJaLancada([]) === null && avisoDeCompraJaLancada(null) === null)

// ── A janela ─────────────────────────────────────────────────────────────
ok(`${JANELA_DIAS_COMPRA} dias de folga: a nota emitida 3 dias depois ainda casa`,
  comprasQuePodemSerEsta({ valor: 40.88, data_emissao: '2025-12-28' }, [compraCartao()]).length === 1)
ok('mas a mensalidade do mês seguinte não casa',
  comprasQuePodemSerEsta({ valor: 40.88, data_emissao: '2026-01-25' }, [compraCartao()]).length === 0)

// ── Valor é valor ────────────────────────────────────────────────────────
ok('um centavo de diferença não é a mesma despesa',
  comprasQuePodemSerEsta({ valor: 40.89, data_emissao: '2025-12-25' }, [compraCartao()]).length === 0)
ok('o sinal não atrapalha (despesa é negativa em alguns lugares)',
  comprasQuePodemSerEsta({ valor: -40.88, data_emissao: '2025-12-25' }, [compraCartao()]).length === 1)

// ── Só compra de CARTÃO ──────────────────────────────────────────────────
//
// Um boleto de mesmo valor e data não é a mesma despesa — a nota que chega
// pode ser justamente a dele. Avisar ali faria a pessoa deixar de lançar algo
// que precisava ser lançado, e falta não se enxerga em lugar nenhum.
ok('lançamento que não é do cartão não dispara aviso',
  comprasQuePodemSerEsta(notaDez, [{ ...compraCartao(), cartao_id: null }]).length === 0)

// ── Duas candidatas: avisa das duas, não escolhe sozinho ─────────────────
const duas = comprasQuePodemSerEsta(notaDez, [
  compraCartao(),
  { id: 'C2', cartao_id: 'cartao-1', data: { value: 40.88, data_competencia: '2025-12-26', desc: 'OUTRA COMPRA' } },
])
ok('duas compras parecidas aparecem as duas', duas.length === 2)
ok('e a mais próxima da data vem primeiro', duas[0].id === 'C1', duas.map(c => c.id).join(','))
ok('o aviso de duas diz que são duas',
  avisoDeCompraJaLancada(duas).detalhe.includes('2 compras'))

// ── Sem dados, sem palpite ───────────────────────────────────────────────
ok('nota sem valor não gera aviso', comprasQuePodemSerEsta({ data_emissao: '2025-12-25' }, [compraCartao()]).length === 0)
ok('nota sem data não gera aviso', comprasQuePodemSerEsta({ valor: 40.88 }, [compraCartao()]).length === 0)
ok('lista vazia de compras não quebra', comprasQuePodemSerEsta(notaDez, []).length === 0)
ok('lista nula não quebra', comprasQuePodemSerEsta(notaDez, null).length === 0)

console.log(falhas ? `\n${falhas} falha(s).` : '\n  todas passaram.')
process.exit(falhas ? 1 : 0)
