// ===========================================================================
// PROVA: boleto não escritura sozinho.
//
// Até 09/11/2026 tudo que não fosse guia ou folha nascia "vinculado" — o que
// AFIRMA que a nota fiscal está anexada. Num boleto, o que está anexado é um
// boleto: instrução de pagamento, não documento fiscal.
//
// Os dois casos reais dela se contradizem, e é por isso que o sistema não pode
// escolher: a ACIAS só emite boleto (dispensado é a verdade) e a JL Ramos
// emite nota (pendente é a verdade). Mesmo documento, duas respostas certas.
//
// Rodar: npm run provas
// ===========================================================================
import { situacaoFiscalDe, fiscalEmAberto } from '../src/lib/situacaoFiscal.js'

let falhas = 0
const ok = (nome, cond, extra = '') => {
  console.log((cond ? '  OK   ' : '  FALHA') + ' ' + nome + (cond ? '' : ' → ' + extra))
  if (!cond) falhas++
}

// ── O boleto ─────────────────────────────────────────────────────────────
const boleto = situacaoFiscalDe({ tipo_documento: 'Boleto' })
ok('boleto NÃO nasce como "Com NF"', boleto.doc_status !== 'vinculado', boleto.doc_status)
ok('boleto nasce com a situação fiscal em aberto', boleto.doc_status === '', `"${boleto.doc_status}"`)
ok('e não escolhe "dispensado" por ela tampouco',
  boleto.doc_motivo_dispensa === undefined, String(boleto.doc_motivo_dispensa))
ok('o lançamento sabe dizer por que ficou em aberto',
  typeof boleto.fiscal_motivo_aberto === 'string' && boleto.fiscal_motivo_aberto.includes('instrução de pagamento'),
  boleto.fiscal_motivo_aberto)
ok('e a tela reconhece esse estado',
  fiscalEmAberto({ ...boleto }) === true, '')

// Fatura, pelo mesmo motivo.
ok('fatura também não decide sozinha',
  situacaoFiscalDe({ tipo_documento: 'Fatura' }).doc_status === '', '')

// ── O que continua decidindo sozinho ─────────────────────────────────────
for (const t of ['DAS', 'DARF', 'GPS', 'GNRE']) {
  const r = situacaoFiscalDe({ tipo_documento: t })
  ok(`${t} continua dispensado, com o motivo escrito`,
    r.doc_status === 'dispensado' && /guia/i.test(r.doc_motivo_dispensa || ''), r.doc_status)
}
for (const t of ['Folha', 'Pró-labore', 'PRO-LABORE']) {
  const r = situacaoFiscalDe({ tipo_documento: t })
  ok(`${t} continua dispensado`, r.doc_status === 'dispensado', r.doc_status)
}
for (const t of ['NF-e', 'NFS-e']) {
  const r = situacaoFiscalDe({ tipo_documento: t })
  ok(`${t} continua nascendo com a nota vinculada`, r.doc_status === 'vinculado', r.doc_status)
  ok(`e ${t} não fica em aberto`, fiscalEmAberto({ ...r }) === false, '')
}

// ── Caixa e acento não podem mudar o resultado ───────────────────────────
ok('"boleto" minúsculo vale igual',
  situacaoFiscalDe({ tipo_documento: 'boleto' }).doc_status === '', '')
ok('espaço em volta não atrapalha',
  situacaoFiscalDe({ tipo_documento: '  Boleto ' }).doc_status === '', '')
ok('tipo desconhecido segue o caminho de sempre',
  situacaoFiscalDe({ tipo_documento: 'Recibo qualquer' }).doc_status === 'vinculado', '')
ok('documento sem tipo também',
  situacaoFiscalDe({}).doc_status === 'vinculado', '')

// ── fiscalEmAberto não confunde vazio com decidido ───────────────────────
ok('lançamento já decidido não conta como em aberto',
  fiscalEmAberto({ fiscal_em_aberto: true, doc_status: 'dispensado' }) === false, '')
ok('lançamento antigo, sem a marca, não vira em aberto',
  fiscalEmAberto({ doc_status: '' }) === false, '')

console.log(falhas ? `\n${falhas} falha(s).` : '\nTodos os casos passaram.')
process.exit(falhas ? 1 : 0)
