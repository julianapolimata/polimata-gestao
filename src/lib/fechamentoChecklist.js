// =============================================================================
// CHECKLIST DO FECHAMENTO — a regra que decide se um mês PODE fechar.
//
// Fica aqui, e não dentro da tela, por dois motivos: é o portão do ano inteiro
// (nada fecha fora de ordem, e mês fechado trava no banco), e regra de portão
// precisa de prova — dentro do .jsx não dava para testá-la sem montar React.
//
// Tudo é DERIVADO DOS DADOS: não existe item marcado à mão. Item obrigatório
// que falta impede o fechamento; aviso que falta não impede, mas fica
// registrado como exceção aceita no ato de fechar.
// =============================================================================
import { fmtMoney } from './finance'
import { mesFechado, mesLabel } from './fechamento'

const ym = s => (s || '').slice(0, 7)
const mesAnterior = comp => {
  const [y, m] = comp.split('-').map(Number)
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// ── Checklist de um mês, derivado dos dados ───────────────────────────
// Quatro estados, nesta ordem de urgência:
//   trava — obrigatório faltando: o mês não fecha
//   aviso — não trava, mas fica registrado como exceção ao fechar
//   feito — havia trabalho e está resolvido
//   nada  — "ok" só porque não havia nada a fazer. Não é conquista, e mostrar
//           isso em verde ensina a pessoa a não confiar no checklist.
export function estadoDoItem(i) {
  if (!i.ok) return i.obrigatorio ? 'trava' : 'aviso'
  return i.vazio ? 'nada' : 'feito'
}

const ORDEM_ESTADO = { trava: 0, aviso: 1, feito: 2, nada: 3 }
export const ordenarPorUrgencia = itens =>
  [...itens].sort((a, b) => ORDEM_ESTADO[estadoDoItem(a)] - ORDEM_ESTADO[estadoDoItem(b)])

export const VISUAL_ESTADO = {
  trava: { tom: 'ruim', simbolo: '✕', icone: '🔴', cor: 'var(--red)' },
  aviso: { tom: 'alerta', simbolo: '!', icone: '⚠️', cor: 'var(--gold-dark)' },
  feito: { tom: 'ok', simbolo: '✓', icone: '✅', cor: 'var(--green)' },
  nada: { tom: 'vazio', simbolo: '–', icone: '–', cor: 'var(--text-mid)' },
}

export function montarChecklist(comp, ctx) {
  const { extratos, receivable, payable, contas, transferencias, fechamentos, nfPend, temFechamento, mesesComMovimento } = ctx
  const items = []
  const lancs = [...receivable.map(r => ({ ...r, _t: 'rec' })), ...payable.map(p => ({ ...p, _t: 'pay' }))]
  const compDe = l => ym(l.comp || l.due)
  const doMes = lancs.filter(l => compDe(l) === comp && l.st !== 'Provisão')
  const contasAtivas = contas.filter(c => c.data?.ativo !== false)
  const contasBanco = contasAtivas.filter(c => c.data?.tipo !== 'cartao')
  const cartoes = contasAtivas.filter(c => c.data?.tipo === 'cartao')
  const nomeConta = c => c.data?.nome || c.data?.banco || 'Conta'

  // 1. Extrato importado (obrigatório) — cada conta bancária (não cartão) tem linhas no mês
  {
    const partes = contasBanco.map(c => {
      const n = extratos.filter(e => e.conta_id === c.id && ym(e.dt) === comp).length
      return { ok: n > 0, txt: `${nomeConta(c)}: ${n > 0 ? `${n} linha(s)` : 'nenhuma linha'}` }
    })
    items.push({
      key: 'extrato', label: 'Extrato importado', obrigatorio: true,
      ok: partes.length > 0 && partes.every(p => p.ok),
      detalhe: partes.length ? partes.map(p => p.txt).join(' · ') : 'nenhuma conta bancária ativa cadastrada',
      link: '/conciliacao',
    })
  }

  // 2. Conciliação completa (obrigatório) — nenhuma linha pendente (todas as contas, cartão incluído)
  {
    const pend = extratos.filter(e => ym(e.dt) === comp && e.status === 'pendente')
    const porConta = new Map()
    for (const e of pend) porConta.set(e.conta_id, (porConta.get(e.conta_id) || 0) + 1)
    const det = [...porConta.entries()].map(([id, n]) => `${nomeConta(contas.find(c => c.id === id) || {})}: ${n} pendente(s)`).join(' · ')
    items.push({
      key: 'conciliacao', label: 'Conciliação completa', obrigatorio: true,
      ok: pend.length === 0,
      // Sem nenhuma linha no mês, "tudo resolvido" é vacuidade.
      vazio: extratos.filter(e => ym(e.dt) === comp).length === 0,
      detalhe: pend.length
        ? `${pend.length} linha(s) pendente(s) — ${det}`
        : (extratos.filter(e => ym(e.dt) === comp).length === 0
            ? 'não há linha de extrato neste mês'
            : 'todas as linhas do extrato resolvidas'),
      link: '/conciliacao',
    })
  }

  // 3. Escrituração completa (obrigatório)
  {
    const n = doMes.filter(l => l.esc !== 'true').length
    items.push({ key: 'escrituracao', label: 'Escrituração completa', obrigatorio: true, ok: n === 0, vazio: doMes.length === 0, detalhe: n ? `${n} a escriturar` : (doMes.length ? 'tudo escriturado' : 'não há lançamento neste mês'), link: '/classificar' })
  }

  // 4. Sem NF pendente (aviso)
  {
    const n = doMes.filter(l => l.doc === 'pendente').length
    items.push({ key: 'nf_pendente', label: 'Nenhuma nota a chegar', obrigatorio: false, ok: n === 0, vazio: doMes.length === 0, detalhe: n ? `${n} lançamento(s) marcados como "A nota vai chegar"` : 'nenhuma nota a chegar', link: '/classificar' })
  }

  // 5. Sem suspense (aviso)
  {
    const n = doMes.filter(l => l.sus === 'true').length
    items.push({ key: 'suspense', label: 'Sem suspense', obrigatorio: false, ok: n === 0, vazio: doMes.length === 0, detalhe: n ? `${n} lançamento(s) em suspense` : 'nada em suspense', link: '/conciliacao' })
  }

  // 6. Contas do mês liquidadas (aviso) — por VENCIMENTO
  {
    const abertos = lancs.filter(l => ym(l.due) === comp && l.st !== 'Provisão' && l.st !== 'Recebido' && l.st !== 'Pago')
    const total = abertos.reduce((s, l) => s + Number(l.val || 0), 0)
    items.push({
      key: 'liquidadas', label: 'Contas do mês liquidadas', obrigatorio: false,
      ok: abertos.length === 0,
      vazio: lancs.filter(l => ym(l.due) === comp && l.st !== 'Provisão').length === 0,
      detalhe: abertos.length ? `${abertos.length} em aberto · ${fmtMoney(total)}` : 'tudo pago/recebido',
      link: abertos.some(l => l._t === 'pay') || !abertos.length ? '/pagar' : '/receber',
    })
  }

  // 6b. Baixas com prova no extrato (aviso)
  //
  // "Pago" pode ter dois significados: apareceu no extrato, ou alguém afirmou
  // que pagou. O primeiro é constatação, o segundo é declaração — e fechar o
  // mês sem saber a diferença é fechar em cima de afirmação.
  {
    const semProva = lancs.filter(l => ym(l.due) === comp
      && (l.st === 'Pago' || l.st === 'Recebido')
      && !l.conciliado_em)
    const total = semProva.reduce((s, l) => s + Number(l.val || 0), 0)
    items.push({
      key: 'conferencia_bancaria',
      label: 'Baixas conferidas no extrato',
      obrigatorio: false,
      ok: semProva.length === 0,
      vazio: lancs.filter(l => ym(l.due) === comp && (l.st === 'Pago' || l.st === 'Recebido')).length === 0,
      detalhe: semProva.length
        ? `${semProva.length} baixa(s) sem conferência · ${fmtMoney(total)}`
        : 'toda baixa do mês tem prova no extrato',
      link: '/conciliacao',
    })
  }

  // 7. Fatura do cartão paga (aviso; só se houver cartão)
  if (cartoes.length) {
    const partes = cartoes.map(c => {
      const fatura = payable.filter(p => p.cartao_id === c.id && ym(p.due) === comp).reduce((s, p) => s + Number(p.val || 0), 0)
      const pago = transferencias.filter(t => t.para_conta_id === c.id && ym(t.data) === comp).reduce((s, t) => s + Number(t.valor || 0), 0)
      return { ok: fatura <= pago + 0.01, txt: `${nomeConta(c)}: fatura ${fmtMoney(fatura)} · pago ${fmtMoney(pago)}` }
    })
    items.push({
      key: 'fatura', label: 'Fatura do cartão paga', obrigatorio: false,
      ok: partes.every(p => p.ok),
      vazio: cartoes.every(c => payable.filter(p => p.cartao_id === c.id && ym(p.due) === comp).length === 0),
      detalhe: partes.map(p => p.txt).join(' · '), link: '/conferencia-fatura',
    })
  }

  // 8. DAS / impostos pagos (aviso)
  {
    // Guia de imposto = o que a empresa RECOLHE (DAS, INSS, FGTS, taxas).
    // "Impostos retidos na fonte" fica de fora de propósito: é dedução da
    // receita, criada já quitada na conciliação — não é conta a pagar.
    const CATS_GUIA = ['Impostos sobre Receita', 'Impostos sobre Folha', 'Outros Tributos']
    const guias = payable.filter(p => compDe(p) === comp && p.st !== 'Provisão' && CATS_GUIA.includes(String(p.cat || '')))
    const abertas = guias.filter(p => p.st !== 'Pago')
    items.push({
      key: 'impostos', label: 'DAS / impostos pagos', obrigatorio: false,
      ok: abertas.length === 0,
      vazio: guias.length === 0,
      detalhe: !guias.length ? 'nenhuma guia lançada' : abertas.length ? `${abertas.length} guia(s) em aberto · ${fmtMoney(abertas.reduce((s, p) => s + Number(p.val || 0), 0))}` : `${guias.length} guia(s) paga(s)`,
      link: '/simples-nacional',
    })
  }

  // 9. Caixa de entrada vazia (aviso) — NFs do e-mail pendentes criadas até o fim do mês
  {
    const fim = `${comp}-31T23:59:59`
    const n = nfPend.filter(nf => String(nf.created_at || '') <= fim).length
    items.push({ key: 'caixa_entrada', label: 'Caixa de entrada vazia', obrigatorio: false, ok: n === 0, vazio: nfPend.length === 0, detalhe: n ? `${n} NF(s) do e-mail aguardando revisão` : 'nenhuma NF aguardando', link: '/importar-nfs' })
  }

  // 10. Mês anterior fechado (obrigatório; só se já existe algum fechamento e o mês anterior tem movimento)
  {
    const prev = mesAnterior(comp)
    if (temFechamento && mesesComMovimento.has(prev)) {
      const ok = mesFechado(fechamentos, prev)
      items.push({ key: 'anterior', label: 'Mês anterior fechado', obrigatorio: true, ok, detalhe: ok ? `${mesLabel(prev)} fechado` : `feche ${mesLabel(prev)} primeiro (ordem cronológica)`, link: '/fechamento-mensal' })
    }
  }

  // Cada item pertence a uma ponta: o dinheiro, o documento, ou a ordem do
  // fechamento (que não é nem uma nem outra — é a regra cronológica).
  // `vazio` = o item está ok porque NÃO HAVIA nada a fazer, não porque algo
  // foi feito. Verde por ausência de dado é mentira confortável.
  return items.map(i => ({ ...i, ponta: PONTA_DO_ITEM[i.key] || 'ordem', vazio: !!i.vazio }))
}

export const PONTA_DO_ITEM = {
  extrato: 'caixa', conciliacao: 'caixa', liquidadas: 'caixa',
  conferencia_bancaria: 'caixa', fatura: 'caixa', impostos: 'caixa', suspense: 'caixa',
  escrituracao: 'documento', nf_pendente: 'documento', caixa_entrada: 'documento',
  anterior: 'ordem',
}
export const PONTAS = [
  { id: 'caixa', label: 'Caixa', sub: 'o dinheiro entrou e saiu, e o extrato prova' },
  { id: 'documento', label: 'Documento', sub: 'a nota foi emitida/recebida e está escriturada' },
  { id: 'ordem', label: 'Ordem', sub: 'o fechamento anda do mês mais antigo para o mais novo' },
]
