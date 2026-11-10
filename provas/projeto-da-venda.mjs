// ===========================================================================
// PROVA: da venda ao faturamento.
//
// Os dois casos reais, decididos com ela em 09/11/2026:
//
//   BRASCABOS   cliente desde 2023, renovação todo ano. Cada ciclo é uma
//               venda nova — uma oportunidade e um projeto por ano, com o
//               novo apontando para o anterior.
//   PLANCUS     dois projetos pontuais, começo e fim, com faturamento que
//               precisa ser ligado às entradas.
//
// E o que isto NÃO faz: criar projeto sozinho. Foi um gatilho automático de
// "prospect fechado vira projeto" que deixou duas cascas de R$ 0 no sistema.
//
// Rodar: npm run provas
// ===========================================================================
import {
  projetoDaOportunidade, faturamentoPorProjeto, confrontoDoProjeto,
  cadeiaDeRenovacao, ultimoProjetoDaPessoa, nomeDoProjeto, projetoUnicoDaPessoa,
} from '../src/lib/projetoDaVenda.js'

let falhas = 0
const ok = (nome, cond, extra = '') => {
  console.log((cond ? '  OK   ' : '  FALHA') + ' ' + nome + (cond ? '' : ' → ' + extra))
  if (!cond) falhas++
}

const brascabos = { id: 'pessoa-bras', data: { nome: 'BRASCABOS COMPONENTES LTDA', fantasia: 'Brascabos' } }

// ── O primeiro ciclo ────────────────────────────────────────────────────
const venda2023 = {
  id: 'op-2023',
  data: { pessoa_id: 'pessoa-bras', situacao: 'ganha', valor_estimado: 48000,
    descricao: 'Controles Internos', data_proposta: '2023-02-10' },
}
const p2023 = projetoDaOportunidade(venda2023, brascabos, null, '2026-11-09')
ok('o projeto aponta para a pessoa por identificador', p2023.pessoa_id === 'pessoa-bras', p2023.pessoa_id)
ok('e para a oportunidade que o gerou', p2023.oportunidade_id === 'op-2023', p2023.oportunidade_id)
ok('o primeiro ciclo é 1 e não renova ninguém',
  p2023.ciclo === 1 && p2023.renovacao_de === null, `${p2023.ciclo} / ${p2023.renovacao_de}`)
ok('o valor vem da venda', p2023.value === 48000, String(p2023.value))
ok('a data de início é a da proposta', p2023.start === '2023-02-10', p2023.start)
ok('o nome do primeiro ciclo não carrega número',
  p2023.name === 'Brascabos — Controles Internos', p2023.name)
ok('a referência NÃO é copiada para o projeto: ela se lê da oportunidade',
  p2023.codigo === undefined && p2023.numero_proposta === undefined, '')

// ── A renovação ─────────────────────────────────────────────────────────
const anterior = { id: 'prj-2023', data: { ...p2023, ciclo: 1 } }
const venda2024 = {
  id: 'op-2024',
  data: { pessoa_id: 'pessoa-bras', situacao: 'ganha', valor_estimado: 52000,
    descricao: 'Controles Internos', data_proposta: '2024-02-05' },
}
const p2024 = projetoDaOportunidade(venda2024, brascabos, anterior, '2026-11-09')
ok('a renovação é o ciclo seguinte', p2024.ciclo === 2, String(p2024.ciclo))
ok('e aponta para o projeto que renova', p2024.renovacao_de === 'prj-2023', String(p2024.renovacao_de))
ok('o nome do ciclo 2 diz que é ciclo 2',
  p2024.name === 'Brascabos — Controles Internos — ciclo 2/2024', p2024.name)
ok('a nota registra de qual ciclo veio', /Renovação do ciclo 1/.test(p2024.notes), p2024.notes)
ok('cada ciclo tem o seu próprio valor', p2024.value === 52000, String(p2024.value))

// ── A linha do tempo ────────────────────────────────────────────────────
const prj2024 = { id: 'prj-2024', data: p2024 }
const p2025 = projetoDaOportunidade(
  { id: 'op-2025', data: { pessoa_id: 'pessoa-bras', valor_estimado: 55000, descricao: 'Controles Internos', data_proposta: '2025-02-01' } },
  brascabos, prj2024, '2026-11-09')
const prj2025 = { id: 'prj-2025', data: p2025 }
const todos = [anterior, prj2024, prj2025]
const cadeia = cadeiaDeRenovacao(todos, 'prj-2025')
ok('a cadeia vai do primeiro ao último, em ordem',
  cadeia.map(p => p.id).join(' → ') === 'prj-2023 → prj-2024 → prj-2025',
  cadeia.map(p => p.id).join(' → '))
