// ===========================================================================
// PROVA: o funil, e a diferença entre etapa e situação.
//
// O defeito que isto fecha: a etapa morava na ficha da pessoa, então a pessoa
// só podia estar em uma. Duas propostas para o mesmo cliente — uma em aberto
// e uma perdida — não cabiam, e a Poli Instrumentos carregava "Fechado" como
// se fosse atributo dela.
//
// E "Fechado" era etapa E situação no mesmo campo. Aqui são dois eixos:
// a etapa diz onde a negociação está; a situação, como ela terminou.
//
// Rodar: npm run provas
// ===========================================================================
import {
  funilPorEtapa, placarDoFunil, proximaReferencia, problemaNaOportunidade,
  situacaoDe, etapaDe,
} from '../src/lib/funil.js'

let falhas = 0
const ok = (nome, cond, extra = '') => {
  console.log((cond ? '  OK   ' : '  FALHA') + ' ' + nome + (cond ? '' : ' → ' + extra))
  if (!cond) falhas++
}
const op = (d) => ({ data: d })

// ── Duas propostas para a mesma pessoa, que antes não cabiam ────────────
const mesmaPessoa = [
  op({ pessoa_id: 'p1', etapa: 'Proposta', situacao: 'aberta', valor_estimado: 18000 }),
  op({ pessoa_id: 'p1', etapa: '', situacao: 'perdida', motivo_perda: 'preço', valor_estimado: 9000 }),
]
const placarP1 = placarDoFunil(mesmaPessoa)
ok('a mesma pessoa tem uma aberta e uma perdida ao mesmo tempo',
  placarP1.emAberto === 1 && placarP1.perdidas === 1, JSON.stringify(placarP1))

// ── O funil mostra só o que está em aberto ──────────────────────────────
const carteira = [
  op({ pessoa_id: 'p1', etapa: 'Sondagem', situacao: 'aberta', valor_estimado: 5000 }),
  op({ pessoa_id: 'p2', etapa: 'Sondagem', situacao: 'aberta', valor_estimado: 3000 }),
  op({ pessoa_id: 'p3', etapa: 'Proposta', situacao: 'aberta', valor_estimado: 18000 }),
  op({ pessoa_id: 'p4', etapa: 'Proposta', situacao: 'ganha', valor_estimado: 40000 }),
  op({ pessoa_id: 'p5', etapa: 'Negociação', situacao: 'perdida', motivo_perda: 'prazo', valor_estimado: 12000 }),
]
const colunas = funilPorEtapa(carteira)
ok('três etapas, sempre, mesmo vazias', colunas.length === 3, String(colunas.length))
ok('Sondagem soma as duas abertas',
  colunas[0].itens.length === 2 && colunas[0].total === 8000, String(colunas[0].total))
ok('a ganha NÃO fica no funil: ela já saiu',
  colunas[1].itens.length === 1 && colunas[1].total === 18000, String(colunas[1].total))
ok('a perdida também não', colunas[2].itens.length === 0, String(colunas[2].itens.length))

// Etapa vazia é legítima, e ganha coluna só quando existe.
const comSemEtapa = funilPorEtapa([...carteira, op({ pessoa_id: 'p6', etapa: '', situacao: 'aberta', valor_estimado: 1000 })])
ok('oportunidade sem etapa vira coluna própria, em vez de sumir',
  comSemEtapa.length === 4 && comSemEtapa[3].itens.length === 1, String(comSemEtapa.length))

// ── O placar ────────────────────────────────────────────────────────────
const placar = placarDoFunil(carteira)
ok('o valor em aberto soma só as abertas', placar.valorEmAberto === 26000, String(placar.valorEmAberto))
ok('ganho e perdido ficam separados',
  placar.valorGanho === 40000 && placar.valorPerdido === 12000, '')
ok('a taxa de ganho olha só o que foi DECIDIDO',
  placar.taxaGanho === 50, String(placar.taxaGanho))
ok('sem nada decidido, não há taxa — e zero mentiria',
  placarDoFunil([op({ pessoa_id: 'p1', etapa: 'Sondagem', situacao: 'aberta' })]).taxaGanho === null, '')
ok('lista vazia não quebra', placarDoFunil([]).emAberto === 0, '')
ok('nem indefinida', placarDoFunil(null).valorGanho === 0, '')

// ── A referência da proposta ────────────────────────────────────────────
ok('a primeira do ano é 001', proximaReferencia([], 2026) === 'P-2026-001', proximaReferencia([], 2026))
ok('segue a maior, e não a quantidade',
  proximaReferencia(['P-2026-001', 'P-2026-007', 'P-2026-003'], 2026) === 'P-2026-008',
  proximaReferencia(['P-2026-001', 'P-2026-007', 'P-2026-003'], 2026))
ok('o ano de outra proposta não interfere',
  proximaReferencia(['P-2025-099'], 2026) === 'P-2026-001', '')
ok('código estranho não derruba a contagem',
  proximaReferencia(['P-2026-abc', 'P-2026-002', null, ''], 2026) === 'P-2026-003', '')

// ── O que impede de salvar ──────────────────────────────────────────────
ok('oportunidade sem pessoa não salva',
  problemaNaOportunidade({ situacao: 'aberta', etapa: 'Sondagem' }) !== null, '')
ok('perdida sem motivo não salva: é do motivo que a causa se apura',
  /motivo da perda/i.test(problemaNaOportunidade({ pessoa_id: 'p1', situacao: 'perdida' }) || ''), '')
ok('aberta sem etapa não salva',
  /etapa/i.test(problemaNaOportunidade({ pessoa_id: 'p1', situacao: 'aberta' }) || ''), '')
ok('ganha não exige etapa: ela saiu do funil',
  problemaNaOportunidade({ pessoa_id: 'p1', situacao: 'ganha' }) === null, '')
ok('aberta com etapa salva',
  problemaNaOportunidade({ pessoa_id: 'p1', situacao: 'aberta', etapa: 'Proposta' }) === null, '')

// ── Leitura tolerante ───────────────────────────────────────────────────
ok('sem situação, assume aberta', situacaoDe({ data: {} }) === 'aberta', '')
ok('sem etapa, devolve vazio e não inventa', etapaDe({ data: {} }) === '', '')

console.log(falhas ? `\n${falhas} falha(s).` : '\nTodos os casos passaram.')
process.exit(falhas ? 1 : 0)
