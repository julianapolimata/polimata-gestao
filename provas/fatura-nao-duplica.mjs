// ===========================================================================
// PROVA: a fatura do cartão não duplica o que já está no sistema.
//
// Os casos saíram de dados REAIS: as 15 duplicatas nota × cartão de set/26 e as
// 241 compras antigas do cartão sem linha de fatura. É a regra que decide se um
// lançamento nasce ou é reaproveitado — errar aqui ou duplica a despesa, ou
// apaga o lançamento errado. Nenhum dos dois grita.
//
// Rodar: npm run provas
// ===========================================================================
import { planejarCompras, parearNotasJaLancadas, parearComprasJaLancadas } from '../src/lib/faturaCartao.js'

const conta = { id: 'cartao-1', data: { tipo: 'cartao', dia_fechamento: 15, dia_vencimento: 22 } }
const linha = (id, descricao, valor, data) => ({ id, fit_id: id, data: { tipo: 'saida', descricao, valor, data, fatura_vencimento: '2026-08-22' } })
const nota = (id, supplier, value, comp, numero_nf) => ({ id, data: { supplier, value, data_competencia: comp, numero_nf, cat: 'Despesas Operacionais', subcat: 'Softwares' } })

let falhas = 0
const ok = (nome, cond, extra = '') => { console.log((cond ? '  OK   ' : '  FALHA') + ' ' + nome + (cond ? '' : ' → ' + extra)); if (!cond) falhas++ }

// ── 1. O caso real: nome diferente, valor e data iguais → casa, não duplica ──
{
  const linhas = [linha('L1', 'ANTHROPIC* CLAUDE SU          ANTHROPIC.COM - R$ 550,00', 550, '2026-07-25')]
  const notas = [nota('N1', 'Anthropic, PBC', 550, '2026-07-25', '44RCMPM3-0009')]
  const p = planejarCompras({ conta, linhas, compras: [], notas })
  ok('nome diferente, valor+data iguais → casa', p.casar.length === 1 && p.criar.length === 0, JSON.stringify({ casar: p.casar.length, criar: p.criar.length }))
  ok('a nota mantém número e classificação', p.casar[0]?.data?.numero_nf === '44RCMPM3-0009' && p.casar[0]?.data?.cat === 'Despesas Operacionais')
  ok('a nota absorve o pagamento', p.casar[0]?.data?.status === 'Pago' && p.casar[0]?.data?.forma_pagamento === 'Cartão Crédito')
  ok('o resumo avisa que reconheceu a nota', p.notasCasadas.length === 1)
}

// ── 2. A ARMADILHA: 5 notas de R$ 550 do mesmo fornecedor (meses diferentes) ──
//     Só a do mês bate pela data; as outras estão fora da janela → ainda é 1:1.
{
  const linhas = [linha('L1', 'ANTHROPIC* CLAUDE SU', 550, '2026-07-25')]
  const notas = [
    nota('N1', 'Anthropic, PBC', 550, '2026-07-25', '0009'),
    nota('N2', 'Anthropic, PBC', 550, '2026-06-25', '0008'),
    nota('N3', 'Anthropic, PBC', 550, '2026-08-25', '0010'),
    nota('N4', 'Anthropic, PBC', 550, '2026-04-25', '0005'),
    nota('N5', 'Anthropic, PBC', 550, '2026-05-25', '0007'),
  ]
  const p = planejarCompras({ conta, linhas, compras: [], notas })
  ok('5 notas iguais: casa só a do mês certo', p.casar.length === 1 && p.casar[0].data.numero_nf === '0009', JSON.stringify(p.casar.map(c => c.data.numero_nf)))
}

// ── 3. AMBIGUIDADE REAL: duas notas do mesmo valor DENTRO da janela ──────────
//     Não casa nenhuma: cria a compra e devolve a decisão a quem escritura.
{
  const linhas = [linha('L1', 'FORNECEDOR X', 550, '2026-07-25')]
  const notas = [nota('N1', 'Fornecedor X', 550, '2026-07-25', 'A'), nota('N2', 'Fornecedor X', 550, '2026-07-27', 'B')]
  const p = planejarCompras({ conta, linhas, compras: [], notas })
  ok('duas notas na janela → não casa nenhuma', p.casar.length === 0 && p.criar.length === 1, JSON.stringify({ casar: p.casar.length, criar: p.criar.length }))
}

