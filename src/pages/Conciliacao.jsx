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



  const [selecionado, setSelecionado] = useState(null) // id da linha do extrato selecionada (vista 2 colunas)
  const [modalFaturaExtrato, setModalFaturaExtrato] = useState(null)
  const [erro, setErro] = useState(null)

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
    // Filtra transacoes_extrato POR CONTA no servidor (não traz de outras contas)
    // receivable/payable: só não-finalizados ou conciliados (pra sugestões + manter linkados)
    Promise.all([
      supabase.from('transacoes_extrato').select('*').eq('conta_id', contaId).order('data->>data', { ascending: false }),
      supabase.from('receivable').select('*').or('data->>status.neq.Recebido,conciliado_em.not.is.null'),
      supabase.from('payable').select('*').or('data->>status.neq.Pago,conciliado_em.not.is.null'),
    ]).then(([rE, rR, rP]) => {
      const err = rE.error || rR.error || rP.error
      if (err) { setErro(err); setLoading(false); return }
      setErro(null)
      setExtratos(rE.data || [])
      setReceivable((rR.data || []).map(flatten))
      setPayable((rP.data || []).map(flatten))
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
  useEffect(() => { setPeriodoInicializado(false) }, [contaId])

  // ── Aplica filtros ───────────────────────────────────────────────────
  const extratosFiltrados = useMemo(() => {
    let arr = extratos.filter(e => e.conta_id === contaId)
    if (filtroStatus !== 'todos') arr = arr.filter(e => e.status === filtroStatus)
    if (dataDe) arr = arr.filter(e => (e.data?.data || '') >= dataDe)
    if (dataAte) arr = arr.filter(e => (e.data?.data || '') <= dataAte)
    if (filtroBusca.trim()) {
      const q = filtroBusca.trim().toLowerCase()
      arr = arr.filter(e => (e.data?.descricao || '').toLowerCase().includes(q))
    }
    const vmin = parseFloat(filtroValorMin)
    const vmax = parseFloat(filtroValorMax)
    if (!isNaN(vmin)) arr = arr.filter(e => Number(e.data?.valor || 0) >= vmin)
    if (!isNaN(vmax)) arr = arr.filter(e => Number(e.data?.valor || 0) <= vmax)
    arr.sort((a, b) => (b.data?.data || '').localeCompare(a.data?.data || ''))
    return arr
  }, [extratos, contaId, filtroStatus, dataDe, dataAte, filtroBusca, filtroValorMin, filtroValorMax])

  // ── Contadores ───────────────────────────────────────────────────────
  const counts = useMemo(() => {
    const c = { pendente: 0, conciliado: 0, ignorado: 0 }
    for (const e of extratos) {
      if (e.conta_id === contaId) c[e.status] = (c[e.status] || 0) + 1
    }
    return c
  }, [extratos, contaId])

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
  async function conciliarAutomatico() {
    const pendentes = extratos.filter(e => e.conta_id === contaId && e.status === 'pendente')
    const usadosLanc = new Set()
    const pares = []
    for (const ext of pendentes) {
      const tipo = ext.data?.tipo
      const final = tipo === 'entrada' ? 'Recebido' : 'Pago'
      const pool = (tipo === 'entrada' ? receivable : payable)
        .filter(c => c.status !== final && c.status !== 'Provisão' && !usadosLanc.has(c.id))
      const fortes = sugerirMatches(ext.data || {}, pool).filter(s => s.dentroTol)
      if (fortes.length === 1) {
        pares.push({ ext, lanc: fortes[0].lancamento, target: tipo === 'entrada' ? 'receivable' : 'payable' })
        usadosLanc.add(fortes[0].lancamento.id)
      }
    }
    if (!pares.length) { showToast('Nenhum match automático seguro (valor + data, sem ambiguidade).', 'info'); return }
    if (!confirm(`Conciliar automaticamente ${pares.length} transação(ões) que batem exato (mesmo valor e data próxima)? As ambíguas ficam pra você decidir uma a uma.`)) return
    setAutoConc(true)
    let ok = 0
    try {
      for (const p of pares) {
        const statusNovo = p.target === 'receivable' ? 'Recebido' : 'Pago'
        const merged = { ...(p.lanc.data || {}), status: statusNovo, data_pagamento: p.lanc.data?.data_pagamento || p.ext.data?.data }
        const { error } = await supabase.rpc('conciliar_vincular', { p_extrato_id: p.ext.id, p_target: p.target, p_lanc_id: p.lanc.id, p_merged: merged })
        if (!error) ok++
      }
      showToast(`${ok} transação(ões) conciliada(s) automaticamente.`, 'success')
      setSelecionado(null); carregar()
    } catch (e) { showToast('Erro na conciliação automática: ' + e.message, 'error') }
    finally { setAutoConc(false) }
  }

  // ── Ações ────────────────────────────────────────────────────────────
  async function vincular(extrato, lancamento) {
    const tipoTabela = extrato.data?.tipo === 'entrada' ? 'receivable' : 'payable'
    const statusNovo = tipoTabela === 'receivable' ? 'Recebido' : 'Pago'
    const merged = { ...(lancamento.data || {}), status: statusNovo, data_pagamento: lancamento.data?.data_pagamento || extrato.data?.data }
    try {
      // Atualiza o extrato e o lançamento numa transação atômica (RPC).
      const { error } = await supabase.rpc('conciliar_vincular', {
        p_extrato_id: extrato.id, p_target: tipoTabela, p_lanc_id: lancamento.id, p_merged: merged,
      })
      if (error) throw error
      showToast('Conciliado.', 'success')
      setSelecionado(null); carregar()
    } catch (e) { showToast('Erro: ' + e.message, 'error') }
  }

  async function criarLancamento(extrato) {
    if (!user) return
    const tipoTabela = extrato.data?.tipo === 'entrada' ? 'receivable' : 'payable'
    const dataExt = extrato.data?.data
    const novoLanc = {
      [tipoTabela === 'receivable' ? 'client' : 'supplier']: (extrato.data?.descricao || '').substring(0, 80),
      desc: extrato.data?.descricao,
      value: Number(extrato.data?.valor || 0),
      due: dataExt, data_pagamento: dataExt,
      status: tipoTabela === 'receivable' ? 'Recebido' : 'Pago',
      cat: '', subcat: '', doc_status: 'pendente', sem_documento: true,
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
    if (!confirm('Desconciliar? Lançamento vinculado volta pra pendente.')) return
    const tipo = extrato.lancamento_tipo, lid = extrato.lancamento_id
    await supabase.from('transacoes_extrato').update({ status: 'pendente', lancamento_tipo: null, lancamento_id: null }).eq('id', extrato.id)
    if (tipo && lid) await supabase.from(tipo).update({ conciliado_em: null, extrato_id: null }).eq('id', lid)
    showToast('Desconciliado.', 'info'); setSelecionado(null); carregar()
  }

  function limparPeriodo() {
    setDataDe(''); setDataAte('')
  }

  // Vista 2 colunas: linha selecionada + notas em aberto rankeadas pra ela
  const selecionadoExt = useMemo(
    () => extratosFiltrados.find(e => e.id === selecionado) || null,
    [extratosFiltrados, selecionado]
  )
  const lancsRank = useMemo(() => {
    if (!selecionadoExt || selecionadoExt.status !== 'pendente') return { sugeridos: [], mesmoValor: [], resto: [] }
    const tipo = selecionadoExt.data?.tipo
    const final = tipo === 'entrada' ? 'Recebido' : 'Pago'
    const pool = (tipo === 'entrada' ? receivable : payable).filter(c => c.status !== final && c.status !== 'Provisão')
    const todas = sugerirMatches(selecionadoExt.data || {}, pool)
    const sugeridos = todas.filter(s => s.dentroTol)       // valor exato + data próxima
    const mesmoValor = todas.filter(s => !s.dentroTol)      // valor exato, data diferente
    const usados = new Set(todas.map(s => s.lancamento.id))
    const resto = pool.filter(l => !usados.has(l.id)).sort((a, b) => (b.due || '').localeCompare(a.due || ''))
    return { sugeridos, mesmoValor, resto }
  }, [selecionadoExt, receivable, payable])

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
                <div style={dicaVazia}>👈 Clique numa linha do extrato à esquerda pra ver as notas que combinam — e ligar uma na outra.</div>
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
                    <button onClick={() => criarLancamento(selecionadoExt)} style={btnAcao}>+ Criar lançamento</button>
                    {selecionadoExt.data?.tipo === 'saida' && <button onClick={() => setModalFaturaExtrato(selecionadoExt)} style={btnAcao}>🪪 Fatura de cartão</button>}
                    <button onClick={() => marcarTransferencia(selecionadoExt)} style={btnAcao}>↔ Transferência</button>
                    <button onClick={() => ignorar(selecionadoExt)} style={{ ...btnAcao, color: 'var(--text-mid)' }}>⨯ Ignorar</button>
                  </div>
                  {lancsRank.sugeridos.length > 0 && <div style={grupoLabel}>💡 Provavelmente é esta</div>}
                  {lancsRank.sugeridos.map((s, i) => (
                    <LancCard key={s.lancamento.id + '_' + i} lanc={s.lancamento} motivo={s.motivo} destaque onVincular={() => vincular(selecionadoExt, s.lancamento)} />
                  ))}
                  {lancsRank.mesmoValor.length > 0 && <div style={grupoLabel}>💰 Mesmo valor (data diferente)</div>}
                  {lancsRank.mesmoValor.map((s, i) => (
                    <LancCard key={s.lancamento.id + '_mv_' + i} lanc={s.lancamento} motivo={s.motivo} onVincular={() => vincular(selecionadoExt, s.lancamento)} />
                  ))}
                  {lancsRank.resto.length > 0 && <div style={grupoLabel}>Outras notas em aberto</div>}
                  {lancsRank.resto.map(l => (
                    <LancCard key={l.id} lanc={l} onVincular={() => vincular(selecionadoExt, l)} />
                  ))}
                  {lancsRank.sugeridos.length + lancsRank.mesmoValor.length + lancsRank.resto.length === 0 && (
                    <div style={dicaVazia}>Nenhuma nota em aberto pra casar. Use <strong>+ Criar lançamento</strong> acima.</div>
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

function LancCard({ lanc, motivo, destaque, onVincular }) {
  const nome = lanc.data?.client || lanc.data?.supplier || lanc.desc || lanc.data?.desc || lanc.codigo || '(sem nome)'
  return (
    <div style={{ ...lancCard, ...(destaque ? lancCardDestaque : {}) }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--navy)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nome}</div>
        <div style={{ fontSize: 10, color: 'var(--text-mid)' }}>
          {lanc.codigo} · {fmtMoney(lanc.value)} · vence {lanc.due ? lanc.due.split('-').reverse().join('/') : '—'}
          {motivo ? ` · ${motivo}` : ''}
        </div>
      </div>
      <button onClick={onVincular} style={btnOk}>✓ Ligar</button>
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

const btnOk = { padding: '6px 12px', borderRadius: 4, border: 'none', background: 'var(--gold)', color: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 700, fontFamily: 'var(--body)' }
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
