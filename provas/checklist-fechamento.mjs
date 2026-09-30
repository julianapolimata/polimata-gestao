// ===========================================================================
// PROVA: o checklist do fechamento — o portão do ano.
//
// Fechar um mês trava os lançamentos daquela competência no BANCO (REGRAS.md,
// regra 5). Se o checklist deixar fechar cedo demais, ela tranca número errado
// e só sai de lá com reabertura justificada. Se travar à toa, o ano não fecha.
//
// A promessa da tela: "o checklist é DETECTADO DOS DADOS (nada marcado à mão)"
// e o mês só fecha "em ordem cronológica". É isso que está provado aqui.
//
// Rodar: npm run provas
// ===========================================================================
import { montarChecklist, PONTAS, PONTA_DO_ITEM } from '../src/lib/fechamentoChecklist.js'

const MES = '2026-03'
const CONTA = 'conta-corrente-1'
const CARTAO = 'cartao-1'

let falhas = 0
const ok = (nome, cond, extra = '') => {
  console.log((cond ? '  OK   ' : '  FALHA') + ' ' + nome + (cond ? '' : ' → ' + extra))
  if (!cond) falhas++
}

// Um mês "limpo": tudo que o checklist exige, satisfeito.
function contexto(over = {}) {
  return {
    extratos: [{ id: 'e1', conta_id: CONTA, status: 'conciliado', dt: `${MES}-05` }],
    receivable: [],
    payable: [],
    contas: [{ id: CONTA, data: { nome: 'Sicoob - Conta Corrente', tipo: 'corrente' } }],
    transferencias: [],
    fechamentos: [],
    nfPend: [],
    temFechamento: false,
    mesesComMovimento: new Set([MES]),
    ...over,
  }
}
const item = (ctx, key) => montarChecklist(MES, ctx).find(i => i.key === key)
const trava = ctx => montarChecklist(MES, ctx).filter(i => i.obrigatorio && !i.ok).map(i => i.key)

const lanc = (o = {}) => ({ id: 'l1', comp: `${MES}-10`, due: `${MES}-10`, st: 'Pago', esc: 'true', doc: 'vinculado', val: '100', conciliado_em: '2026-04-01', ...o })

// ── 1. Mês limpo fecha ─────────────────────────────────────────────────────
{
  ok('mês sem pendência não tem obrigatório faltando', trava(contexto()).length === 0, trava(contexto()).join(','))
}

// ── 2. O que TRAVA o fechamento ────────────────────────────────────────────
{
  ok('extrato não importado trava', trava(contexto({ extratos: [] })).includes('extrato'),
    trava(contexto({ extratos: [] })).join(','))

  const pendente = contexto({ extratos: [{ id: 'e1', conta_id: CONTA, status: 'pendente', dt: `${MES}-05` }] })
  ok('linha de extrato pendente trava', trava(pendente).includes('conciliacao'), trava(pendente).join(','))

  const naoEscriturado = contexto({ payable: [lanc({ esc: 'false' })] })
  ok('lançamento a escriturar trava', trava(naoEscriturado).includes('escrituracao'), trava(naoEscriturado).join(','))
}

// ── 3. O que NÃO trava — avisos ────────────────────────────────────────────
// Eles não impedem o fechamento, mas ficam registrados como exceção aceita.
// Confundir aviso com obrigatório é o que faz um sistema virar burocracia.
{
  const casos = [
    ['nf_pendente', contexto({ payable: [lanc({ doc: 'pendente' })] })],
    ['suspense', contexto({ payable: [lanc({ sus: 'true' })] })],
    ['liquidadas', contexto({ payable: [lanc({ st: 'Pendente' })] })],
    ['conferencia_bancaria', contexto({ payable: [lanc({ conciliado_em: null })] })],
    ['caixa_entrada', contexto({ nfPend: [{ id: 'nf1', created_at: `${MES}-20T10:00:00` }] })],
  ]
  for (const [key, ctx] of casos) {
    const i = item(ctx, key)
    ok(`"${i.label}" acusa o problema`, i.ok === false, JSON.stringify(i))
    ok(`"${i.label}" NÃO trava o fechamento`, trava(ctx).length === 0, trava(ctx).join(','))
  }
}

