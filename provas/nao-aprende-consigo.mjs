// ===========================================================================
// PROVA: o sistema não aprende com as próprias sugestões.
//
// A guarda existia desde sempre, com este comentário:
//
//     // Aprender do que o próprio sistema propôs seria aprender com ele mesmo.
//     if (e?.data?.conciliado_por === 'automatico') continue
//
// Só que `conciliado_por` nunca era escrito — nem pelo código, nem por função
// do banco. A guarda nunca disparava, e uma conciliação feita pelo botão
// automático entrava no aprendizado como se fosse decisão dela. O sistema
// passava a confirmar os próprios palpites, sem que ninguém visse.
//
// Achado na auditoria de 10/11/2026 e corrigido na migração
// `conciliacao_registra_quem_conciliou`. Esta prova existe para que a guarda
// não volte a morrer em silêncio: se alguém parar de gravar a origem, ou
// trocar o rótulo, ela falha aqui e não em produção.
//
// Rodar: npm run provas
// ===========================================================================
import { construirRegrasDeConciliacao, chaveDaLinha } from '../src/lib/regrasConciliacao.js'

let falhas = 0
const ok = (nome, cond, extra = '') => {
  console.log((cond ? '  OK   ' : '  FALHA') + ' ' + nome + (cond ? '' : ' → ' + extra))
  if (!cond) falhas++
}

const DESCRICAO = 'PAGTO FORNECEDOR ACME 123'
const linha = (id, origem) => ({
  id,
  status: 'conciliado',
  data: { descricao: DESCRICAO, ...(origem ? { conciliado_por: origem } : {}) },
})
const lancamento = (extratoId) => ({
  id: 'l-' + extratoId,
  extrato_id: extratoId,
  data: { supplier: 'ACME', cat: 'Serviços de Terceiros', subcat: 'Manutenção', doc_status: 'dispensado' },
})

// ── Conciliação dela: vira regra ────────────────────────────────────────
const dela = construirRegrasDeConciliacao(
  [linha('e1', 'manual'), linha('e2', 'manual')],
  [lancamento('e1'), lancamento('e2')],
)
ok('conciliação manual ensina', dela.size === 1, String(dela.size))
ok('e a regra guarda a classificação',
  dela.get(chaveDaLinha(DESCRICAO))?.cat === 'Serviços de Terceiros',
  JSON.stringify([...dela.values()][0] || null))

// ── Conciliação do sistema: NÃO vira regra ──────────────────────────────
const dele = construirRegrasDeConciliacao(
  [linha('e1', 'automatico'), linha('e2', 'automatico')],
  [lancamento('e1'), lancamento('e2')],
)
ok('conciliação automática NÃO ensina', dele.size === 0, String(dele.size))

// ── Misturadas: só a dela conta ─────────────────────────────────────────
const misto = construirRegrasDeConciliacao(
  [linha('e1', 'automatico'), linha('e2', 'manual')],
  [lancamento('e1'), lancamento('e2')],
)
ok('numa mistura, a automática é descartada e a manual fica',
  misto.size === 1, String(misto.size))

// ── Sem a marca: conta como decisão humana ──────────────────────────────
//
// É o caso seguro, e é deliberado: conciliação anterior à correção, ou feita
// por um caminho que não informa origem, vale como decisão dela. O contrário
// — descartar o que não tem marca — apagaria o aprendizado todo de uma vez.
const semMarca = construirRegrasDeConciliacao(
  [linha('e1'), linha('e2')],
  [lancamento('e1'), lancamento('e2')],
)
ok('sem marca de origem, conta como decisão dela (caso seguro)',
  semMarca.size === 1, String(semMarca.size))

// ── Rótulo diferente não desliga a guarda por acidente ──────────────────
const rotuloEstranho = construirRegrasDeConciliacao(
  [linha('e1', 'AUTOMATICO'), linha('e2', 'AUTOMATICO')],
  [lancamento('e1'), lancamento('e2')],
)
ok('a comparação é exata: "AUTOMATICO" em maiúsculas não é o rótulo gravado',
  rotuloEstranho.size === 1,
  'se isto falhar, alguém mudou a caixa do rótulo em um dos dois lados')

console.log(falhas ? `\n${falhas} falha(s).` : '\nTodos os casos passaram.')
process.exit(falhas ? 1 : 0)