// ── 4. Duas linhas da fatura para uma nota só → também não casa ─────────────
{
  const linhas = [linha('L1', 'FORN Y', 100, '2026-07-25'), linha('L2', 'FORN Y', 100, '2026-07-26')]
  const notas = [nota('N1', 'Forn Y', 100, '2026-07-25', 'C')]
  const p = planejarCompras({ conta, linhas, compras: [], notas })
  ok('duas linhas p/ uma nota → não casa nenhuma', p.casar.length === 0 && p.criar.length === 2, JSON.stringify({ casar: p.casar.length, criar: p.criar.length }))
}

// ── 5. Valor diferente não casa, por mais próxima que seja a data ────────────
{
  const linhas = [linha('L1', 'FORN Z', 550, '2026-07-25')]
  const notas = [nota('N1', 'Forn Z', 549.99, '2026-07-25', 'D')]
  const p = planejarCompras({ conta, linhas, compras: [], notas })
  ok('centavo de diferença não casa', p.casar.length === 0 && p.criar.length === 1)
}

// ── 6. Data fora da janela não casa ──────────────────────────────────────────
{
  const linhas = [linha('L1', 'FORN W', 550, '2026-07-25')]
  const notas = [nota('N1', 'Forn W', 550, '2026-07-31', 'E')]
  const p = planejarCompras({ conta, linhas, compras: [], notas })
  ok('6 dias de diferença não casa', p.casar.length === 0 && p.criar.length === 1)
}

// ── 7. Parcela continua indo pelo caminho da parcela, não pelo da nota ───────
{
  const linhas = [linha('L1', 'PORTO SEGURO SEGUROS  03/12   SAO PAULO', 550, '2026-07-25')]
  const notas = [nota('N1', 'Porto Seguro', 550, '2026-07-25', 'F')]
  const p = planejarCompras({ conta, linhas, compras: [], notas })
  ok('parcela não casa com nota', p.casar.length === 0 && p.criar.length > 0)
}

// ── 8. Pagamento da fatura e crédito continuam fora ──────────────────────────
{
  const linhas = [{ ...linha('L1', 'PAGAMENTO EFETUADO', 550, '2026-07-25'), data: { tipo: 'entrada', descricao: 'PAGAMENTO EFETUADO', valor: 550, data: '2026-07-25', fatura_vencimento: '2026-08-22' } }]
  const notas = [nota('N1', 'Qualquer', 550, '2026-07-25', 'G')]
  const p = planejarCompras({ conta, linhas, compras: [], notas })
  ok('pagamento da fatura não casa com nota', p.casar.length === 0 && p.pagamentos.length === 1)
}

// ── 9. Sem notas, nada muda (comportamento antigo preservado) ────────────────
{
  const linhas = [linha('L1', 'MERCADO LIVRE', 80, '2026-07-25')]
  const p = planejarCompras({ conta, linhas, compras: [] })
  ok('sem notas: cria como antes', p.casar.length === 0 && p.criar.length === 1)
}

// ── 10. Lançamento sem numero_nf não é candidato ─────────────────────────────
{
  const linhas = [linha('L1', 'FORN V', 550, '2026-07-25')]
  const semNota = [{ id: 'X', data: { supplier: 'Forn V', value: 550, data_competencia: '2026-07-25' } }]
  const pares = parearNotasJaLancadas({ linhas, notas: semNota })
  ok('lançamento sem NF não é candidato', pares.size === 0)
}


// ===== Regra nova: a linha reconhece a COMPRA que já está no sistema =========
const compra = (id, desc, value, comp, extra = {}) => ({ id, extrato_id: null, data: { supplier: desc, desc, value, data_competencia: comp, ...extra } })

// 11. Compra antiga sem fit_id, mesmo valor e mesma data → casa, não duplica.
{
  const linhas = [linha("L1", "MERCADO LIVRE*COMPRA", 189.9, "2026-07-14")]
  const compras = [compra("C1", "MERCADO LIVRE*COMPRA", 189.9, "2026-07-14")]
  const p = planejarCompras({ conta, linhas, compras })
  ok("compra já existente sem fit_id → casa", p.casar.length === 1 && p.criar.length === 0, JSON.stringify({ casar: p.casar.length, criar: p.criar.length }))
  ok("o resumo avisa a compra reconhecida", p.comprasRecasadas.length === 1)
}

// 12. Um dia de diferença NÃO casa: a fatura traz a data da própria compra.
{
  const linhas = [linha("L1", "FORN Q", 100, "2026-07-14")]
  const compras = [compra("C1", "FORN Q", 100, "2026-07-15")]
  const p = planejarCompras({ conta, linhas, compras })
  ok("1 dia de diferença não casa compra", p.casar.length === 0 && p.criar.length === 1)
}

