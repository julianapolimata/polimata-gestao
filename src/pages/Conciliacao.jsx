import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import AppLayout from '../components/AppLayout'
import EstadoErro from '../components/EstadoErro'
import { showToast } from '../components/Toast'
import { fmtMoney, flatten } from '../lib/finance'
import { parseOFX, detectarTipoOFX } from '../lib/ofx'
import { sugerirMatches } from '../lib/matchExtrato'
import { proximoCodigoReceivable, proximoCodigoPayable, proximosCodigosPayable } from '../lib/codigos'
import { planejarCompras, resumoPlano, vencimentoDaLinha, ehPagamentoFatura } from '../lib/faturaCartao'
import { rotuloFatura } from '../lib/fatura'
import { fetchPlanoContas, categoriasDe, subcategoriasDe } from '../lib/planoContas'
import { useConfirm } from '../components/ConfirmDialog'

// Tipos de ajuste que EXPLICAM a diferença entre o valor do banco e a nota
// (o "valor netado"). Cada um posta num lançamento próprio, na sua categoria —
// nada de diferença sumindo. natureza: 'reduz' = recebi/paguei menos que a nota;
// 'acresce' = veio a mais. tabela = onde o ajuste é postado.
// cat + subcat vêm do plano de contas: sem a SUBCATEGORIA o ajuste entrava com
// classificação genérica e a DRE não conseguia separar retenção de tarifa
// (revisão contábil set/26).
const AJUSTES_ENTRADA = [
  { key: 'irrf', label: 'IRRF retido', natureza: 'reduz', tabela: 'payable', cat: 'Impostos retidos na fonte', subcat: 'IRRF' },
  { key: 'iss', label: 'ISS retido', natureza: 'reduz', tabela: 'payable', cat: 'Impostos retidos na fonte', subcat: 'ISS' },
  { key: 'inss', label: 'INSS retido', natureza: 'reduz', tabela: 'payable', cat: 'Impostos retidos na fonte', subcat: 'INSS' },
  { key: 'pcc', label: 'PIS/COFINS/CSLL retido', natureza: 'reduz', tabela: 'payable', cat: 'Impostos retidos na fonte', subcat: 'PIS/COFINS/CSLL' },
  { key: 'tarifa', label: 'Tarifa bancária', natureza: 'reduz', tabela: 'payable', cat: 'Despesas Financeiras', subcat: 'Tarifas bancárias' },
  { key: 'desc', label: 'Desconto concedido', natureza: 'reduz', tabela: 'payable', cat: 'Descontos concedidos', subcat: '' },
  { key: 'juros', label: 'Juros/Multa recebidos', natureza: 'acresce', tabela: 'receivable', cat: 'Receita Financeira', subcat: 'Juros recebidos' },
]
const AJUSTES_SAIDA = [
  { key: 'juros', label: 'Juros/Multa', natureza: 'acresce', tabela: 'payable', cat: 'Despesas Financeiras', subcat: 'Juros pagos' },
  { key: 'tarifa', label: 'Tarifa bancária', natureza: 'acresce', tabela: 'payable', cat: 'Despesas Financeiras', subcat: 'Tarifas bancárias' },
  { key: 'multa', label: 'Multa', natureza: 'acresce', tabela: 'payable', cat: 'Despesas Financeiras', subcat: 'Multas e encargos' },
  { key: 'desc', label: 'Desconto obtido', natureza: 'reduz', tabela: 'receivable', cat: 'Receita Financeira', subcat: 'Descontos obtidos' },
]

// =====================================================================
// CONCILIAÇÃO — UMA MESA SÓ (bloco 4, set/26)
//   • O cartão de crédito é uma CONTA (contas_bancarias.tipo = 'cartao'): a
//     fatura (OFX) entra como extrato dessa conta; as linhas viram compras
//     (payable com cartao_id) por "＋ Criar compras" — casa com o que já existe.
//   • Pagar a fatura = TRANSFERÊNCIA conta → cartão (tabela transferencias),
//     conciliada pelo botão "↔ Transferência" nos dois extratos.
//   • Sem auto-match silencioso: só pelo botão, com confirmação.
//   • "Arquivar" (linha que não é lançamento) em vez de "ignorar".
// =====================================================================
// CONCILIAÇÃO BANCÁRIA v1.6
// Mudanças vs v1.5 (Juliana 31/05):
//   - Filtros estilo extrato bancário: inputs De/Até (não chips de período)
//   - Tabela HTML real com <thead> sticky (cabeçalho Data/Descrição/Valor/
//     Status fica fixo no topo ao rolar)
//   - Sem agrupamento por mês (não precisava do sticky problemático)
//   - Período padrão = range das transações importadas
// =====================================================================

function fmtDataBR(s) {
  if (!s) return '—'
  const [y, m, d] = s.split('-')
  return `${d}/${m}/${y}`
}