// ── 4. Ordem cronológica ───────────────────────────────────────────────────
// O mês anterior só é exigido depois que existe algum fechamento — senão o
// primeiro mês da vida da empresa nunca fecharia.
{
  const semNenhum = contexto({ temFechamento: false, mesesComMovimento: new Set(['2026-02', MES]) })
  ok('primeiro fechamento da vida não exige mês anterior',
    !montarChecklist(MES, semNenhum).some(i => i.key === 'anterior'))

  const anteriorAberto = contexto({
    temFechamento: true,
    mesesComMovimento: new Set(['2026-02', MES]),
    fechamentos: [{ competencia: '2026-01', status: 'fechado' }],
  })
  ok('com histórico, mês anterior em aberto TRAVA', trava(anteriorAberto).includes('anterior'),
    trava(anteriorAberto).join(','))

  const anteriorFechado = contexto({
    temFechamento: true,
    mesesComMovimento: new Set(['2026-02', MES]),
    fechamentos: [{ competencia: '2026-02', status: 'fechado' }],
  })
  ok('mês anterior fechado libera', trava(anteriorFechado).length === 0, trava(anteriorFechado).join(','))

  const semMovimento = contexto({ temFechamento: true, mesesComMovimento: new Set([MES]) })
  ok('mês anterior SEM movimento não é exigido',
    !montarChecklist(MES, semMovimento).some(i => i.key === 'anterior'))
}

// ── 5. "Pago" tem dois significados (REGRAS.md, regra 3) ───────────────────
// Baixa conciliada é constatação; baixa à mão é afirmação. O fechamento conta
// as segundas, mas não impede — quem decide fechar assim é quem fecha.
{
  const afirmado = contexto({ payable: [lanc({ conciliado_em: null, val: '1500' })] })
  const i = item(afirmado, 'conferencia_bancaria')
  ok('baixa sem conciliação é contada', i.ok === false && /1 baixa/.test(i.detalhe), i.detalhe)
  ok('e o valor aparece', /1\.500/.test(i.detalhe), i.detalhe)

  const constatado = contexto({ payable: [lanc({ conciliado_em: '2026-04-02' })] })
  ok('baixa conciliada não é cobrada', item(constatado, 'conferencia_bancaria').ok === true)
}

// ── 6. Provisão não é lançamento do mês ────────────────────────────────────
{
  const provisao = contexto({ payable: [lanc({ esc: 'false', st: 'Provisão' })] })
  ok('provisão não trava a escrituração', trava(provisao).length === 0, trava(provisao).join(','))
}

// ── 7. Guia de imposto é o que a empresa RECOLHE ───────────────────────────
// "Impostos retidos na fonte" fica de fora de propósito: é dedução da receita,
// criada já quitada na conciliação — não é conta a pagar.
{
  const daberto = contexto({ payable: [lanc({ cat: 'Impostos sobre Receita', st: 'Pendente' })] })
  ok('DAS em aberto acusa', item(daberto, 'impostos').ok === false, JSON.stringify(item(daberto, 'impostos')))

  const retido = contexto({ payable: [lanc({ cat: 'Impostos retidos na fonte', st: 'Pendente' })] })
  ok('imposto RETIDO não conta como guia em aberto', item(retido, 'impostos').ok === true,
    JSON.stringify(item(retido, 'impostos')))

  const semGuia = contexto()
  ok('sem guia lançada, diz isso', /nenhuma guia/.test(item(semGuia, 'impostos').detalhe),
    item(semGuia, 'impostos').detalhe)
}