ok('elo quebrado interrompe, em vez de inventar',
  cadeiaDeRenovacao([prj2025], 'prj-2025').length === 1, '')
ok('o candidato a renovar é o ciclo mais alto',
  ultimoProjetoDaPessoa(todos, 'pessoa-bras').id === 'prj-2025', '')
ok('pessoa sem projeto não tem candidato',
  ultimoProjetoDaPessoa(todos, 'pessoa-nova') === null, '')

// ── O faturamento, que é o que ela pediu ────────────────────────────────
const receitas = [
  { data: { projeto_id: 'prj-2025', value: 4583.33, status: 'Recebido' } },
  { data: { projeto_id: 'prj-2025', value: 4583.33, status: 'Recebido' } },
  { data: { projeto_id: 'prj-2025', value: 4583.33, status: 'Pendente' } },
  { data: { projeto_id: 'prj-2023', value: 48000, data_pagamento: '2023-03-10' } },
  { data: { value: 1200, status: 'Recebido' } }, // sem projeto: fora da conta
]
const fat = faturamentoPorProjeto(receitas)
ok('o recebido e o a receber ficam separados',
  fat.get('prj-2025').recebido === 9166.66 && fat.get('prj-2025').aReceber === 4583.33,
  JSON.stringify(fat.get('prj-2025')))
ok('lançamento com data de pagamento conta como recebido',
  fat.get('prj-2023').recebido === 48000, String(fat.get('prj-2023').recebido))
ok('receita sem projeto não entra em projeto nenhum', fat.size === 2, String(fat.size))

const conf = confrontoDoProjeto(prj2025, fat.get('prj-2025'))
ok('o confronto mostra o vendido e o faturado',
  conf.vendido === 55000 && conf.faturado === 13749.99, JSON.stringify(conf))
ok('e a diferença diz quanto ainda falta faturar',
  conf.diferenca === -41250.01, String(conf.diferenca))
ok('projeto sem valor vendido não tem diferença — zero afirmaria estar em dia',
  confrontoDoProjeto({ data: { value: 0 } }, fat.get('prj-2025')).diferenca === null, '')
ok('projeto sem faturamento nenhum não quebra',
  confrontoDoProjeto(prj2025, undefined).faturado === 0, '')

// ── O nome ──────────────────────────────────────────────────────────────
ok('sem descrição, o nome é só o cliente',
  nomeDoProjeto({ nomePessoa: 'Plancus', ciclo: 1 }) === 'Plancus', '')
ok('sem nome de pessoa, não sai vazio',
  nomeDoProjeto({ ciclo: 1 }) === 'Projeto', nomeDoProjeto({ ciclo: 1 }))

// ── A receita que chega pela nota precisa achar o projeto ───────────────
// Achado na auditoria de 10/11/2026: o caminho normal da receita e a nota
// aprovada na Caixa de entrada, e por ali o lancamento nascia sem projeto.
const umSo = [{ id: "prj-1", data: { pessoa_id: "p1", status: "Em andamento" } }]
ok("um projeto aberto resolve sozinho",
  projetoUnicoDaPessoa(umSo, "p1") === "prj-1", String(projetoUnicoDaPessoa(umSo, "p1")))
const dois = [
  { id: "prj-1", data: { pessoa_id: "p1", status: "Em andamento" } },
  { id: "prj-2", data: { pessoa_id: "p1", status: "Em planejamento" } },
]
ok("dois projetos abertos NAO sao adivinhados",
  projetoUnicoDaPessoa(dois, "p1") === null, String(projetoUnicoDaPessoa(dois, "p1")))
const comEncerrado = [
  { id: "prj-1", data: { pessoa_id: "p1", status: "Encerrado" } },
  { id: "prj-2", data: { pessoa_id: "p1", status: "Em andamento" } },
]
ok("projeto encerrado nao concorre: receita nova nao e de trabalho que acabou",
  projetoUnicoDaPessoa(comEncerrado, "p1") === "prj-2", String(projetoUnicoDaPessoa(comEncerrado, "p1")))
ok("pessoa sem projeto devolve nulo", projetoUnicoDaPessoa(umSo, "p9") === null, "")
ok("sem pessoa, nao procura", projetoUnicoDaPessoa(umSo, null) === null, "")

console.log(falhas ? `\n${falhas} falha(s).` : '\nTodos os casos passaram.')
process.exit(falhas ? 1 : 0)
