import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import AppLayout from '../components/AppLayout'
import EstadoErro from '../components/EstadoErro'
import { showToast } from '../components/Toast'
import ModalConciliarFatura from './components/ModalConciliarFatura'
import { fmtMoney, flatten } from '../lib/finance'
import { parseOFX } from '../lib/ofx'
import { sugerirMatches } from '../lib/matchExtrato'
import { proximoCodigoReceivable, proximoCodigoPayable } from '../lib/codigos'
import { fetchPlanoContas, categoriasDe, subcategoriasDe } from '../lib/planoContas'

// Tipos de ajuste que EXPLICAM a diferença entre o valor do banco e a nota
// (o "valor netado"). Cada um posta num lançamento próprio, na sua categoria —
// nada de diferença sumindo. natureza: 'reduz' = recebi/paguei menos que a nota;
// 'acresce' = veio a mais. tabela = onde o ajuste é postado.
const AJUSTES_ENTRADA = [
  { key: 'irrf', label: 'IRRF retido', natureza: 'reduz', tabela: 'payable', cat: 'Impostos retidos na fonte' },
  { key: 'iss', label: 'ISS retido', natureza: 'reduz', tabela: 'payable', cat: 'Impostos retidos na fonte' },
  { key: 'inss', label: 'INSS retido', natureza: 'reduz', tabela: 'payable', cat: 'Impostos retidos na fonte' },
  { key: 'pcc', label: 'PIS/COFINS/CSLL retido', natureza: 'reduz', tabela: 'payable', cat: 'Impostos retidos na fonte' },
  { key: 'tarifa', label: 'Tarifa bancária', natureza: 'reduz', tabela: 'payable', cat: 'Despesas Financeiras' },
  { key: 'desc', label: 'Desconto concedido', natureza: 'reduz', tabela: 'payable', cat: 'Descontos concedidos' },
  { key: 'juros', label: 'Juros/Multa recebidos', natureza: 'acresce', tabela: 'receivable', cat: 'Receita Financeira' },
]
const AJUSTES_SAIDA = [
  { key: 'juros', label: 'Juros/Multa', natureza: 'acresce', tabela: 'payable', cat: 'Despesas Financeiras' },
  { key: 'tarifa', label: 'Tarifa bancária', natureza: 'acresce', tabela: 'payable', cat: 'Despesas Financeiras' },
  { key: 'multa', label: 'Multa', natureza: 'acresce', tabela: 'payable', cat: 'Despesas Financeiras' },
  { key: 'desc', label: 'Desconto obtido', natureza: 'reduz', tabela: 'receivable', cat: 'Descontos obtidos' },
]

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
  const [autoPendente, setAutoPendente] = useState(false) // dispara conciliação automática após carregar



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
  const [modalFaturaExtrato, setModalFaturaExtrato] = useState(null)
  const [erro, setErro] = useState(null)

  // Zera a seleção/ajustes/form ao trocar a linha do extrato
  useEffect(() => { setMarcados(new Set()); setAjustes([]); setCriarAberto(false); setNCat(''); setNSubcat('') }, [selecionado])

  // Carrega contas uma única vez (não muda quando usuária troca conta selecionada)
  useEffect(() => {
    if (!user) return
    supabase.from('contas_bancarias').select('*').order('updated_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) { setErro(error); return }
        setErro(null)
        const ativos = (data || []).filter(c => c.data?.ativo !== false)
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
    ]).then(([rE, rR, rP, rPer]) => {
      const err = rE.error || rR.error || rP.error
      if (err) { setErro(err); setLoading(false); return }
      setErro(null)
      setExtratos(rE.data || [])
      // PORTÃO DA ESCRITURAÇÃO: só nota ESCRITURADA é candidata a conciliar. Uma nota
      // não revisada (escriturado != true) não sobe pra conciliação — é a 1ª camada da
      // metodologia (escrituração contábil antes do cruzamento financeiro).
      const soEscriturada = arr => (arr || []).filter(r => r.data?.escriturado === true)
      setReceivable(soEscriturada(rR.data).map(flatten))
      setPayable(soEscriturada(rP.data).map(flatten))
      setPeriodosFechados(new Set((rPer.data || []).map(r => r.competencia)))
      setLoading(false)
    })
      .catch((e) => { setErro(e); setLoading(false) })
  }, [user, contaId])

  useEffect(() => { carregar() }, [carregar])

  const conta = useMemo(() => contas.find(c => c.id === contaId), [contas, contaId])

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
  useEffect(() => { setPeriodoInicializado(false); setAutoPendente(true) }, [contaId])

  // Concilia automaticamente os casos óbvios (valor + data + candidato único)
  // logo após carregar — ao abrir a conta e após importar OFX. Silencioso e
  // conservador; o que sobra ambíguo fica pra decisão manual.
  useEffect(() => {
    if (autoPendente && !loading && !autoConc && extratos.length) {
      setAutoPendente(false)
      conciliarAutomatico({ silencioso: true })
    }
  }, [autoPendente, loading, autoConc, extratos])

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
      const { transacoes, saldoFinal } = parseOFX(texto)
      if (!transacoes.length) { showToast('Nenhuma transação no OFX.', 'warning'); return }
      const fitIds = new Set(extratos.filter(e => e.conta_id === contaId && e.fit_id).map(e => e.fit_id))
      const novos = transacoes.filter(t => !t.fit_id || !fitIds.has(t.fit_id))
      if (!novos.length) {
        showToast(`Todas as ${transacoes.length} transações já estavam importadas.`, 'info')
        if (saldoFinal != null) setSaldoBanco(saldoFinal)
        return
      }
      // 1) Upload arquivo + registrar import
      const path = `${user.id}/importacoes/ofx_extrato/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
      let arquivoPath = null
      let uploadFalhou = false
      try {
        const { error: upErr } = await supabase.storage.from('anexos-fiscais').upload(path, file)
        if (!upErr) arquivoPath = path
        else uploadFalhou = true
      } catch (e) { console.warn('upload arquivo OFX falhou:', e.message); uploadFalhou = true }
      const { data: imp, error: errImp } = await supabase.from('importacoes').insert({
        user_id: user.id,
        tipo: 'ofx_extrato',
        arquivo_nome: file.name,
        arquivo_path: arquivoPath,
        qtd_registros: novos.length,
        metadata: { conta_id: contaId, saldo_final: saldoFinal },
      }).select('id').single()
      // Aborta se o cabeçalho falhar: sem ele, os lançamentos ficariam órfãos
      // (importacao_id nulo) e impossíveis de reverter pela tela de Importações.
      if (errImp) throw new Error('Falha ao registrar a importação: ' + errImp.message)
      // 2) Inserir transações com importacao_id
      const payload = novos.map(t => ({
        user_id: user.id, conta_id: contaId, status: 'pendente', fit_id: t.fit_id,
        importacao_id: imp.id, data: t,
      }))
      const { error } = await supabase.from('transacoes_extrato').insert(payload)
      if (error) {
        // Compensa: remove o cabeçalho recém-criado pra não deixar import vazio.
        await supabase.from('importacoes').delete().eq('id', imp.id)
        throw error
      }
      showToast(`${novos.length} transações importadas.`, 'success')
      if (uploadFalhou) showToast('Lançamentos importados, mas o arquivo OFX de origem não foi arquivado (falha no upload).', 'warning')
      if (saldoFinal != null) setSaldoBanco(saldoFinal)
      setPeriodoInicializado(false) // re-aplica range com o que foi importado
      setAutoPendente(true)         // concilia os óbvios sozinho após importar
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
      // Compras de fatura de cartão NÃO entram no auto-match: elas são pagas
      // juntas (na fatura), não por débito avulso. Casar 1 a 1 gera falso
      // positivo (ex.: Mirante R$30 casando com um DÉB.PARCELAS R$30 qualquer).
      const pool = (tipo === 'entrada' ? receivable : payable)
        .filter(c => c.status !== 'Provisão' && !c.data?.criado_via_import_fatura && !usadosLanc.has(c.id))
      const fortes = sugerirMatches(ext.data || {}, pool).filter(s => s.dentroTol)
      if (fortes.length === 1) {
        pares.push({ ext, lanc: fortes[0].lancamento, target: tipo === 'entrada' ? 'receivable' : 'payable' })
        usadosLanc.add(fortes[0].lancamento.id)
      }
    }
    if (!pares.length) { if (!silencioso) showToast('Nenhum match automático seguro (valor + data, sem ambiguidade).', 'info'); return }
    if (!silencioso && !confirm(`Conciliar automaticamente ${pares.length} transação(ões) que batem exato (mesmo valor e data próxima)? As ambíguas ficam pra você decidir uma a uma.`)) return
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
            return { def: { tabela: a.sinal === 'acresce' ? 'receivable' : 'payable', cat: 'Conta transitória (a esclarecer)', label: 'Diferença a esclarecer (suspense)', key: 'suspense', suspense: true }, v }
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
            cat: a.def.cat, subcat: '',
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

  async function marcarTransferencia(extrato) {
    if (!confirm('Marcar como transferência entre contas próprias?')) return
    await supabase.from('transacoes_extrato').update({
      status: 'ignorado',
      data: { ...(extrato.data || {}), motivo: 'transferencia_propria' },
    }).eq('id', extrato.id)
    showToast('Marcado como transferência interna.', 'info')
    setSelecionado(null); carregar()
  }

  async function ignorar(extrato) {
    if (!confirm('Ignorar essa transação?')) return
    await supabase.from('transacoes_extrato').update({ status: 'ignorado' }).eq('id', extrato.id)
    showToast('Ignorada.', 'info'); setSelecionado(null); carregar()
  }
  async function restaurar(extrato) {
    await supabase.from('transacoes_extrato').update({ status: 'pendente' }).eq('id', extrato.id)
    showToast('Voltou pra pendentes.', 'info'); setSelecionado(null); carregar()
  }
  async function desconciliar(extrato) {
    if (!confirm('Desconciliar? Os lançamentos vinculados voltam pra pendente e os ajustes (retenções/tarifas/juros) criados nesta conciliação são removidos.')) return
    try {
      const d = extrato.data || {}
      const target = d.tipo === 'entrada' ? 'receivable' : 'payable'
      if (d.conciliado_multiplo && Array.isArray(d.lancamento_ids)) {
        // Conciliação múltipla: volta cada lançamento pra Pendente e apaga os ajustes.
        for (const lid of d.lancamento_ids) {
          const { data: row } = await supabase.from(target).select('data').eq('id', lid).single()
          if (row) {
            const nd = { ...(row.data || {}), status: 'Pendente', data_pagamento: null }
            await supabase.from(target).update({ data: nd, conciliado_em: null, extrato_id: null }).eq('id', lid)
          }
        }
        await supabase.from('receivable').delete().eq('extrato_id', extrato.id).eq('data->>criado_via_conciliacao_ajuste', 'true')
        await supabase.from('payable').delete().eq('extrato_id', extrato.id).eq('data->>criado_via_conciliacao_ajuste', 'true')
      } else {
        // Caminho antigo (link único) — mantém compatibilidade.
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
    if (!confirm(`Fechar o período ${comp} desta conta? As linhas do extrato desse mês ficam TRAVADAS (não dá pra conciliar nem desconciliar) até você reabrir.`)) return
    const { error } = await supabase.from('conciliacao_periodos').insert({ conta_id: contaId, competencia: comp })
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast(`Período ${comp} fechado. 🔒`, 'success'); setSelecionado(null); carregar()
  }
  async function reabrirPeriodo(comp) {
    if (!confirm(`Reabrir o período ${comp}? Ele volta a aceitar conciliação.`)) return
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
    const pool = (tipo === 'entrada' ? receivable : payable).filter(c => c.status !== 'Provisão')
    const todas = sugerirMatches(selecionadoExt.data || {}, pool)
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
  }, [selecionadoExt, receivable, payable, notasNoPeriodo, dataDe, dataAte, buscaNota])

  // ── Mesa: pool de lançamentos, tipos de ajuste e a matemática do fechamento ──
  const poolLanc = useMemo(() => {
    if (!selecionadoExt || selecionadoExt.status !== 'pendente') return []
    const tipo = selecionadoExt.data?.tipo
    return (tipo === 'entrada' ? receivable : payable).filter(c => c.status !== 'Provisão')
  }, [selecionadoExt, receivable, payable])

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
                <label style={labelTopo}>Conta Bancária</label>
                <select value={contaId} onChange={e => { setContaId(e.target.value); setSaldoBanco(null); setPeriodoInicializado(false) }} style={select}>
                  {contas.map(c => <option key={c.id} value={c.id}>{c.data?.nome || '(sem nome)'}</option>)}
                </select>
              </div>
              <label style={btnUpload}>
                <input type="file" onChange={handleUpload} accept=".ofx,.OFX" style={{ display: 'none' }} disabled={uploading} />
                {uploading ? '⏳ Processando…' : '📥 Importar OFX'}
              </label>
              {counts.pendente > 0 && (
                <button onClick={conciliarAutomatico} disabled={autoConc} style={btnAuto} title="Concilia os que batem exato (valor + data), sem ambiguidade">
                  {autoConc ? '⏳ Conciliando…' : '⚡ Conciliar automáticos'}
                </button>
              )}
            </div>
            <div style={saldosBox}>
              <Saldo label="Saldo no Banco" sub="da conta no banco" valor={saldoBancoFinal} dim={saldoBancoFinal == null} />
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
              <option value="ignorado">⨯ Ignorados ({counts.ignorado})</option>
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
                        {ext.status === 'conciliado' && ' · ✓ conciliado'}
                        {ext.status === 'ignorado' && ' · ignorado'}
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
                <div style={dicaVazia}>👈 Clique numa linha do extrato à esquerda. Aí você marca as notas que <strong>somam</strong> aquele valor (e explica retenções/tarifas nos ajustes) — só concilia quando fecha.</div>
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
                    <button onClick={() => setCriarAberto(v => !v)} style={criarAberto ? { ...btnAcao, borderColor: 'var(--navy)', color: 'var(--navy)' } : btnAcao}>+ Criar lançamento</button>
                    {selecionadoExt.data?.tipo === 'saida' && <button onClick={() => setModalFaturaExtrato(selecionadoExt)} style={btnAcao}>🪪 Fatura de cartão</button>}
                    <button onClick={() => marcarTransferencia(selecionadoExt)} style={btnAcao}>↔ Transferência</button>
                    <button onClick={() => ignorar(selecionadoExt)} style={{ ...btnAcao, color: 'var(--text-mid)' }}>⨯ Ignorar</button>
                  </div>
                  {criarAberto && (
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
                  <div style={{ fontSize: 11, color: 'var(--text-mid)', padding: '2px 4px 8px', lineHeight: 1.5 }}>
                    Marque as notas que <strong>somam</strong> este valor. Se veio líquido (retenção, tarifa, juros), explique a diferença nos <strong>ajustes</strong> — só concilia quando fecha.
                  </div>
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
                  {lancsRank.sugeridos.length + lancsRank.mesmoValor.length + lancsRank.resto.length === 0 && (
                    <div style={dicaVazia}>Nenhuma nota em aberto pra casar. Use <strong>+ Criar lançamento</strong> acima.</div>
                  )}

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
                        <button onClick={jogarSuspense} style={btnSuspense}>⚠️ Não sei agora — jogar {fmtMoney(Math.abs(mesa.diff))} em suspense</button>
                      </>
                    )}
                  </div>
                  {compSelec && (
                    <button onClick={() => fecharPeriodo(compSelec)} style={{ ...btnLink, display: 'block', marginTop: 12, color: 'var(--text-mid)', textAlign: 'center', width: '100%' }}>🔒 Fechar período {compSelec} (trava a conciliação deste mês)</button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
      <ModalConciliarFatura
        open={modalFaturaExtrato != null}
        onClose={() => setModalFaturaExtrato(null)}
        extrato={modalFaturaExtrato}
        onConciliado={() => { setModalFaturaExtrato(null); carregar() }}
      />
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
          {lanc.codigo || '—'} · vence {lanc.due ? lanc.due.split('-').reverse().join('/') : '—'}
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