export default function Conciliacao() {
  const { user } = useAuth()
  const [contas, setContas] = useState([])
  const [contaId, setContaId] = useState('')
  const [extratos, setExtratos] = useState([])
  const [receivable, setReceivable] = useState([])
  const [payable, setPayable] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [autoConc, setAutoConc] = useState(false)
  const [saldoBanco, setSaldoBanco] = useState(null)

  // Filtros
  const [dataDe, setDataDe] = useState('')
  const [dataAte, setDataAte] = useState('')
  const [filtroStatus, setFiltroStatus] = useState('todos')
  const [filtroBusca, setFiltroBusca] = useState('')
  const [filtroValorMin, setFiltroValorMin] = useState('')
  const [filtroValorMax, setFiltroValorMax] = useState('')
  const [periodoInicializado, setPeriodoInicializado] = useState(false)
  const [notasNoPeriodo, setNotasNoPeriodo] = useState(true) // escopar notas ao período do extrato
  const [buscaNota, setBuscaNota] = useState('')
  const [transferencias, setTransferencias] = useState([])
  const [transfAberto, setTransfAberto] = useState(false) // form "↔ Transferência"
  const [tOutraConta, setTOutraConta] = useState('')      // a outra ponta da transferência
  const [tLigar, setTLigar] = useState('')                // id de transferência já registrada pra ligar
  const [criandoCompras, setCriandoCompras] = useState(false)



  const [selecionado, setSelecionado] = useState(null) // id da linha do extrato selecionada (vista 2 colunas)
  const [marcados, setMarcados] = useState(new Set())   // ids dos lançamentos escolhidos (multi-seleção)
  const [ajustes, setAjustes] = useState([])            // [{ id, key, valor }] ajustes que explicam a diferença
  const [conciliando, setConciliando] = useState(false)
  const [periodosFechados, setPeriodosFechados] = useState(new Set()) // 'YYYY-MM' travados
  const [plano, setPlano] = useState([])
  const [criarAberto, setCriarAberto] = useState(false) // form de "criar lançamento" aberto
  const [nCat, setNCat] = useState('')
  const [nSubcat, setNSubcat] = useState('')

  useEffect(() => { fetchPlanoContas().then(p => setPlano(p || [])) }, [])
  const [erro, setErro] = useState(null)

  // Zera a seleção/ajustes/form ao trocar a linha do extrato
  useEffect(() => { setMarcados(new Set()); setAjustes([]); setCriarAberto(false); setNCat(''); setNSubcat(''); setTransfAberto(false); setTOutraConta(''); setTLigar('') }, [selecionado])

  // Carrega contas uma única vez (não muda quando usuária troca conta selecionada)
  useEffect(() => {
    if (!user) return
    supabase.from('contas_bancarias').select('*').order('updated_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) { setErro(error); return }
        setErro(null)
        // Contas e cartões na mesma lista: o cartão é uma conta de saldo negativo.
        const ativos = (data || []).filter(c => c.data?.ativo !== false)
          .sort((a, b) => ((a.data?.tipo === 'cartao') - (b.data?.tipo === 'cartao')))
        setContas(ativos)
        if (ativos.length > 0 && !contaId) setContaId(ativos[0].id)
      })
      .catch((e) => setErro(e))
  }, [user, contaId])

  const carregar = useCallback(() => {
    if (!user) return
    if (!contaId) { setLoading(false); return }
    setLoading(true)
    // Filtra transacoes_extrato POR CONTA no servidor (não traz de outras contas).
    // Candidatas p/ conciliar = notas AINDA NÃO conciliadas (conciliado_em null),
    // INCLUINDO as já "Recebido"/"Pago" — estar recebida no sistema não é a mesma
    // coisa que estar amarrada ao extrato. Antes o filtro excluía as recebidas e
    // por isso não dava pra ligá-las à linha do banco.
    Promise.all([
      supabase.from('transacoes_extrato').select('*').eq('conta_id', contaId).order('data->>data', { ascending: false }),
      supabase.from('receivable').select('*').is('conciliado_em', null),
      supabase.from('payable').select('*').is('conciliado_em', null),
      supabase.from('conciliacao_periodos').select('competencia').eq('conta_id', contaId),
      supabase.from('transferencias').select('*'),
    ]).then(([rE, rR, rP, rPer, rT]) => {
      const err = rE.error || rR.error || rP.error
      if (err) { setErro(err); setLoading(false); return }
      setErro(null)
      setExtratos(rE.data || [])
      // PORTÃO DA ESCRITURAÇÃO: só nota ESCRITURADA é candidata a conciliar. Uma nota
      // não revisada (escriturado != true) não sobe pra conciliação — é a 1ª camada da
      // metodologia (escrituração contábil antes do cruzamento financeiro).
      const soEscriturada = arr => (arr || []).filter(r => r.data?.escriturado === true)
      setReceivable(soEscriturada(rR.data).map(flatten))
      // cartao_id diz em que conta a compra vive (cartão) — o pool filtra por ele.
      setPayable(soEscriturada(rP.data).map(r => ({ ...flatten(r), cartao_id: r.cartao_id, parent_id: r.parent_id, extrato_id: r.extrato_id })))
      setPeriodosFechados(new Set((rPer.data || []).map(r => r.competencia)))
      setTransferencias(rT.data || [])
      setLoading(false)
    })
      .catch((e) => { setErro(e); setLoading(false) })
  }, [user, contaId])

  useEffect(() => { carregar() }, [carregar])

  const conta = useMemo(() => contas.find(c => c.id === contaId), [contas, contaId])
  const ehCartao = conta?.data?.tipo === 'cartao'
  const outrasContas = useMemo(() => contas.filter(c => c.id !== contaId), [contas, contaId])
  // Compras que vivem NESTA conta (cartão) ou fora de qualquer cartão (banco).
  const payableDaConta = useMemo(
    () => payable.filter(p => ehCartao ? p.cartao_id === contaId : !p.cartao_id),
    [payable, ehCartao, contaId],
  )

  // Range de datas das transações da conta atual — define o período padrão
  const rangeImportado = useMemo(() => {
    const arr = extratos.filter(e => e.conta_id === contaId).map(e => e.data?.data).filter(Boolean).sort()
    if (!arr.length) return null
    return { min: arr[0], max: arr[arr.length - 1] }
  }, [extratos, contaId])

  // Inicializa período com o range importado uma única vez por mudança de conta
  useEffect(() => {
    if (rangeImportado && !periodoInicializado) {
      setDataDe(rangeImportado.min)
      setDataAte(rangeImportado.max)
      setPeriodoInicializado(true)
    }
  }, [rangeImportado, periodoInicializado])
  useEffect(() => { setPeriodoInicializado(false) }, [contaId])
  // Sem auto-match silencioso (bench 08): a conciliação automática só roda pelo
  // botão "⚡ Conciliar automáticos", com confirmação e contagem antes.

  // ── Aplica filtros ───────────────────────────────────────────────────
  // Base = todos os filtros MENOS o status. As contagens do dropdown são feitas
  // sobre a base, pra "Todos (N)" bater com a lista (antes a contagem ignorava
  // data/busca e mostrava 202 enquanto a lista mostrava 180).
  const extratosBase = useMemo(() => {
    let arr = extratos.filter(e => e.conta_id === contaId)
    // Sem data na linha, não esconde (mesmo critério nos dois limites).
    if (dataDe) arr = arr.filter(e => !e.data?.data || e.data.data >= dataDe)
    if (dataAte) arr = arr.filter(e => !e.data?.data || e.data.data <= dataAte)
    if (filtroBusca.trim()) {
      const q = filtroBusca.trim().toLowerCase()
      arr = arr.filter(e => (e.data?.descricao || '').toLowerCase().includes(q))
    }
    const vmin = parseFloat(filtroValorMin)
    const vmax = parseFloat(filtroValorMax)
    if (!isNaN(vmin)) arr = arr.filter(e => Number(e.data?.valor || 0) >= vmin)
    if (!isNaN(vmax)) arr = arr.filter(e => Number(e.data?.valor || 0) <= vmax)
    return arr
  }, [extratos, contaId, dataDe, dataAte, filtroBusca, filtroValorMin, filtroValorMax])

  const extratosFiltrados = useMemo(() => {
    let arr = extratosBase
    if (filtroStatus !== 'todos') arr = arr.filter(e => e.status === filtroStatus)
    return [...arr].sort((a, b) => (b.data?.data || '').localeCompare(a.data?.data || ''))
  }, [extratosBase, filtroStatus])

  // ── Contadores (sobre a base já filtrada por data/busca) ─────────────
  const counts = useMemo(() => {
    const c = { pendente: 0, conciliado: 0, ignorado: 0 }
    for (const e of extratosBase) c[e.status] = (c[e.status] || 0) + 1
    return c
  }, [extratosBase])

  // ── Saldos ───────────────────────────────────────────────────────────
  // Saldo no sistema DESTA conta = saldo inicial + movimento do extrato JÁ
  // conciliado (cada linha conciliada tem um lançamento Recebido/Pago por trás).
  // Antes somava recebido/pago de TODAS as contas — a divergência não batia com
  // mais de uma conta. Agora a divergência = exatamente o que falta conciliar aqui.
  const saldoSistema = useMemo(() => {
    if (!conta) return 0
    const sIni = Number(conta.data?.saldo_inicial || 0)
    const conc = extratos.filter(e => e.conta_id === contaId && e.status === 'conciliado')
    const tIn = conc.filter(t => t.data?.tipo === 'entrada').reduce((a, t) => a + Number(t.data?.valor || 0), 0)
    const tOut = conc.filter(t => t.data?.tipo === 'saida').reduce((a, t) => a + Number(t.data?.valor || 0), 0)
    return sIni + tIn - tOut
  }, [conta, contaId, extratos])

  const saldoBancoCalculado = useMemo(() => {
    if (!conta) return null
    const sIni = Number(conta.data?.saldo_inicial || 0)
    const trans = extratos.filter(e => e.conta_id === contaId)
    if (trans.length === 0) return null
    const totalIn = trans.filter(t => t.data?.tipo === 'entrada').reduce((s, t) => s + Number(t.data?.valor || 0), 0)
    const totalOut = trans.filter(t => t.data?.tipo === 'saida').reduce((s, t) => s + Number(t.data?.valor || 0), 0)
    return sIni + totalIn - totalOut
  }, [conta, contaId, extratos])

  const saldoBancoFinal = saldoBanco != null ? saldoBanco : saldoBancoCalculado
  const divergencia = saldoBancoFinal != null ? saldoBancoFinal - saldoSistema : null

  // ── Upload ───────────────────────────────────────────────────────────
  const [confirmar, dialogoConfirmacao] = useConfirm()

  async function handleUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!contaId) { showToast('Selecione uma conta antes.', 'warning'); return }
    if (!user) { showToast('Sessão expirada.', 'error'); return }
    setUploading(true)
    try {
      const buf = await file.arrayBuffer()
      let texto
      try { texto = new TextDecoder('windows-1252').decode(buf) }
      catch { texto = new TextDecoder('utf-8').decode(buf) }
      // Guarda de tipo: fatura de cartão só na conta-cartão; extrato de conta só
      // na conta corrente. (Misturar foi o que inflou as "faturas" com Pix e boleto.)
      const tipoOFX = detectarTipoOFX(texto)
      if (ehCartao && tipoOFX === 'corrente') {
        const segueExtrato = await confirmar({
          titulo: 'Este arquivo parece um extrato de conta corrente',
          texto: 'Ele tem Pix, boletos e débitos — não compras de cartão. E você está importando na conta do cartão.',
          consequencias: [
            'Esses movimentos entrariam na fatura do cartão, onde não é o lugar deles.',
            'A conciliação do cartão para de fechar, porque a fatura passa a ter o que não é dela.',
            'O caminho certo é trocar a conta no seletor e importar na conta corrente.',
          ],
          confirmarLabel: 'Importar assim mesmo',
          variante: 'perigo',
        })
        if (!segueExtrato) { showToast('Importação cancelada. Selecione a conta corrente no seletor e importe lá.', 'info'); return }
      }
      if (!ehCartao && tipoOFX === 'cartao') {
        const segueFatura = await confirmar({
          titulo: 'Este arquivo parece uma fatura de cartão',
          texto: 'Você está importando como extrato desta conta.',
          consequencias: [
            'As compras do cartão entrariam como movimento de conta corrente.',
            'O saldo da conta fica errado, e as compras não aparecem na fatura.',
            'O caminho certo é escolher o cartão no seletor de conta e importar lá.',
          ],
          confirmarLabel: 'Importar assim mesmo',
          variante: 'perigo',
        })
        if (!segueFatura) { showToast('Importação cancelada. Selecione o cartão no seletor de conta e importe lá.', 'info'); return }
      }
      const { transacoes, saldoFinal, dataExtrato } = parseOFX(texto)
      if (!transacoes.length) { showToast('Nenhuma transação no OFX.', 'warning'); return }
      // Dedup. Banco: fit_id. Cartão: fit_id + descrição + data — o Sicoob REUSA o
      // fit_id nas parcelas de uma mesma compra (ANUIDADE 05/12, 06/12…), então o
      // fit_id sozinho apagaria parcelas legítimas.
      const norm = x => (x || '').trim().toLowerCase()
      const chave = t => ehCartao ? `${t.fit_id || ''}|${norm(t.descricao)}|${t.data || ''}` : (t.fit_id || '')
      const jaTem = new Set(extratos.filter(e => e.conta_id === contaId && e.fit_id).map(e => chave({ fit_id: e.fit_id, descricao: e.data?.descricao, data: e.data?.data })))
      const novos = transacoes.filter(t => !t.fit_id || !jaTem.has(chave(t)))
      if (!novos.length) {
        showToast(`Todas as ${transacoes.length} transações já estavam importadas.`, 'info')
        if (saldoFinal != null) setSaldoBanco(saldoFinal)
        return
      }
      // Fatura: cada linha guarda o vencimento da fatura em que cai (DTASOF do
      // Sicoob = vencimento; sem ele, data + dia de fechamento).
      let vencFatura = null, rotulo = null
      if (ehCartao) {
        const datas = novos.map(t => t.data).filter(Boolean).sort()
        vencFatura = vencimentoDaLinha(conta, datas[datas.length - 1], dataExtrato)
        if (vencFatura) { const [vy, vm] = vencFatura.split('-').map(Number); rotulo = rotuloFatura(vy, vm - 1) }
      }
      const tipoImp = ehCartao ? 'ofx_fatura_cartao' : 'ofx_extrato'
      // 1) Upload arquivo + registrar import
      const path = `${user.id}/importacoes/${tipoImp}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
      let arquivoPath = null
      let uploadFalhou = false
      try {
        const { error: upErr } = await supabase.storage.from('anexos-fiscais').upload(path, file)
        if (!upErr) arquivoPath = path
        else uploadFalhou = true
      } catch (e) { console.warn('upload arquivo OFX falhou:', e.message); uploadFalhou = true }
      const { data: imp, error: errImp } = await supabase.from('importacoes').insert({
        user_id: user.id,
        tipo: tipoImp,
        arquivo_nome: file.name,
        arquivo_path: arquivoPath,
        qtd_registros: novos.length,
        metadata: { conta_id: contaId, saldo_final: saldoFinal, ...(ehCartao ? { cartao_id: contaId, vencimento: vencFatura, fatura: rotulo, data_extrato: dataExtrato } : {}) },
      }).select('id').single()
      // Aborta se o cabeçalho falhar: sem ele, os lançamentos ficariam órfãos
      // (importacao_id nulo) e impossíveis de reverter pela tela de Importações.
      if (errImp) throw new Error('Falha ao registrar a importação: ' + errImp.message)
      // 2) Inserir transações com importacao_id
      const payload = novos.map(t => ({
        user_id: user.id, conta_id: contaId, status: 'pendente', fit_id: t.fit_id,
        importacao_id: imp.id,
        data: ehCartao ? { ...t, fatura_vencimento: vencimentoDaLinha(conta, t.data, dataExtrato) || vencFatura, fatura_rotulo: rotulo } : t,
      }))
      const { error } = await supabase.from('transacoes_extrato').insert(payload)
      if (error) {
        // Compensa: remove o cabeçalho recém-criado pra não deixar import vazio.
        await supabase.from('importacoes').delete().eq('id', imp.id)
        throw error
      }
      if (ehCartao) showToast(`${novos.length} linha(s) da fatura ${rotulo || ''} importada(s). Use "＋ Criar compras" para transformá-las em compras do cartão.`, 'success')
      else showToast(`${novos.length} transações importadas.`, 'success')
      if (uploadFalhou) showToast('Lançamentos importados, mas o arquivo OFX de origem não foi arquivado (falha no upload).', 'warning')
      if (saldoFinal != null) setSaldoBanco(saldoFinal)
      setPeriodoInicializado(false) // re-aplica range com o que foi importado
      carregar()
    } catch (err) {
      console.error(err)
      showToast('Erro: ' + err.message, 'error')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  // ── Conciliação automática em lote ───────────────────────────────────
  // Concilia só os casos SEGUROS: valor exato + data próxima E um único
  // candidato (sem ambiguidade). Os ambíguos ficam pra decisão manual.
  async function conciliarAutomatico(opts = {}) {
    const { silencioso = false } = opts
    const pendentes = extratos.filter(e => e.conta_id === contaId && e.status === 'pendente' && !periodosFechados.has(String(e.data?.data || '').slice(0, 7)))
    const usadosLanc = new Set()
    const pares = []
    for (const ext of pendentes) {
      const tipo = ext.data?.tipo
      // Cada conta casa só com o que vive nela: no banco, compras sem cartão;
      // no cartão, compras daquele cartão. Entrada no cartão = pagamento/estorno,
      // não tem "nota" pra casar.
      if (ehCartao && tipo === 'entrada') continue
      const pool = (tipo === 'entrada' ? receivable : payableDaConta)
        .filter(c => c.status !== 'Provisão' && !usadosLanc.has(c.id))
      const fortes = sugerirMatches(ext.data || {}, pool).filter(s => s.dentroTol)
      if (fortes.length === 1) {
        pares.push({ ext, lanc: fortes[0].lancamento, target: tipo === 'entrada' ? 'receivable' : 'payable' })
        usadosLanc.add(fortes[0].lancamento.id)
      }
    }
    if (!pares.length) { if (!silencioso) showToast('Nenhum match automático seguro (valor + data, sem ambiguidade).', 'info'); return }
    if (!silencioso) {
      const ok = await confirmar({
        titulo: `Conciliar ${pares.length} transação(ões) automaticamente?`,
        texto: 'São as que batem exato: mesmo valor e data próxima.',
        consequencias: [
          'As que têm mais de um candidato ficam para você decidir uma a uma.',
          'Cada uma pode ser desfeita depois, individualmente.',
        ],
        confirmarLabel: 'Conciliar',
      })
      if (!ok) return
    }
    setAutoConc(true)
    let ok = 0
    try {
      for (const p of pares) {
        const statusNovo = p.target === 'receivable' ? 'Recebido' : 'Pago'
        const merged = { ...(p.lanc.data || {}), status: statusNovo, data_pagamento: p.lanc.data?.data_pagamento || p.ext.data?.data }
        const { error } = await supabase.rpc('conciliar_vincular', { p_extrato_id: p.ext.id, p_target: p.target, p_lanc_id: p.lanc.id, p_merged: merged })
        if (!error) ok++
      }
      if (ok) showToast(`${ok} transação(ões) conciliada(s) automaticamente${silencioso ? ' — confira' : ''}.`, silencioso ? 'info' : 'success')
      setSelecionado(null); carregar()
    } catch (e) { if (!silencioso) showToast('Erro na conciliação automática: ' + e.message, 'error') }
    finally { setAutoConc(false) }
  }

  // ── Mesa de conciliação (multi-seleção + ajustes) ────────────────────
  function toggleMarcado(id) {
    setMarcados(m => { const n = new Set(m); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  function addAjuste() { setAjustes(a => [...a, { id: crypto.randomUUID(), key: tiposAjuste[0].key, valor: '' }]) }
  function updAjuste(id, campo, val) { setAjustes(a => a.map(x => x.id === id ? { ...x, [campo]: val } : x)) }
  function rmAjuste(id) { setAjustes(a => a.filter(x => x.id !== id)) }
  // Suspense: joga a diferença que não dá pra resolver agora numa conta transitória
  // (a esclarecer depois). Fecha a conciliação, mas o valor fica rastreável.
  function jogarSuspense() {
    const v = Math.abs(mesa.diff)
    if (v < 0.01) return
    setAjustes(a => [...a.filter(x => x.key !== 'suspense'), { id: crypto.randomUUID(), key: 'suspense', valor: v.toFixed(2), sinal: mesa.diff > 0 ? 'acresce' : 'reduz' }])
  }

  // Confirma a conciliação SÓ quando o valor fecha: Σ(selecionados) ± ajustes = extrato.
  async function conciliarMultiplo() {
    const ext = selecionadoExt
    if (!ext || !mesa.ok) return
    const tipo = ext.data?.tipo
    const target = tipo === 'entrada' ? 'receivable' : 'payable'
    const statusFinal = target === 'receivable' ? 'Recebido' : 'Pago'
    const dataExt = ext.data?.data
    setConciliando(true)
    try {
      const selecionados = poolLanc.filter(l => marcados.has(l.id))
      const p_ledger = selecionados.map(l => ({
        id: l.id,
        data: { ...(l.data || {}), status: statusFinal, data_pagamento: l.data?.data_pagamento || dataExt },
      }))
      const ajValidos = ajustes
        .map(a => {
          const v = Number(a.valor || 0)
          if (a.key === 'suspense') {
            return { def: { tabela: a.sinal === 'acresce' ? 'receivable' : 'payable', cat: 'Conta transitória (a esclarecer)', subcat: '', label: 'Diferença a esclarecer (suspense)', key: 'suspense', suspense: true }, v }
          }
          return { def: tiposAjuste.find(t => t.key === a.key), v }
        })
        .filter(a => a.def && a.v > 0)
      // Gera códigos por tabela (uma leitura por tabela, incrementando)
      let baseR = null, nR = 0, baseP = null, nP = 0
      const hoje = new Date().toISOString().slice(0, 10)
      const nome = (ext.data?.descricao || '').substring(0, 80)
      const p_ajustes = []
      for (const a of ajValidos) {
        let codigo
        if (a.def.tabela === 'receivable') {
          if (baseR === null) { baseR = await proximoCodigoReceivable(); nR = parseInt(baseR.slice(1), 10) }
          codigo = `1${String(nR++).padStart(5, '0')}`
        } else {
          if (baseP === null) { baseP = await proximoCodigoPayable(); nP = parseInt(baseP.slice(1), 10) }
          codigo = `2${String(nP++).padStart(5, '0')}`
        }
        p_ajustes.push({
          tabela: a.def.tabela,
          codigo,
          data: {
            [a.def.tabela === 'receivable' ? 'client' : 'supplier']: nome,
            desc: `${a.def.label} — conciliação`,
            value: a.v,
            due: dataExt, data_competencia: dataExt, data_pagamento: dataExt,
            status: a.def.tabela === 'receivable' ? 'Recebido' : 'Pago',
            cat: a.def.cat, subcat: a.def.subcat || '',
            doc_status: 'dispensado', doc_motivo_dispensa: 'Ajuste de conciliação', sem_documento: false,
            escriturado: true, escriturado_em: new Date().toISOString(), escriturado_por: 'auto',
            criado_via_conciliacao_ajuste: true, ajuste_tipo: a.def.key, suspense: !!a.def.suspense,
            created: hoje,
          },
        })
      }
      const p_meta = {
        conciliado_multiplo: true,
        lancamento_ids: selecionados.map(l => l.id),
        ajustes: p_ajustes.map(a => ({ tipo: a.data.ajuste_tipo, valor: a.data.value })),
        banco_valor: mesa.B,
      }
      const { error } = await supabase.rpc('conciliar_multiplo', { p_extrato_id: ext.id, p_target: target, p_ledger, p_ajustes, p_meta })
      if (error) throw error
      showToast(`Conciliado: ${selecionados.length} nota(s)${p_ajustes.length ? ` + ${p_ajustes.length} ajuste(s)` : ''}.`, 'success')
      setSelecionado(null); carregar()
    } catch (e) { showToast('Erro ao conciliar: ' + e.message, 'error') }
    finally { setConciliando(false) }
  }

  async function criarLancamento(extrato) {
    if (!user) return
    if (!nCat) { showToast('Escolha a categoria do lançamento.', 'warning'); return }
    const tipoTabela = extrato.data?.tipo === 'entrada' ? 'receivable' : 'payable'
    const dataExt = extrato.data?.data
    const novoLanc = {
      [tipoTabela === 'receivable' ? 'client' : 'supplier']: (extrato.data?.descricao || '').substring(0, 80),
      desc: extrato.data?.descricao,
      value: Number(extrato.data?.valor || 0),
      due: dataExt, data_pagamento: dataExt,
      status: tipoTabela === 'receivable' ? 'Recebido' : 'Pago',
      cat: nCat, subcat: nSubcat || '', doc_status: 'pendente', sem_documento: true,
      escriturado: true, escriturado_em: new Date().toISOString(), escriturado_por: 'manual',
      created: dataExt, criado_via_conciliacao: true,
    }
    try {
      // Cria o lançamento e marca o extrato conciliado numa transação atômica (RPC).
      const { error } = await supabase.rpc('conciliar_criar_lancamento', {
        p_extrato_id: extrato.id, p_target: tipoTabela, p_lanc: novoLanc,
      })
      if (error) throw error
      showToast('Lançamento criado e conciliado.', 'success')
      setSelecionado(null); carregar()
    } catch (e) { showToast('Erro: ' + e.message, 'error') }
  }

  // ── Transferência entre contas próprias (pagar fatura = transferência) ──
  // Abre o form já com a outra ponta sugerida: descrição com cara de cartão +
  // um único cartão cadastrado → pré-seleciona o cartão.
  function abrirTransferencia(extrato) {
    const cartoes = outrasContas.filter(c => c.data?.tipo === 'cartao')
    const desc = extrato?.data?.descricao || ''
    let sugerida = ''
    if (!ehCartao && extrato?.data?.tipo === 'saida' && cartoes.length === 1 && /cart|fatura|d[ée]b\.?\s*conv\.?\s*demais/i.test(desc)) sugerida = cartoes[0].id
    if (ehCartao && extrato?.data?.tipo === 'entrada' && outrasContas.length === 1) sugerida = outrasContas[0].id
    if (!sugerida && outrasContas.length === 1) sugerida = outrasContas[0].id
    setTOutraConta(sugerida); setTLigar(''); setCriarAberto(false); setTransfAberto(v => !v)
  }
  // Transferências já registradas (pela outra conta) que batem com esta linha:
  // mesmo valor, ±7 dias, a ponta desta conta ainda solta.
  const transfCompativeis = useMemo(() => {
    const ext = extratosFiltrados.find(e => e.id === selecionado)
    if (!ext || !transfAberto) return []
    const v = Math.abs(Number(ext.data?.valor || 0))
    const dt = new Date((ext.data?.data || '') + 'T12:00:00')
    const saida = ext.data?.tipo === 'saida'
    return transferencias.filter(t => {
      if (Math.abs(Number(t.valor) - v) > 0.01) return false
      if (saida ? (t.de_conta_id !== contaId || t.extrato_origem_id) : (t.para_conta_id !== contaId || t.extrato_destino_id)) return false
      const dd = Math.abs(dt - new Date(t.data + 'T12:00:00')) / 86400000
      return dd <= 7
    })
  }, [transferencias, extratosFiltrados, selecionado, transfAberto, contaId])

  async function conciliarTransferencia(extrato) {
    if (!tLigar && !tOutraConta) { showToast('Escolha a outra conta da transferência.', 'warning'); return }
    setConciliando(true)
    try {
      const { error } = await supabase.rpc('conciliar_transferencia', {
        p_extrato_id: extrato.id,
        p_outra_conta_id: tLigar ? (transferencias.find(t => t.id === tLigar)?.[extrato.data?.tipo === 'saida' ? 'para_conta_id' : 'de_conta_id'] || tOutraConta || null) : tOutraConta,
        p_transf_id: tLigar || null,
        p_descricao: extrato.data?.descricao || null,
      })
      if (error) throw error
      showToast(tLigar ? 'Ligado à transferência já registrada.' : 'Transferência registrada e conciliada.', 'success')
      setSelecionado(null); carregar()
    } catch (e) { showToast('Erro: ' + (e.message || e), 'error') }
    finally { setConciliando(false) }
  }

  // ── Fatura do cartão: linhas pendentes → compras (casa com o que já existe) ──
  async function criarComprasDaFatura(linhasAlvo) {
    if (!ehCartao || !user) return
    const linhas = (linhasAlvo || extratos.filter(e => e.conta_id === contaId && e.status === 'pendente'))
      .filter(e => !periodosFechados.has(String(e.data?.data || '').slice(0, 7)))
    if (!linhas.length) { showToast('Nenhuma linha pendente da fatura.', 'info'); return }
    setCriandoCompras(true)
    try {
      // Compras do cartão INCLUINDO as não escrituradas: casar uma parcela com a
      // linha da própria fatura é identidade (mesma série, mesma parcela), não
      // decisão — duplicar seria pior.
      const { data: todas, error: e1 } = await supabase.from('payable').select('id,parent_id,extrato_id,data').eq('cartao_id', contaId)
      if (e1) throw e1
      const plano = planejarCompras({ conta, linhas, compras: todas || [] })
      if (!plano.criar.length && !plano.casar.length) {
        showToast(plano.pagamentos.length ? 'Só sobraram pagamentos da fatura: concilie-os como ↔ Transferência.' : 'Nada a criar.', 'info')
        return
      }
      const ok = await confirmar({
        titulo: 'Transformar as linhas da fatura em compras do cartão?',
        texto: resumoPlano(plano),
        consequencias: [
          'As compras nascem já conciliadas com a fatura.',
          'Elas vão para a Escrituração, onde você classifica e define a situação fiscal.',
          'Parcela futura de compra parcelada nasce pendente — o cartão ainda não cobrou.',
        ],
        confirmarLabel: 'Criar compras',
        width: 560,
      })
      if (!ok) return
      const codigos = await proximosCodigosPayable(plano.criar.length)
      const p_criar = plano.criar.map((c, i) => ({ ...c, codigo: codigos[i] }))
      const { data: n, error } = await supabase.rpc('conciliar_fatura_cartao', { p_conta_id: contaId, p_criar, p_casar: plano.casar })
      if (error) throw error
      showToast(`${n} linha(s) da fatura conciliada(s) (${p_criar.filter(c => c.extrato_id).length} compra(s) nova(s), ${plano.casar.length} casada(s)). Próximo passo: Escrituração.`, 'success')
      setSelecionado(null); carregar()
    } catch (e) { showToast('Erro ao criar compras: ' + (e.message || e), 'error') }
    finally { setCriandoCompras(false) }
  }

  async function arquivar(extrato) {
    const ok = await confirmar({
      titulo: 'Arquivar esta linha?',
      texto: 'Use para movimento que não é da empresa.',
      consequencias: [
        'Ela não vira lançamento nenhum.',
        'Sai da lista de pendentes, mas continua guardada — dá para restaurar depois.',
      ],
      confirmarLabel: 'Arquivar',
    })
    if (!ok) return
    await supabase.from('transacoes_extrato').update({ status: 'ignorado' }).eq('id', extrato.id)
    showToast('Arquivada.', 'info'); setSelecionado(null); carregar()
  }
  async function restaurar(extrato) {
    await supabase.from('transacoes_extrato').update({ status: 'pendente' }).eq('id', extrato.id)
    showToast('Voltou pra pendentes.', 'info'); setSelecionado(null); carregar()
  }
  async function desconciliar(extrato) {
    if (extrato.lancamento_tipo === 'transferencia') {
      const ok = await confirmar({
        titulo: 'Desfazer a conciliação desta transferência?',
        consequencias: [
          'Esta linha do extrato volta para pendente.',
          'Se a outra conta ainda estiver ligada à transferência, ela continua registrada.',
          'Se não estiver, a transferência é removida.',
        ],
        confirmarLabel: 'Desfazer',
        variante: 'perigo',
      })
      if (!ok) return
      const { error } = await supabase.rpc('desconciliar_transferencia', { p_extrato_id: extrato.id })
      if (error) { showToast('Erro: ' + error.message, 'error'); return }
      showToast('Desconciliado.', 'info'); setSelecionado(null); carregar(); return
    }
    const ok = await confirmar({
      titulo: 'Desfazer esta conciliação?',
      consequencias: [
        'Os lançamentos vinculados voltam para pendente.',
        'Os ajustes criados aqui — retenções, tarifas, juros — são removidos.',
        'A linha do extrato volta a esperar decisão.',
      ],
      confirmarLabel: 'Desconciliar',
      variante: 'perigo',
    })
    if (!ok) return
    try {
      const d = extrato.data || {}
      const target = d.tipo === 'entrada' ? 'receivable' : 'payable'
      // Conciliação múltipla — pela mesa (lancamento_ids) OU pelo modal de fatura
      // antigo (lancamento_pares_ids). Antes o modal caía no "else" e as N compras
      // ficavam presas como conciliadas com nada, sumindo do pool pra sempre.
      const idsMulti = Array.isArray(d.lancamento_ids) ? d.lancamento_ids
        : (Array.isArray(d.lancamento_pares_ids) ? d.lancamento_pares_ids : null)
      if (idsMulti && (d.conciliado_multiplo || d.conciliado_como === 'fatura_cartao')) {
        // Volta cada lançamento pra Pendente e apaga os ajustes.
        for (const lid of idsMulti) {
          const { data: row } = await supabase.from(target).select('data').eq('id', lid).single()
          if (row) {
            const nd = { ...(row.data || {}), status: 'Pendente', data_pagamento: null }
            await supabase.from(target).update({ data: nd, conciliado_em: null, extrato_id: null }).eq('id', lid)
          }
        }
        await supabase.from('receivable').delete().eq('extrato_id', extrato.id).eq('data->>criado_via_conciliacao_ajuste', 'true')
        await supabase.from('payable').delete().eq('extrato_id', extrato.id).eq('data->>criado_via_conciliacao_ajuste', 'true')
      } else {
        // Link único (banco ou linha da fatura). No cartão a compra continua
        // "Pago" (a fatura cobrou) — só perde o vínculo com a linha.
        const tipo = extrato.lancamento_tipo, lid = extrato.lancamento_id
        if (tipo && lid) await supabase.from(tipo).update({ conciliado_em: null, extrato_id: null }).eq('id', lid)
      }
      await supabase.from('transacoes_extrato').update({ status: 'pendente', lancamento_tipo: null, lancamento_id: null }).eq('id', extrato.id)
      showToast('Desconciliado.', 'info'); setSelecionado(null); carregar()
    } catch (e) { showToast('Erro ao desconciliar: ' + e.message, 'error') }
  }

  function limparPeriodo() {
    setDataDe(''); setDataAte('')
  }

  // ── Trava/fechamento de período ──────────────────────────────────────
  async function fecharPeriodo(comp) {
    if (!comp || !contaId) return
    const ok = await confirmar({
      titulo: `Fechar ${comp} nesta conta?`,
      consequencias: [
        'As linhas do extrato desse mês ficam travadas.',
        'Não dá para conciliar nem desconciliar nada dele enquanto estiver fechado.',
        'Você pode reabrir quando precisar.',
      ],
      confirmarLabel: 'Fechar período',
    })
    if (!ok) return
    const { error } = await supabase.from('conciliacao_periodos').insert({ conta_id: contaId, competencia: comp })
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast(`Período ${comp} fechado. 🔒`, 'success'); setSelecionado(null); carregar()
  }
  async function reabrirPeriodo(comp) {
    const ok = await confirmar({
      titulo: `Reabrir ${comp}?`,
      consequencias: ['O período volta a aceitar conciliação e desconciliação.'],
      confirmarLabel: 'Reabrir',
    })
    if (!ok) return
    const { error } = await supabase.from('conciliacao_periodos').delete().eq('conta_id', contaId).eq('competencia', comp)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast(`Período ${comp} reaberto. 🔓`, 'info'); carregar()
  }

  // Vista 2 colunas: linha selecionada + notas em aberto rankeadas pra ela
  const selecionadoExt = useMemo(
    () => extratosFiltrados.find(e => e.id === selecionado) || null,
    [extratosFiltrados, selecionado]
  )
  const compSelec = selecionadoExt?.data?.data ? String(selecionadoExt.data.data).slice(0, 7) : null
  const periodoFechadoSelec = compSelec ? periodosFechados.has(compSelec) : false
  const lancsRank = useMemo(() => {
    if (!selecionadoExt || selecionadoExt.status !== 'pendente') return { sugeridos: [], mesmoValor: [], resto: [] }
    const tipo = selecionadoExt.data?.tipo
    // Candidatas = notas não conciliadas (já vêm assim do banco), menos Provisão.
    // Inclui as já Recebido/Pago — o que importa é não estarem amarradas ao extrato.
    // No cartão, entrada = pagamento/estorno: não há nota pra casar.
    if (ehCartao && tipo === 'entrada') return { sugeridos: [], mesmoValor: [], resto: [] }
    const pool = (tipo === 'entrada' ? receivable : payableDaConta).filter(c => c.status !== 'Provisão')
    const todas = sugerirMatches({ ...(selecionadoExt.data || {}), fit_id: selecionadoExt.fit_id }, pool)
    const sugeridos = todas.filter(s => s.dentroTol)       // valor exato + data próxima
    const mesmoValor = todas.filter(s => !s.dentroTol)      // valor exato, data diferente
    const usados = new Set(todas.map(s => s.lancamento.id))
    let resto = pool.filter(l => !usados.has(l.id))
    // Escopa a lista "outras notas" ao PERÍODO do extrato (por vencimento) — pra
    // conciliar o caixa de um período sem uma lista gigante de todas as notas.
    // (Os matches por valor acima ficam SEM esse limite, pra não sumir nota paga fora do mês.)
    if (notasNoPeriodo) {
      if (dataDe) resto = resto.filter(l => !l.due || l.due >= dataDe)
      if (dataAte) resto = resto.filter(l => !l.due || l.due <= dataAte)
    }
    if (buscaNota.trim()) {
      const q = buscaNota.trim().toLowerCase()
      resto = resto.filter(l => `${l.data?.client || ''} ${l.data?.supplier || ''} ${l.desc || ''} ${l.codigo || ''}`.toLowerCase().includes(q))
    }
    resto.sort((a, b) => (b.due || '').localeCompare(a.due || ''))
    return { sugeridos, mesmoValor, resto }
  }, [selecionadoExt, receivable, payableDaConta, ehCartao, notasNoPeriodo, dataDe, dataAte, buscaNota])

  // ── Mesa: pool de lançamentos, tipos de ajuste e a matemática do fechamento ──
  const poolLanc = useMemo(() => {
    if (!selecionadoExt || selecionadoExt.status !== 'pendente') return []
    const tipo = selecionadoExt.data?.tipo
    if (ehCartao && tipo === 'entrada') return []
    return (tipo === 'entrada' ? receivable : payableDaConta).filter(c => c.status !== 'Provisão')
  }, [selecionadoExt, receivable, payableDaConta, ehCartao])

  const tiposAjuste = selecionadoExt?.data?.tipo === 'entrada' ? AJUSTES_ENTRADA : AJUSTES_SAIDA

  const mesa = useMemo(() => {
    const B = Math.abs(Number(selecionadoExt?.data?.valor || 0))
    const selec = poolLanc.filter(l => marcados.has(l.id))
    const S = selec.reduce((a, l) => a + Number(l.value || 0), 0)
    let aNet = 0
    for (const aj of ajustes) {
      const v = Number(aj.valor || 0)
      if (!v) continue
      if (aj.key === 'suspense') { aNet += aj.sinal === 'acresce' ? v : -v; continue }
      const def = tiposAjuste.find(t => t.key === aj.key)
      if (!def) continue
      aNet += def.natureza === 'acresce' ? v : -v
    }
    const diff = +(B - (S + aNet)).toFixed(2)
    return { B, S, aNet, diff, nSel: selec.length, ok: selec.length > 0 && Math.abs(diff) < 0.01 }
  }, [selecionadoExt, poolLanc, marcados, ajustes, tiposAjuste])

  if (loading) return <AppLayout title="Conciliação"><div style={emptyState}>Carregando…</div></AppLayout>
  if (erro) return <AppLayout title="Conciliação"><EstadoErro onRetry={carregar} /></AppLayout>
  if (contas.length === 0) return (
    <AppLayout title="Conciliação">
      <div style={emptyState}>
        Nenhuma conta bancária cadastrada. <a href="/contas-bancarias" style={{ color: 'var(--gold)', textDecoration: 'underline', fontWeight: 600 }}>Cadastrar conta</a>.
      </div>
    </AppLayout>
  )

  return (
    <AppLayout
      title="Conciliação Bancária"
      stickyTop={(
        <>
          {/* Topo: conta + upload + saldos */}
          <div style={topo}>
            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={labelTopo}>Conta</label>
                <select value={contaId} onChange={e => { setContaId(e.target.value); setSaldoBanco(null); setPeriodoInicializado(false); setSelecionado(null) }} style={select}>
                  {contas.map(c => <option key={c.id} value={c.id}>{c.data?.tipo === 'cartao' ? '💳 ' : '🏦 '}{c.data?.nome || '(sem nome)'}</option>)}
                </select>
              </div>
              <label style={btnUpload} title={ehCartao ? 'OFX da fatura do cartão' : 'OFX do extrato da conta'}>
                <input type="file" onChange={handleUpload} accept=".ofx,.OFX" style={{ display: 'none' }} disabled={uploading} />
                {uploading ? '⏳ Processando…' : (ehCartao ? '📥 Importar OFX da fatura' : '📥 Importar OFX')}
              </label>
              {ehCartao && counts.pendente > 0 && (
                <button onClick={() => criarComprasDaFatura()} disabled={criandoCompras} style={btnAuto} title="Transforma as linhas pendentes da fatura em compras do cartão (casa com parcelas já registradas; pagamentos ficam pra transferência)">
                  {criandoCompras ? '⏳ Criando…' : `＋ Criar compras (${counts.pendente} linha(s))`}
                </button>
              )}
              {!ehCartao && counts.pendente > 0 && (
                <button onClick={conciliarAutomatico} disabled={autoConc} style={btnAuto} title="Concilia os que batem exato (valor + data), sem ambiguidade — pede confirmação">
                  {autoConc ? '⏳ Conciliando…' : '⚡ Conciliar automáticos'}
                </button>
              )}
            </div>
            <div style={saldosBox}>
              <Saldo label={ehCartao ? 'Saldo na fatura' : 'Saldo no Banco'} sub={ehCartao ? 'pelo OFX do cartão' : 'da conta no banco'} valor={saldoBancoFinal} dim={saldoBancoFinal == null} />
              <Saldo label="Saldo no Sistema" sub="conciliado nesta conta" valor={saldoSistema} />
              <Saldo
                label="Divergência"
                sub={divergencia == null ? 'importe OFX' : (Math.abs(divergencia) < 0.01 ? '✓ tudo bate' : 'falta conciliar')}
                valor={divergencia}
                cor={divergencia == null ? 'var(--text-mid)' : (Math.abs(divergencia) < 0.01 ? 'var(--green)' : 'var(--red)')}
                dim={divergencia == null}
              />
            </div>
          </div>

          {/* Filtros — tudo em uma linha */}
          <div style={filtrosBar}>
            <input type="date" value={dataDe} onChange={e => setDataDe(e.target.value)} style={inputData} title="De" />
            <span style={filtroSep}>até</span>
            <input type="date" value={dataAte} onChange={e => setDataAte(e.target.value)} style={inputData} title="Até" />
            {(dataDe || dataAte) && (
              <button onClick={limparPeriodo} style={btnLimpar} title="Limpar período">×</button>
            )}
            <div style={divisor} />
            <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)} style={selectFiltro} title="Status">
              <option value="todos">Todos ({counts.pendente + counts.conciliado + counts.ignorado})</option>
              <option value="pendente">⏳ Pendentes ({counts.pendente})</option>
              <option value="conciliado">✓ Conciliados ({counts.conciliado})</option>
              <option value="ignorado">🗄 Arquivados ({counts.ignorado})</option>
            </select>
            <div style={divisor} />
            <input value={filtroBusca} onChange={e => setFiltroBusca(e.target.value)} placeholder="🔍 Buscar..." style={{ ...inputFiltro, flex: 1, minWidth: 140 }} />
            <input type="number" value={filtroValorMin} onChange={e => setFiltroValorMin(e.target.value)} placeholder="R$ mín" style={{ ...inputFiltro, width: 80 }} />
            <input type="number" value={filtroValorMax} onChange={e => setFiltroValorMax(e.target.value)} placeholder="R$ máx" style={{ ...inputFiltro, width: 80 }} />
          </div>

        </>
      )}
    >
      {extratosFiltrados.length === 0 ? (
        <div style={emptyState}>
          {extratos.filter(e => e.conta_id === contaId).length === 0
            ? 'Importe um OFX pra começar.'
            : 'Nenhuma transação com os filtros aplicados.'}
        </div>
      ) : (
        <div style={dualGrid}>
          {/* ESQUERDA — extrato do banco */}
          <div style={painel}>
            <div style={painelHead}>Extrato do banco <span style={painelCount}>{extratosFiltrados.length}</span></div>
            <div style={painelBody}>
              {extratosFiltrados.map(ext => {
                const sel = selecionado === ext.id
                const t = ext.data?.tipo
                return (
                  <div key={ext.id} onClick={() => setSelecionado(sel ? null : ext.id)} style={{ ...extRow, ...(sel ? extRowSel : {}), opacity: ext.status === 'ignorado' ? 0.5 : 1 }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--navy)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {ext.data?.revisar && <span title={ext.data?.revisar_motivo} style={{ marginRight: 5 }}>⚠️</span>}
                        {ext.data?.descricao || '(sem descrição)'}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-mid)' }}>
                        {fmtDataBR(ext.data?.data)}
                        {ext.status === 'conciliado' && (ext.lancamento_tipo === 'transferencia' ? ' · ↔ transferência' : ' · ✓ conciliado')}
                        {ext.status === 'ignorado' && ' · arquivada'}
                      </div>
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 13, color: t === 'entrada' ? 'var(--green)' : 'var(--red)', whiteSpace: 'nowrap' }}>
                      {t === 'entrada' ? '+' : '−'} {fmtMoney(Number(ext.data?.valor || 0))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* DIREITA — notas a conciliar com a linha selecionada */}
          <div style={painel}>
            <div style={painelHead}>Notas a conciliar {selecionadoExt && selecionadoExt.status === 'pendente' && <span style={painelCount}>{lancsRank.sugeridos.length + lancsRank.mesmoValor.length + lancsRank.resto.length}</span>}</div>
            <div style={painelBody}>
              {!selecionadoExt ? (
                <div style={dicaVazia}>{ehCartao
                  ? <>👈 Clique numa linha da fatura. Compra → casa com uma já registrada ou <strong>＋ Criar compra</strong>. Pagamento da fatura → <strong>↔ Transferência</strong> da conta corrente.</>
                  : <>👈 Clique numa linha do extrato à esquerda. Aí você marca as notas que <strong>somam</strong> aquele valor (e explica retenções/tarifas nos ajustes) — só concilia quando fecha. Pagamento de fatura de cartão → <strong>↔ Transferência</strong>.</>}</div>
              ) : periodoFechadoSelec ? (
                <div style={dicaVazia}>🔒 O período <strong>{compSelec}</strong> está <strong>fechado</strong> — a conciliação deste mês está travada. <button onClick={() => reabrirPeriodo(compSelec)} style={btnLink}>↻ Reabrir período</button></div>
              ) : selecionadoExt.status !== 'pendente' ? (
                <div style={dicaVazia}>
                  Essa linha já está <strong>{selecionadoExt.status}</strong>.{' '}
                  <button onClick={() => selecionadoExt.status === 'conciliado' ? desconciliar(selecionadoExt) : restaurar(selecionadoExt)} style={btnLink}>
                    {selecionadoExt.status === 'conciliado' ? '↶ Desconciliar' : '↻ Restaurar'}
                  </button>
                </div>
              ) : (
                <>
                  <div style={acoesBar}>
                    {ehCartao
                      ? (selecionadoExt.data?.tipo === 'saida' || !ehPagamentoFatura(selecionadoExt.data?.descricao)) && (
                        <button onClick={() => criarComprasDaFatura([selecionadoExt])} disabled={criandoCompras} style={btnAcao}>
                          {selecionadoExt.data?.tipo === 'saida' ? '＋ Criar compra' : '＋ Estorno / crédito no cartão'}
                        </button>
                      )
                      : <button onClick={() => { setCriarAberto(v => !v); setTransfAberto(false) }} style={criarAberto ? { ...btnAcao, borderColor: 'var(--navy)', color: 'var(--navy)' } : btnAcao}>+ Criar lançamento</button>}
                    <button onClick={() => abrirTransferencia(selecionadoExt)} style={transfAberto ? { ...btnAcao, borderColor: 'var(--navy)', color: 'var(--navy)' } : btnAcao}>↔ Transferência{ehCartao && selecionadoExt.data?.tipo === 'entrada' ? ' (pagamento da fatura)' : ''}</button>
                    <button onClick={() => arquivar(selecionadoExt)} style={{ ...btnAcao, color: 'var(--text-mid)' }}>🗄 Arquivar</button>
                  </div>
                  {transfAberto && (
                    <div style={criarBox}>
                      <div style={{ fontSize: 11, color: 'var(--text-mid)', marginBottom: 8, lineHeight: 1.5 }}>
                        {selecionadoExt.data?.tipo === 'saida'
                          ? <>Este débito de <strong>{fmtMoney(Math.abs(Number(selecionadoExt.data?.valor || 0)))}</strong> é dinheiro que <strong>saiu desta conta para outra conta sua</strong> (ex.: pagamento da fatura do cartão). Não é despesa: é transferência.</>
                          : <>Este crédito de <strong>{fmtMoney(Math.abs(Number(selecionadoExt.data?.valor || 0)))}</strong> é dinheiro que <strong>veio de outra conta sua</strong>{ehCartao ? ' (o pagamento da fatura, saído da conta corrente)' : ''}. Não é receita: é transferência.</>}
                      </div>
                      {transfCompativeis.length > 0 && (
                        <div style={{ marginBottom: 8 }}>
                          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-mid)', marginBottom: 4 }}>Já registrada pela outra conta — ligar a esta:</div>
                          {transfCompativeis.map(t => (
                            <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--navy)', padding: '4px 0', cursor: 'pointer' }}>
                              <input type="radio" name="tligar" checked={tLigar === t.id} onChange={() => setTLigar(t.id)} />
                              <span><strong>{t.codigo}</strong> · {fmtDataBR(t.data)} · {fmtMoney(t.valor)} · {contas.find(c => c.id === t.de_conta_id)?.data?.nome || '?'} → {contas.find(c => c.id === t.para_conta_id)?.data?.nome || '?'}</span>
                            </label>
                          ))}
                          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--navy)', padding: '4px 0', cursor: 'pointer' }}>
                            <input type="radio" name="tligar" checked={!tLigar} onChange={() => setTLigar('')} />
                            <span>Registrar uma transferência nova</span>
                          </label>
                        </div>
                      )}
                      {!tLigar && (
                        <select value={tOutraConta} onChange={e => setTOutraConta(e.target.value)} style={ajSelect}>
                          <option value="">— {selecionadoExt.data?.tipo === 'saida' ? 'para qual conta foi?' : 'de qual conta veio?'} —</option>
                          {outrasContas.map(c => <option key={c.id} value={c.id}>{c.data?.tipo === 'cartao' ? '💳 ' : '🏦 '}{c.data?.nome}</option>)}
                        </select>
                      )}
                      {outrasContas.length === 0 && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 6 }}>Cadastre a outra conta (ou o cartão) em Contas e Cartões antes.</div>}
                      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                        <button onClick={() => conciliarTransferencia(selecionadoExt)} disabled={conciliando || (!tLigar && !tOutraConta)} style={{ ...btnConciliar, width: 'auto', marginTop: 0, padding: '8px 16px', opacity: (tLigar || tOutraConta) && !conciliando ? 1 : 0.5, cursor: (tLigar || tOutraConta) && !conciliando ? 'pointer' : 'not-allowed' }}>✓ Conciliar como transferência</button>
                        <button onClick={() => setTransfAberto(false)} style={btnAcao}>Cancelar</button>
                      </div>
                    </div>
                  )}
                  {ehCartao && selecionadoExt.data?.tipo === 'entrada' && !transfAberto && (
                    <div style={{ fontSize: 11, color: 'var(--text-mid)', padding: '2px 4px 8px', lineHeight: 1.5 }}>
                      {ehPagamentoFatura(selecionadoExt.data?.descricao)
                        ? <>Esta linha tem cara de <strong>pagamento da fatura</strong>: concilie como <strong>↔ Transferência</strong> vinda da conta corrente.</>
                        : <>Crédito na fatura: se for estorno/desconto, use <strong>＋ Estorno / crédito</strong>; se for o pagamento da fatura, <strong>↔ Transferência</strong>.</>}
                    </div>
                  )}
                  {criarAberto && !ehCartao && (
                    <div style={criarBox}>
                      <div style={{ fontSize: 11, color: 'var(--text-mid)', marginBottom: 8, lineHeight: 1.5 }}>
                        Cria uma {selecionadoExt.data?.tipo === 'entrada' ? 'receita' : 'despesa'} nova de <strong>{fmtMoney(Math.abs(Number(selecionadoExt.data?.valor || 0)))}</strong> e concilia. <strong>Classifique</strong>:
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <select value={nCat} onChange={e => { setNCat(e.target.value); setNSubcat('') }} style={ajSelect}>
                          <option value="">— categoria —</option>
                          {categoriasDe(plano, selecionadoExt.data?.tipo === 'entrada' ? 'Entrada' : 'Saída').map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        {(() => {
                          const subs = subcategoriasDe(plano, selecionadoExt.data?.tipo === 'entrada' ? 'Entrada' : 'Saída', nCat)
                          return (
                            <select value={nSubcat} onChange={e => setNSubcat(e.target.value)} style={{ ...ajSelect, opacity: subs.length ? 1 : 0.5 }} disabled={!subs.length}>
                              <option value="">{subs.length ? '— subcategoria (opcional) —' : 'sem subcategoria'}</option>
                              {subs.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                          )
                        })()}
                      </div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                        <button onClick={() => criarLancamento(selecionadoExt)} disabled={!nCat} style={{ ...btnConciliar, width: 'auto', marginTop: 0, padding: '8px 16px', opacity: nCat ? 1 : 0.5, cursor: nCat ? 'pointer' : 'not-allowed' }}>✓ Criar e conciliar</button>
                        <button onClick={() => setCriarAberto(false)} style={btnAcao}>Cancelar</button>
                      </div>
                    </div>
                  )}
                  {!(ehCartao && selecionadoExt.data?.tipo === 'entrada') && (
                  <div style={{ fontSize: 11, color: 'var(--text-mid)', padding: '2px 4px 8px', lineHeight: 1.5 }}>
                    {ehCartao
                      ? <>Se esta compra <strong>já está registrada</strong> (ex.: parcela de série ou lançamento manual), marque-a abaixo e concilie. Senão, <strong>＋ Criar compra</strong>.</>
                      : <>Marque as notas que <strong>somam</strong> este valor. Se veio líquido (retenção, tarifa, juros), explique a diferença nos <strong>ajustes</strong> — só concilia quando fecha.</>}
                  </div>
                  )}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '0 4px 8px', flexWrap: 'wrap' }}>
                    <input value={buscaNota} onChange={e => setBuscaNota(e.target.value)} placeholder="🔍 Buscar nota..." style={{ ...inputFiltro, flex: 1, minWidth: 120 }} />
                    <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-mid)', cursor: 'pointer', whiteSpace: 'nowrap' }} title="Mostrar só as notas com vencimento no período filtrado do extrato">
                      <input type="checkbox" checked={notasNoPeriodo} onChange={e => setNotasNoPeriodo(e.target.checked)} /> só do período
                    </label>
                  </div>
                  {lancsRank.sugeridos.length > 0 && <div style={grupoLabel}>💡 Provavelmente é esta</div>}
                  {lancsRank.sugeridos.map((s, i) => (
                    <LancCard key={s.lancamento.id + '_' + i} lanc={s.lancamento} motivo={s.motivo} destaque marcado={marcados.has(s.lancamento.id)} onToggle={() => toggleMarcado(s.lancamento.id)} />
                  ))}
                  {lancsRank.mesmoValor.length > 0 && <div style={grupoLabel}>💰 Mesmo valor (data diferente)</div>}
                  {lancsRank.mesmoValor.map((s, i) => (
                    <LancCard key={s.lancamento.id + '_mv_' + i} lanc={s.lancamento} motivo={s.motivo} marcado={marcados.has(s.lancamento.id)} onToggle={() => toggleMarcado(s.lancamento.id)} />
                  ))}
                  {lancsRank.resto.length > 0 && <div style={grupoLabel}>Outras notas em aberto</div>}
                  {lancsRank.resto.map(l => (
                    <LancCard key={l.id} lanc={l} marcado={marcados.has(l.id)} onToggle={() => toggleMarcado(l.id)} />
                  ))}
                  {!(ehCartao && selecionadoExt.data?.tipo === 'entrada') && lancsRank.sugeridos.length + lancsRank.mesmoValor.length + lancsRank.resto.length === 0 && (
                    <div style={dicaVazia}>{ehCartao ? <>Nenhuma compra registrada pra casar. Use <strong>＋ Criar compra</strong> acima.</> : <>Nenhuma nota em aberto pra casar. Use <strong>+ Criar lançamento</strong> acima.</>}</div>
                  )}

                  {!ehCartao && <>
                  <div style={grupoLabel}>Ajustes — formação do valor</div>
                  {ajustes.map(a => (
                    <div key={a.id} style={ajusteRow}>
                      {a.key === 'suspense' ? (
                        <div style={{ ...ajSelect, display: 'flex', alignItems: 'center', color: 'var(--gold-dark)', fontWeight: 600, background: 'rgba(204,145,94,0.10)' }}>⚠️ Diferença a esclarecer (suspense)</div>
                      ) : (
                        <select value={a.key} onChange={e => updAjuste(a.id, 'key', e.target.value)} style={ajSelect}>
                          {tiposAjuste.map(t => <option key={t.key} value={t.key}>{t.label} ({t.natureza === 'reduz' ? '−' : '+'})</option>)}
                        </select>
                      )}
                      <input type="number" step="0.01" value={a.valor} onChange={e => updAjuste(a.id, 'valor', e.target.value)} placeholder="R$" style={ajInput} />
                      <button onClick={() => rmAjuste(a.id)} style={ajRm} title="Remover">×</button>
                    </div>
                  ))}
                  <button onClick={addAjuste} style={{ ...btnLink, display: 'block', padding: '6px 4px' }}>+ Adicionar ajuste (retenção, tarifa, juros, desconto…)</button>
                  </>}

                  {!(ehCartao && selecionadoExt.data?.tipo === 'entrada') && (
                  <div style={diffPanel}>
                    <div style={diffRow}><span>Extrato</span><strong>{fmtMoney(mesa.B)}</strong></div>
                    <div style={diffRow}><span>Selecionado ({mesa.nSel})</span><strong>{fmtMoney(mesa.S)}</strong></div>
                    {mesa.aNet !== 0 && <div style={diffRow}><span>Ajustes</span><strong>{mesa.aNet > 0 ? '+' : ''}{fmtMoney(mesa.aNet)}</strong></div>}
                    <div style={{ ...diffRow, ...diffTotal, color: mesa.ok ? 'var(--green)' : 'var(--red)' }}>
                      <span>Diferença</span><strong>{fmtMoney(mesa.diff)}{mesa.ok ? ' ✓' : ''}</strong>
                    </div>
                    <button onClick={conciliarMultiplo} disabled={!mesa.ok || conciliando} style={{ ...btnConciliar, opacity: (mesa.ok && !conciliando) ? 1 : 0.5, cursor: (mesa.ok && !conciliando) ? 'pointer' : 'not-allowed' }}>
                      {conciliando ? 'Conciliando…' : `✓ Conciliar${mesa.nSel ? ` ${mesa.nSel} nota(s)` : ''}`}
                    </button>
                    {!mesa.ok && mesa.nSel > 0 && (
                      <>
                        <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 6, textAlign: 'center' }}>Falta explicar {fmtMoney(Math.abs(mesa.diff))} — some outra nota ou adicione um ajuste.</div>
                        {!ehCartao && <button onClick={jogarSuspense} style={btnSuspense}>⚠️ Não sei agora — jogar {fmtMoney(Math.abs(mesa.diff))} em suspense</button>}
                      </>
                    )}
                  </div>
                  )}
                  {compSelec && (
                    <button onClick={() => fecharPeriodo(compSelec)} style={{ ...btnLink, display: 'block', marginTop: 12, color: 'var(--text-mid)', textAlign: 'center', width: '100%' }}>🔒 Fechar período {compSelec} (trava a conciliação deste mês)</button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    {dialogoConfirmacao}
    </AppLayout>
  )
}

function LancCard({ lanc, motivo, destaque, marcado, onToggle }) {
  const nome = lanc.data?.client || lanc.data?.supplier || lanc.desc || lanc.data?.desc || lanc.codigo || '(sem nome)'
  const st = (lanc.status || '').toLowerCase()
  const jaLiquidado = st === 'recebido' || st === 'pago'
  return (
    <div onClick={onToggle} style={{ ...lancCard, ...(destaque ? lancCardDestaque : {}), ...(marcado ? lancCardMarcado : {}), cursor: 'pointer' }}>
      <input type="checkbox" checked={!!marcado} onChange={onToggle} onClick={e => e.stopPropagation()} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--navy)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {nome}
          {jaLiquidado && <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, color: 'var(--green)', background: 'rgba(39,174,96,0.12)', padding: '1px 6px', borderRadius: 999, textTransform: 'uppercase' }}>{lanc.status}</span>}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-mid)' }}>
          {lanc.codigo || '—'} · {lanc.cartao_id ? `compra ${(lanc.data?.data_competencia || lanc.due || '').split('-').reverse().join('/')}` : `vence ${lanc.due ? lanc.due.split('-').reverse().join('/') : '—'}`}
          {motivo ? ` · ${motivo}` : ''}
        </div>
      </div>
      <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--navy)', whiteSpace: 'nowrap' }}>{fmtMoney(lanc.value)}</div>
    </div>
  )
}

function Saldo({ label, valor, cor, dim, sub }) {
  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-mid)' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: cor || 'var(--navy)', opacity: dim ? 0.5 : 1 }}>{valor == null ? '—' : fmtMoney(valor)}</div>
      {sub && <div style={{ fontSize: 9, color: cor || 'var(--text-mid)', fontStyle: 'italic', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

const topo = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 14, flexWrap: 'wrap', background: 'var(--white)', padding: 14, borderRadius: 10, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)' }
const labelTopo = { fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-mid)', fontFamily: 'var(--body)' }
const saldosBox = { display: 'flex', gap: 24, alignItems: 'center' }
const select = { padding: '9px 12px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 13, color: 'var(--navy)', background: 'var(--white)', outline: 'none', minWidth: 200 }
const btnUpload = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 6, border: '1.5px solid var(--gold)', background: 'var(--gold)', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', fontFamily: 'var(--body)' }
const btnAuto = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 6, border: '1.5px solid var(--navy)', background: 'var(--navy)', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', fontFamily: 'var(--body)' }

const filtrosBar = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'var(--white)', borderRadius: 10, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)', marginBottom: 14 }
const filtroSep = { fontSize: 11, color: 'var(--text-mid)' }
const divisor = { width: 1, height: 22, background: 'var(--cream-dark)', margin: '0 4px' }
const inputData = { padding: '7px 10px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 12, color: 'var(--navy)', background: 'var(--white)', outline: 'none' }
const btnLimpar = { background: 'none', border: 'none', color: 'var(--text-mid)', cursor: 'pointer', fontSize: 14, fontWeight: 700, fontFamily: 'var(--body)', padding: '4px 6px' }
const selectFiltro = { padding: '7px 28px 7px 10px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 12, color: 'var(--navy)', background: 'var(--white)', outline: 'none', cursor: 'pointer', appearance: 'none', backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path d='M1 1l4 4 4-4' stroke='%2300203E' stroke-width='1.5' fill='none'/></svg>\")", backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center' }
const inputFiltro = { padding: '7px 10px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 12, color: 'var(--navy)', background: 'var(--white)', outline: 'none' }

const btnAcao = { padding: '6px 12px', borderRadius: 4, border: '1.5px solid var(--cream-dark)', background: 'var(--white)', color: 'var(--navy)', cursor: 'pointer', fontSize: 11, fontWeight: 600, fontFamily: 'var(--body)' }
const btnLink = { background: 'none', border: 'none', color: 'var(--gold-dark)', cursor: 'pointer', fontSize: 11, fontWeight: 600, textDecoration: 'underline', fontFamily: 'var(--body)' }
const emptyState = { padding: '60px 24px', textAlign: 'center', fontFamily: 'var(--body)', color: 'var(--text-mid)', fontSize: 13, background: 'var(--white)', borderRadius: 12, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)' }

// Vista 2 colunas
const dualGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14, alignItems: 'start' }
const painel = { background: 'var(--white)', borderRadius: 10, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)', overflow: 'hidden', display: 'flex', flexDirection: 'column', minWidth: 0 }
const painelHead = { display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', background: 'var(--navy)', color: '#fff', fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', borderBottom: '2px solid var(--gold)' }
const painelCount = { marginLeft: 'auto', background: 'rgba(255,255,255,0.15)', padding: '2px 8px', borderRadius: 999, fontSize: 11 }
const painelBody = { padding: 8, maxHeight: '65vh', overflowY: 'auto' }
const extRow = { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, cursor: 'pointer', borderLeft: '3px solid transparent' }
const extRowSel = { background: 'var(--cream)', borderLeftColor: 'var(--gold)' }
const dicaVazia = { padding: '30px 18px', textAlign: 'center', color: 'var(--text-mid)', fontSize: 13, lineHeight: 1.6 }
const acoesBar = { display: 'flex', gap: 6, flexWrap: 'wrap', padding: '4px 4px 12px', borderBottom: '1px dashed var(--cream-dark)', marginBottom: 10 }
const grupoLabel = { fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-mid)', padding: '8px 4px 6px' }
const lancCard = { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, border: '1px solid var(--cream-dark)', marginBottom: 6, background: 'var(--white)' }
const lancCardDestaque = { border: '1.5px solid var(--gold)', background: 'rgba(204,145,94,0.06)' }
const lancCardMarcado = { border: '1.5px solid var(--navy)', background: 'rgba(0,32,62,0.05)' }
const criarBox = { padding: 12, borderRadius: 8, background: 'rgba(0,32,62,0.03)', border: '1px solid var(--cream-dark)', marginBottom: 10 }
const ajusteRow = { display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }
const ajSelect = { flex: 1, minWidth: 0, padding: '7px 8px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 12, color: 'var(--navy)', background: 'var(--white)', outline: 'none' }
const ajInput = { width: 92, padding: '7px 8px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 12, color: 'var(--navy)', background: 'var(--white)', outline: 'none', textAlign: 'right' }
const ajRm = { background: 'none', border: 'none', color: 'var(--text-mid)', fontSize: 18, lineHeight: 1, cursor: 'pointer', padding: '0 4px' }
const diffPanel = { position: 'sticky', bottom: 0, marginTop: 12, padding: 12, borderRadius: 10, background: 'var(--cream)', border: '1px solid var(--cream-dark)', boxShadow: '0 -4px 10px rgba(0,32,62,0.05)' }
const diffRow = { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 12, color: 'var(--navy)', padding: '2px 0' }
const diffTotal = { fontSize: 15, fontWeight: 700, borderTop: '1px solid var(--cream-dark)', marginTop: 4, paddingTop: 6 }
const btnConciliar = { width: '100%', marginTop: 10, padding: '11px', borderRadius: 8, border: 'none', background: 'var(--gold)', color: '#fff', fontSize: 13, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', fontFamily: 'var(--body)' }
const btnSuspense = { width: '100%', marginTop: 8, padding: '9px', borderRadius: 8, border: '1.5px dashed var(--gold-dark)', background: 'rgba(204,145,94,0.08)', color: 'var(--gold-dark)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--body)' }