// ── 8. Fatura do cartão ────────────────────────────────────────────────────
{
  const semCartao = contexto()
  ok('sem cartão cadastrado, o item nem aparece', !montarChecklist(MES, semCartao).some(i => i.key === 'fatura'))

  const comCartao = over => contexto({
    contas: [
      { id: CONTA, data: { nome: 'Sicoob', tipo: 'corrente' } },
      { id: CARTAO, data: { nome: 'Sicoob Crédito', tipo: 'cartao' } },
    ],
    payable: [lanc({ cartao_id: CARTAO, val: '500' })],
    ...over,
  })
  ok('fatura sem pagamento acusa', item(comCartao(), 'fatura').ok === false,
    item(comCartao(), 'fatura').detalhe)
  const paga = comCartao({ transferencias: [{ para_conta_id: CARTAO, data: `${MES}-22`, valor: '500' }] })
  ok('fatura paga fecha o item', item(paga, 'fatura').ok === true, item(paga, 'fatura').detalhe)
}

// ── 9. A caixa de entrada olha até o FIM do mês ────────────────────────────
// O corte é feito por comparação de TEXTO com "<comp>-31", que funciona em
// qualquer mês porque nenhuma data real passa de 31. Fica provado para que
// ninguém "conserte" isso para uma data de verdade e quebre fevereiro.
{
  const fev = {
    ...contexto({ nfPend: [{ id: 'nf1', created_at: '2026-02-28T23:00:00' }] }),
    extratos: [{ id: 'e1', conta_id: CONTA, status: 'conciliado', dt: '2026-02-05' }],
  }
  const i = montarChecklist('2026-02', fev).find(x => x.key === 'caixa_entrada')
  ok('NF de 28/02 conta no fechamento de fevereiro', i.ok === false, JSON.stringify(i))

  const depois = contexto({ nfPend: [{ id: 'nf1', created_at: '2026-04-02T10:00:00' }] })
  ok('NF criada depois do mês não conta', item(depois, 'caixa_entrada').ok === true,
    JSON.stringify(item(depois, 'caixa_entrada')))
}

// ── 10. Cada item declara a sua ponta ──────────────────────────────────────
{
  const itens = montarChecklist(MES, contexto())
  ok('todo item tem ponta', itens.every(i => i.ponta), JSON.stringify(itens.filter(i => !i.ponta)))
  ok('toda ponta declarada existe na lista de pontas',
    itens.every(i => PONTAS.some(p => p.id === i.ponta)),
    JSON.stringify([...new Set(itens.map(i => i.ponta))]))
  ok('extrato e conciliação são do CAIXA',
    PONTA_DO_ITEM.extrato === 'caixa' && PONTA_DO_ITEM.conciliacao === 'caixa')
  ok('escrituração e notas são do DOCUMENTO',
    PONTA_DO_ITEM.escrituracao === 'documento' && PONTA_DO_ITEM.nf_pendente === 'documento')
}

// ── 11. Nada é marcado à mão ───────────────────────────────────────────────
// A promessa da tela. Um item que viesse ok sem nenhum dado por trás seria
// exatamente o que o portão não pode ter.
{
  const vazio = {
    extratos: [], receivable: [], payable: [], contas: [], transferencias: [],
    fechamentos: [], nfPend: [], temFechamento: false, mesesComMovimento: new Set(),
  }
  const itens = montarChecklist(MES, vazio)
  ok('sem conta bancária cadastrada, o extrato não passa',
    itens.find(i => i.key === 'extrato').ok === false,
    JSON.stringify(itens.find(i => i.key === 'extrato')))
  ok('todo item traz um detalhe explicando o estado', itens.every(i => typeof i.detalhe === 'string' && i.detalhe.length > 0),
    JSON.stringify(itens.filter(i => !i.detalhe)))
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTodos os casos passaram.')
process.exit(falhas ? 1 : 0)
