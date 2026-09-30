// =============================================================================
// FATURA DO CARTÃO — o cartão é uma CONTA própria (saldo negativo).
//
// A fatura entra como EXTRATO dessa conta (linhas em transacoes_extrato com
// conta_id = cartão, importadas pela Conciliação). Este módulo transforma as
// linhas pendentes em compras (payable com cartao_id), sem duplicar o que já
// existe: parcela de série conhecida → CASA com a compra existente; compra
// nova → CRIA ligada à linha; pagamento da fatura → NÃO é compra (é a
// transferência conta → cartão, conciliada à parte).
//
// Decisões (bench + Juliana, set/26):
//   • compra "Pago" = cobrada na fatura; data_pagamento = data da linha
//   • parcela futura de série nasce Pendente (o cartão ainda não cobrou)
//   • crédito/estorno = compra de valor NEGATIVO na conta-cartão
//   • pagamento da fatura ("PAGAMENTO", "DEB AUT", "DÉB.CONV") fica pendente
//     para ser conciliado como transferência
// =============================================================================

import { detectarParcelaLivre, removerSufixoParcela, gerarParcelas } from './parcelas'
import { periodoFatura } from './fatura'

export const ehPagamentoFatura = d => /pagament|pgto|pag\.|d[ée]bito?\s*autom|deb\s*aut|recorrent|d[ée]b\.?\s*conv|quita/i.test(d || '')
// Crédito com cara de parcela (NN/MM) é ambíguo (estorno de compra parcelada ×
// artefato do OFX) e pode abater um valor alto por engano — não vira crédito sozinho.
export const temCaraDeParcela = d => /\b\d{1,2}\s*\/\s*\d{2}\b/.test(d || '')

const norm = s => (s || '').trim().toLowerCase()
const abs = v => Math.abs(Number(v || 0))

/** Vencimento da fatura em que uma linha cai, pela data de referência do OFX
 *  (DTASOF, no Sicoob = vencimento) ou, sem ela, pela data da compra + fechamento. */
export function vencimentoDaLinha(conta, dataLinha, dataExtrato) {
  if (dataExtrato) {
    const [y, m] = dataExtrato.split('-').map(Number)
    return periodoFatura(conta, y, m - 1).vencimento
  }
  if (!dataLinha) return null
  const dF = Number(conta?.data?.dia_fechamento) || 1
  let [y, m, d] = dataLinha.split('-').map(Number)
  m -= 1
  if (d > dF) { m += 1; if (m > 11) { m = 0; y += 1 } }
  return periodoFatura(conta, y, m).vencimento
}

// ===========================================================================
// A COMPRA JÁ ESTÁ NO SISTEMA COMO NOTA?
//
// O fornecedor manda a nota por e-mail (vira lançamento) e cobra no cartão (a
// fatura traz a linha). São o MESMO gasto, e até set/26 viravam dois
// lançamentos: 15 pares, R$ 3.776,84 contados em dobro só no primeiro ano.
//
// O nome não ajuda a reconhecer — o cartão traz "ANTHROPIC* CLAUDE SU
// ANTHROPIC.COM..." e a nota traz "Anthropic, PBC". Sobram VALOR e DATA.
//
// Por isso a regra é conservadora: valor idêntico, data próxima, e o par tem
// que ser ÚNICO nos dois sentidos (uma linha para uma nota, uma nota para uma
// linha). Cinco notas de R$ 550 do mesmo fornecedor, diferindo só no mês, não
// casam com nada — vira compra nova e a decisão volta pra quem escritura.
// Duplicar é chato; unir o mês errado apaga o lançamento errado.
// ===========================================================================
export const JANELA_DIAS_NOTA = 5

/** A linha da fatura é elegível a casar com uma nota já lançada? */
function linhaPodeSerNota(ln) {
  const t = ln?.data || {}
  if (t.tipo === 'entrada') return false              // crédito/estorno não é compra
  if (ehPagamentoFatura(t.descricao)) return false    // pagamento da fatura não é compra
  if (detectarParcelaLivre(t.descricao)) return false // parcela tem caminho próprio
  return true
}

/**
 * Pareia linhas da fatura com notas que JÁ viraram lançamento.
 * @returns {Map<string, object>} id da linha → lançamento da nota
 */
