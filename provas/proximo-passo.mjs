// ===========================================================================
// PROVA: o "próximo passo" diz o que FAZER, e um de cada vez.
//
// A Juliana, 01/10: "eu olho pra ele e não sei o que fazer". O checklist
// mostrava o nome do item que falhou ("Extrato importado ✕"), não a ação. E
// mostrava dez de uma vez, que é o que faz a pessoa travar.
//
// Rodar: npm run provas
// ===========================================================================
import { proximoPasso } from '../src/lib/fechamentoChecklist.js'

let falhas = 0
const ok = (nome, cond, extra = '') => {
  console.log((cond ? '  OK   ' : '  FALHA') + ' ' + nome + (cond ? '' : ' → ' + extra))
  if (!cond) falhas++
}
const rot = c => c
const mes = (comp, estado, obrig = [], avisos = []) => ({ comp, estado, obrigFalta: obrig, avisosFalta: avisos })
const item = (key, label, detalhe) => ({ key, label, detalhe })

// ── 1. O mais antigo em aberto manda, e só o PRIMEIRO item dele ────────────
{
  const p = proximoPasso([
    mes('2025-05', 'pendente', [item('conciliacao', 'Conciliação completa', '16 linha(s) pendente(s)'), item('escrituracao', 'Escrituração completa', '10 a escriturar')]),
    mes('2025-06', 'pendente', [item('extrato', 'Extrato importado', 'nenhuma linha')]),
  ], rot)
  ok('aponta o mês mais antigo', p.comp === '2025-05', p.comp)
  ok('o texto é uma ORDEM, não o nome do item', p.titulo === 'Concilie as linhas do extrato de 2025-05', p.titulo)
  ok('leva o detalhe junto', p.detalhe === '16 linha(s) pendente(s)')
  ok('explica o porquê', /lançamento dela/.test(p.porque || ''), p.porque)
  ok('manda para a tela certa', p.link === '/conciliacao', p.link)
  ok('avisa que ainda vem mais, sem listar', p.restantes === 1, String(p.restantes))
}

// ── 2. Cada item vira um verbo diferente ───────────────────────────────────
{
  const casos = [
    ['extrato', 'Importe o extrato', '/conciliacao'],
    ['escrituracao', 'Escriture os lançamentos', '/classificar'],
    ['anterior', 'Feche o mês anterior primeiro', '/fechamento-mensal'],
  ]
  for (const [key, verbo, link] of casos) {
    const p = proximoPasso([mes('2025-05', 'pendente', [item(key, key, 'x')])], rot)
    ok(`"${key}" vira "${verbo}"`, p.titulo.startsWith(verbo), p.titulo)
    ok(`"${key}" aponta para ${link}`, p.link === link, p.link)
  }
}

// ── 3. Mês sem trava: a ação é fechar ──────────────────────────────────────
{
  const p = proximoPasso([mes('2025-05', 'pronto', [], [{}, {}])], rot)
  ok('mês pronto manda fechar', p.pronto === true && p.botao === 'Fechar o mês', JSON.stringify(p.botao))
  ok('e avisa quantos avisos viram exceção', /2 aviso/.test(p.detalhe), p.detalhe)
}

// ── 4. Mês corrente e mês fechado não entram na fila ───────────────────────
{
  ok('mês fechado é pulado', proximoPasso([mes('2025-05', 'fechado')], rot) === null)
  ok('mês corrente é pulado', proximoPasso([mes('2026-10', 'corrente')], rot) === null)
  ok('nada em aberto → null', proximoPasso([], rot) === null)
  const p = proximoPasso([mes('2025-05', 'fechado'), mes('2025-06', 'pendente', [item('extrato', 'Extrato', 'x')])], rot)
  ok('pula o fechado e pega o seguinte', p.comp === '2025-06', p.comp)
}

// ── 5. Item desconhecido não quebra a tela ─────────────────────────────────
{
  const p = proximoPasso([mes('2025-05', 'pendente', [item('inventado', 'Coisa Nova', 'detalhe')])], rot)
  ok('item sem tradução ainda produz uma ordem', /Resolva "Coisa Nova"/.test(p.titulo), p.titulo)
  ok('e um destino', !!p.link, p.link)
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTodos os casos passaram.')
process.exit(falhas ? 1 : 0)
