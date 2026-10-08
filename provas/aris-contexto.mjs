// A Aris agora responde sobre o sistema inteiro, em qualquer tela. É a versão
// dela em que inventar fica mais barato — e por isso o que se prova aqui não é
// a resposta (que vem de um modelo), e sim O QUE VAI JUNTO DELA.
//
// A regra: o modelo nunca calcula nada. Ele lê números que o sistema somou.
// É essa separação que impede o "aproximadamente uns R$ 80 mil", que soa certo
// e não é conferível.
import {
  montarContexto, historicoRelevante, palavrasDe, planoEmTexto, resumoEmTexto,
  SYSTEM_CONVERSA, MAX_HISTORICO,
} from '../src/lib/arisContexto.js'

let falhas = 0
const ok = (cond, oque) => { if (!cond) { falhas++; console.error('  X ' + oque) } }

const plano = [
  { tipo: 'Saída', categoria: 'Despesas Financeiras', subcategoria: 'IOF', classificacao: 'Despesas Financeiras' },
  { tipo: 'Saída', categoria: 'Despesas Financeiras', subcategoria: 'Tarifas bancárias', classificacao: 'Despesas Financeiras' },
  { tipo: 'Entrada', categoria: 'Receita de Serviços', subcategoria: 'Consultoria', classificacao: 'Receita Operacional' },
]

const historico = [
  { tipo: 'Saída', parte: 'Sicoob', descricao: 'DÉB.IOF', cat: 'Despesas Financeiras', subcat: 'IOF', vezes: 22, ultima: '2026-08-03' },
  { tipo: 'Saída', parte: 'Sicoob', descricao: 'TARIFA PACOTE DE SERVICOS', cat: 'Despesas Financeiras', subcat: 'Tarifas bancárias', vezes: 11, ultima: '2026-07-01' },
  { tipo: 'Entrada', parte: 'Brascabos', descricao: 'CRÉD.TED BRASCABOS', cat: 'Receita de Serviços', subcat: 'Consultoria', vezes: 7, ultima: '2025-12-10' },
]

const resumo = {
  lancamentos: 556, realizados: 346, entradas: 210700.55, saidas: 150320.10,
  aPagar: 12000, aReceber: 3000, contas: 4, extratoPendente: 324,
  porClassificacao: [{ classificacao: 'Receita Operacional', valor: 210700.55 }],
}

// ── O MODELO NÃO CALCULA: ELE LÊ ─────────────────────────────────────────
const texto = resumoEmTexto(resumo)
ok(texto.includes('210.700,55'), 'o número vai formatado e pronto, não para o modelo somar')
ok(texto.includes('556') && texto.includes('346'), 'quantidades vão explícitas')
ok(texto.includes('324'), 'o que ainda falta classificar também entra')
ok(resumoEmTexto(null).includes('não carregou'),
  'sem resumo, o contexto DIZ que não carregou em vez de omitir em silêncio')

// ── O HISTÓRICO ENTRA FILTRADO PELA PERGUNTA ─────────────────────────────
// Despejar as 434 linhas em toda pergunta é pagar caro por ruído, e contexto
// grande faz o modelo escolher o número errado entre vinte parecidos.
const sobreTarifa = historicoRelevante('como eu classifico tarifa de banco?', historico)
ok(sobreTarifa[0].subcat === 'Tarifas bancárias', 'a pergunta puxa o histórico que fala dela')
ok(!sobreTarifa.some(h => h.cat === 'Receita de Serviços'), 'e deixa de fora o que não tem a ver')

const semPalavra = historicoRelevante('e aí?', historico)
ok(semPalavra.length === 3 && semPalavra[0].vezes === 22,
  'pergunta sem palavra útil recebe o retrato geral, do mais usado para o menos')

const semCasar = historicoRelevante('abacaxi roxo quadrado', historico)
ok(semCasar.length > 0, 'nada casou → manda o retrato geral em vez de contexto vazio')

ok(historicoRelevante('iof', Array.from({ length: 200 }, (_, i) =>
  ({ tipo: 'Saída', parte: 'x', descricao: 'IOF ' + i, cat: 'Despesas Financeiras', subcat: 'IOF', vezes: 1, ultima: '2026-01-01' })
)).length === MAX_HISTORICO, 'o contexto tem teto: no máximo ' + MAX_HISTORICO + ' linhas de histórico')

// Palavras curtas e comuns não ajudam a achar nada.
ok(!palavrasDe('qual é o meu valor para isso').includes('valor'), '"valor" não é palavra de busca')
ok(palavrasDe('quanto paguei de tarifa bancária').includes('tarifa'), 'palavra de conteúdo é')
ok(palavrasDe('o que é IOF?').length === 0 || !palavrasDe('o que é IOF?').includes('que'),
  'palavra de ligação fica de fora')

// ── O CONTEXTO MONTADO ───────────────────────────────────────────────────
const { texto: ctx, usouHistorico } = montarContexto({
  pergunta: 'quanto eu paguei de tarifa?', plano, historico, resumo, tela: 'Conciliação',
})
ok(ctx.includes('tela: Conciliação'), 'a Aris sabe em que tela a pergunta foi feita')
ok(ctx.includes('NÚMEROS DO SISTEMA'), 'os números vão no contexto')
ok(ctx.includes('PLANO DE CONTAS DELA'), 'o plano vai no contexto')
ok(ctx.includes('Tarifas bancárias'), 'a evidência relevante vai no contexto')
ok(usouHistorico.length > 0, 'e quem chama recebe o que foi usado, para mostrar na tela')

// A tela mostra "no que me apoiei" com ISTO. Evidência que não aparece na tela
// não serve de evidência — foi a régua que ela me cobrou.
ok(usouHistorico[0].vezes === 11 || usouHistorico[0].vezes === 22,
  'o apoio devolvido é a linha real do histórico, com a contagem')

// ── O PLANO, COMPACTO ────────────────────────────────────────────────────
const pTexto = planoEmTexto(plano)
ok(pTexto.includes('IOF, Tarifas bancárias'), 'subcategorias da mesma categoria vão juntas, não repetidas')
ok(pTexto.includes('[DRE: Despesas Financeiras]'), 'o grupo da DRE acompanha a categoria')
ok(pTexto.split('\n').length === 2, 'três linhas de plano viram duas categorias')

// ── AS REGRAS, QUE SÃO O PRODUTO ─────────────────────────────────────────
ok(/NUNCA invente número/i.test(SYSTEM_CONVERSA), 'proibido inventar número')
ok(/NUNCA cite norma, lei, NBC, CPC/i.test(SYSTEM_CONVERSA), 'proibido citar norma')
ok(/não tem esse dado aqui e indique qual tela/i.test(SYSTEM_CONVERSA),
  'sem o dado, manda dizer que não tem E em que tela está')
ok(/"Não sei" é resposta válida/i.test(SYSTEM_CONVERSA), '"não sei" continua sendo resposta')
ok(/SOMENTE categorias que estejam no plano/i.test(SYSTEM_CONVERSA), 'classificação só do plano dela')
ok(/Mostre a evidência junto/i.test(SYSTEM_CONVERSA), 'evidência junto da resposta')

if (falhas) { console.error(falhas + ' falha(s)'); process.exit(1) }
console.log('  ok: a Aris responde com os números do sistema, filtrados pela pergunta, com o apoio à vista')