export function parearNotasJaLancadas({ linhas, notas }) {
  const candidatos = []
  for (const ln of (linhas || []).filter(linhaPodeSerNota)) {
    const t = ln.data || {}
    for (const n of notas || []) {
      const nd = n.data || {}
      if (!nd.numero_nf) continue
      // Compara em CENTAVOS inteiros. Com float, 550 − 549,99 dá
      // 0,00999999999999, que passa por "menos de um centavo" — a diferença de
      // um centavo entrava como se fosse valor igual.
      if (Math.round(abs(nd.value) * 100) !== Math.round(abs(t.valor) * 100)) continue
      const dNota = nd.data_competencia || nd.due
      if (!dNota || !t.data) continue
      const dias = Math.abs((new Date(t.data) - new Date(dNota)) / 86400000)
      if (dias > JANELA_DIAS_NOTA) continue
      candidatos.push({ linhaId: ln.id, nota: n })
    }
  }
  // Só sobrevive o par que é único dos DOIS lados.
  const porLinha = new Map(), porNota = new Map()
  for (const c of candidatos) {
    porLinha.set(c.linhaId, (porLinha.get(c.linhaId) || 0) + 1)
    porNota.set(c.nota.id, (porNota.get(c.nota.id) || 0) + 1)
  }
  const pares = new Map()
  for (const c of candidatos) {
    if (porLinha.get(c.linhaId) === 1 && porNota.get(c.nota.id) === 1) pares.set(c.linhaId, c.nota)
  }
  return pares
}

/**
 * Planeja o que fazer com as linhas pendentes da fatura.
 *
 * @param {object} p
 * @param {object} p.conta     linha de contas_bancarias (tipo cartão)
 * @param {Array}  p.linhas    transacoes_extrato pendentes desta conta ({id, fit_id, data:{tipo,valor,data,descricao,fatura_vencimento}})
 * @param {Array}  p.compras   payable do cartão (linhas cruas: {id, parent_id, extrato_id, data})
 * @param {Array}  [p.notas]   payable de notas do e-mail ainda sem linha de fatura
 * @param {string} [p.hoje]    YYYY-MM-DD
 * @returns {{criar: Array, casar: Array, pagamentos: Array, ambiguas: Array, notasCasadas: Array}}
 *   criar: [{extrato_id|null, id?, parent_id?, data}] — sem código (o chamador numera)
 *   casar: [{extrato_id, lanc_id, data}]
 */