// 13. Duas compras iguais no mesmo dia (caso real: 2 x R$ 50 da Anthropic).
{
  const linhas = [linha("L1", "ANTHROPIC", 50, "2026-03-25"), linha("L2", "ANTHROPIC", 50, "2026-03-25")]
  const compras = [compra("C1", "ANTHROPIC", 50, "2026-03-25"), compra("C2", "ANTHROPIC", 50, "2026-03-25")]
  const p = planejarCompras({ conta, linhas, compras })
  ok("duas iguais no mesmo dia → não casa nenhuma", p.casar.length === 0 && p.criar.length === 2, JSON.stringify({ casar: p.casar.length, criar: p.criar.length }))
}

// 14. Parcela existente não entra na regra de valor+data (tem caminho próprio).
{
  const linhas = [linha("L1", "LOJA X", 200, "2026-07-14")]
  const compras = [compra("C1", "LOJA X", 200, "2026-07-14", { parcela_total: 12, parcela_atual: 3 })]
  const p = planejarCompras({ conta, linhas, compras })
  ok("parcela não é candidata de valor+data", p.casar.length === 0 && p.criar.length === 1)
}

// 15. Nota tem prioridade sobre compra quando as duas batem (a nota traz o documento).
{
  const linhas = [linha("L1", "ANTHROPIC* CLAUDE SU", 550, "2026-07-25")]
  const notas = [nota("N1", "Anthropic, PBC", 550, "2026-07-25", "0009")]
  const compras = [compra("C1", "ANTHROPIC* CLAUDE SU", 550, "2026-07-25")]
  const p = planejarCompras({ conta, linhas, compras, notas })
  ok("nota vence a compra no desempate", p.casar.length === 1 && p.casar[0].lanc_id === "N1", JSON.stringify(p.casar.map(c => c.lanc_id)))
}


// ── A nota sem o campo do número ──────────────────────────────────────────
//
// O pareamento só olhava notas com `data.numero_nf`. O campo mente por
// omissão: 4 das 20 notas lançadas dela estão sem ele, com o número apenas
// dentro da descrição. Duas viraram despesa em dobro — a assinatura da
// Clicksign de abril e a de maio/2026, cada uma lançada uma vez pela nota (em
// 26/05) e outra pela fatura do cartão (em 21/08).
//
// A cronologia é o que torna o caso constrangedor: a nota estava no sistema
// TRÊS MESES antes da fatura chegar. Era o pareamento mais fácil possível.
const linhaClicksign = [{ id: 'L1', data: { tipo: 'saida', valor: 42.62, data: '2026-04-25', descricao: 'CLICKSIGN*Clicksi SAO PAULO' } }]

const notaSemCampo = [{
  id: 'N1',
  data: { value: 42.62, data_competencia: '2026-04-25', desc: 'NFS-e 00492921 — Assinatura eletrônica de documentos' },
}]
ok('nota com o número só na descrição é pareada',
  parearNotasJaLancadas({ linhas: linhaClicksign, notas: notaSemCampo }).get('L1')?.id === 'N1')

const notaComCampo = [{
  id: 'N2',
  data: { value: 42.62, numero_nf: '00492921', data_competencia: '2026-04-25', desc: 'NFS-e 00492921 — Assinatura' },
}]
ok('e a que tem o campo continua sendo',
  parearNotasJaLancadas({ linhas: linhaClicksign, notas: notaComCampo }).get('L1')?.id === 'N2')

// E o que NÃO pode ser confundido com nota: a trava existe para não parear a
// linha da fatura com qualquer despesa de mesmo valor que ande por perto.
const naoEhNota = [{
  id: 'N3',
  data: { value: 42.62, data_competencia: '2026-04-25', desc: 'Assinatura mensal lançada à mão' },
}]
ok('lançamento comum NÃO é confundido com nota',
  parearNotasJaLancadas({ linhas: linhaClicksign, notas: naoEhNota }).size === 0)
ok('"Nota fiscal" por extenso também conta',
  parearNotasJaLancadas({
    linhas: linhaClicksign,
    notas: [{ id: 'N4', data: { value: 42.62, data_competencia: '2026-04-25', desc: 'Nota Fiscal de Serviço 492921' } }],
  }).get('L1')?.id === 'N4')
ok('mas "notadamente" não — a palavra tem que ser a palavra',
  parearNotasJaLancadas({
    linhas: linhaClicksign,
    notas: [{ id: 'N5', data: { value: 42.62, data_competencia: '2026-04-25', desc: 'Notadamente despesa de abril' } }],
  }).size === 0)

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTodos os casos passaram.')
process.exit(falhas ? 1 : 0)