export function planejarCompras({ conta, linhas, compras, notas, hoje }) {
  const H = hoje || new Date().toISOString().slice(0, 10)
  const criar = [], casar = [], pagamentos = [], ambiguas = [], notasCasadas = []
  const notaDaLinha = parearNotasJaLancadas({ linhas, notas })
  const livres = (compras || []).filter(c => !c.extrato_id)
  const usados = new Set()

  // Índices das compras ainda sem linha de fatura
  const porFit = new Map()
  const porParcela = new Map()
  const series = new Map() // serie|total → { parentId, dcomp }
  for (const c of livres) {
    const d = c.data || {}
    if (d.fit_id_ofx) porFit.set(`${d.fit_id_ofx}|${norm(d.desc)}`, c)
    if (d.parcela_total) porParcela.set(`${norm(removerSufixoParcela(d.desc))}|${d.parcela_total}|${d.parcela_atual}`, c)
  }
  for (const c of compras || []) {
    const d = c.data || {}
    if (d.parcela_total) {
      const k = `${norm(removerSufixoParcela(d.desc))}|${d.parcela_total}`
      if (!series.has(k)) series.set(k, { parentId: c.parent_id || c.id, dcomp: d.data_competencia })
    }
  }

  const base = (t, venc) => ({
    supplier: (t.descricao || '').substring(0, 80),
    desc: t.descricao,
    data_competencia: t.data,
    due: venc,
    cat: '', subcat: '', forma_pagamento: 'Cartão Crédito',
    fit_id_ofx: t.fit_id || null,
    criado_via_import_fatura: true, created: H,
  })
  const pago = t => ({ status: 'Pago', data_pagamento: t.data })

  for (const ln of linhas || []) {
    const t = { ...(ln.data || {}), fit_id: ln.fit_id || ln.data?.fit_id || null }
    const venc = t.fatura_vencimento || vencimentoDaLinha(conta, t.data, null)
    const valor = abs(t.valor)

    if (t.tipo === 'entrada') {
      if (ehPagamentoFatura(t.descricao)) { pagamentos.push(ln); continue }
      if (temCaraDeParcela(t.descricao)) { ambiguas.push(ln); continue }
      // Crédito/estorno entra como abatimento da fatura numa categoria própria.
      // A observação fica no lançamento porque o destino contábil correto é a
      // categoria da compra estornada — quem escritura decide isso depois.
      criar.push({
        extrato_id: ln.id,
        data: {
          ...base(t, venc), ...pago(t), value: -valor,
          cat: 'Créditos/Estornos de cartão',
          notes: 'Crédito/estorno do cartão: abate a fatura. Se for o estorno de uma compra, reclassifique na Escrituração para a categoria da compra estornada.',
          criado_via_credito_fatura: true,
        },
      })
      continue
    }

    // 1) mesma linha já registrada (fit_id + descrição) → casa
    const kFit = t.fit_id ? `${t.fit_id}|${norm(t.descricao)}` : null
    const jaFit = kFit && porFit.get(kFit)
    if (jaFit && !usados.has(jaFit.id)) {
      usados.add(jaFit.id)
      casar.push({ extrato_id: ln.id, lanc_id: jaFit.id, data: { ...(jaFit.data || {}), ...pago(t), fit_id_ofx: t.fit_id || jaFit.data?.fit_id_ofx || null } })
      continue
    }

    const pc = detectarParcelaLivre(t.descricao)
    if (!pc) {
      // 1b) a compra já está no sistema como NOTA → casa, não duplica.
      // A nota é a verdade: mantém número, competência e classificação, e só
      // absorve o pagamento (fatura, data, forma). Regime caixa.
      const nota = notaDaLinha.get(ln.id)
      if (nota && !usados.has(nota.id)) {
        usados.add(nota.id)
        const nd = nota.data || {}
        casar.push({
          extrato_id: ln.id,
          lanc_id: nota.id,
          data: { ...nd, ...pago(t), due: venc, forma_pagamento: 'Cartão Crédito', fit_id_ofx: t.fit_id || null, consolidado_de: t.descricao },
        })
        notasCasadas.push({ numero_nf: nd.numero_nf, fornecedor: nd.supplier || '—', valor, descricao_fatura: t.descricao })
        continue
      }
      criar.push({ extrato_id: ln.id, data: { ...base(t, venc), ...pago(t), value: valor } })
      continue
    }

    // 2) parcela de série conhecida → casa com a parcela existente
    const kParc = `${norm(pc.serie)}|${pc.total}|${pc.atual}`
    const jaParc = porParcela.get(kParc)
    if (jaParc && !usados.has(jaParc.id)) {
      usados.add(jaParc.id)
      casar.push({ extrato_id: ln.id, lanc_id: jaParc.id, data: { ...(jaParc.data || {}), ...pago(t), due: jaParc.data?.due || venc, fit_id_ofx: t.fit_id || null } })
      continue
    }

    // 3) série existe mas esta parcela não → cria só a parcela, ligada à série
    const kSerie = `${norm(pc.serie)}|${pc.total}`
    if (series.has(kSerie)) {
      const { parentId, dcomp } = series.get(kSerie)
      criar.push({ extrato_id: ln.id, parent_id: parentId, data: { ...base(t, venc), ...pago(t), value: valor, desc: `${pc.serie} ${pc.atual}/${pc.total}`, data_competencia: dcomp || t.data, parcela_atual: pc.atual, parcela_total: pc.total } })
      continue
    }

    // 4) série NOVA → gera a série cheia: esta parcela ligada à linha; as
    //    anteriores como já cobradas (sem linha); as futuras Pendente.
    const [vy, vm] = (venc || t.data).split('-').map(Number)
    const origem = new Date(vy, (vm - 1) - (pc.atual - 1), 1)
    const dataCompra = `${origem.getFullYear()}-${String(origem.getMonth() + 1).padStart(2, '0')}-01`
    const parcelas = gerarParcelas({
      baseData: { ...base(t, venc), desc: pc.serie, data_competencia: dataCompra, fit_id_ofx: null },
      valorTotal: valor * pc.total, numParcelas: pc.total, dataCompra, cartao: conta,
    })
    const parentId = crypto.randomUUID()
    parcelas.forEach((p, i) => {
      const ehEsta = p.parcela_atual === pc.atual
      const passada = p.parcela_atual < pc.atual
      criar.push({
        extrato_id: ehEsta ? ln.id : null,
        ...(i === 0 ? { id: parentId } : { parent_id: parentId }),
        data: ehEsta
          ? { ...p, ...pago(t), due: venc, fit_id_ofx: t.fit_id || null }
          : passada
            ? { ...p, status: 'Pago', data_pagamento: p.due, sem_linha_fatura: true }
            : { ...p, status: 'Pendente', data_pagamento: null },
      })
    })
    series.set(kSerie, { parentId, dcomp: dataCompra })
  }
  return { criar, casar, pagamentos, ambiguas, notasCasadas }
}

/** Resumo em português para o confirm() antes de gravar. */
export function resumoPlano(plano) {
  const ligadas = plano.criar.filter(c => c.extrato_id).length
  const futuras = plano.criar.length - ligadas
  const partes = []
  const notas = plano.notasCasadas?.length || 0
  if (ligadas) partes.push(`${ligadas} compra(s) nova(s)`)
  if (notas) partes.push(`${notas} linha(s) reconhecida(s) como nota que já está no sistema (não duplica)`)
  if (plano.casar.length - notas > 0) partes.push(`${plano.casar.length - notas} parcela(s) casada(s) com compras já registradas`)
  if (futuras) partes.push(`${futuras} parcela(s) futura(s)/anterior(es) de séries novas`)
  if (plano.pagamentos.length) partes.push(`${plano.pagamentos.length} pagamento(s) da fatura deixado(s) para conciliar como transferência`)
  if (plano.ambiguas.length) partes.push(`${plano.ambiguas.length} crédito(s) ambíguo(s) deixado(s) para decisão manual`)
  return partes.join(' · ')
}
