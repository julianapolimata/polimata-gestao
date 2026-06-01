import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import AppLayout from '../components/AppLayout'
import { showToast } from '../components/Toast'
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
  const [saldoBanco, setSaldoBanco] = useState(null)

  // Filtros
  const [dataDe, setDataDe] = useState('')
  const [dataAte, setDataAte] = useState('')
  const [filtroStatus, setFiltroStatus] = useState('todos')
  const [filtroBusca, setFiltroBusca] = useState('')
  const [filtroValorMin, setFiltroValorMin] = useState('')
  const [filtroValorMax, setFiltroValorMax] = useState('')
  const [periodoInicializado, setPeriodoInicializado] = useState(false)

  // ── JS-controlled sticky header (CSS sticky não escapa do padding do scroll-main) ──
  const headerRef = useRef(null)
  const [fixedHdr, setFixedHdr] = useState(null) // null = não fixo; objeto {top,left,width} = fixo nessa pos

  useEffect(() => {
    const scrollMain = document.querySelector('.scroll-main')
    if (!scrollMain || !headerRef.current) return
    function onScroll() {
      if (!headerRef.current) return
      const hdrRect = headerRef.current.getBoundingClientRect()
      const scrRect = scrollMain.getBoundingClientRect()
      // header natural escondeu acima do topo do scroll-main → ativa fixed
      if (hdrRect.top < scrRect.top) {
        setFixedHdr({ top: scrRect.top, left: hdrRect.left, width: hdrRect.width })
      } else {
        setFixedHdr(null)
      }
    }
    scrollMain.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    onScroll()
    return () => {
      scrollMain.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [contaId])


  const [expandido, setExpandido] = useState(null)

  const carregar = useCallback(() => {
    if (!user) return
    setLoading(true)
    Promise.all([
      supabase.from('contas_bancarias').select('*').order('updated_at', { ascending: false }),
      supabase.from('transacoes_extrato').select('*').order('data->>data', { ascending: false }),
      supabase.from('receivable').select('*'),
      supabase.from('payable').select('*'),
    ]).then(([rC, rE, rR, rP]) => {
      const ativos = (rC.data || []).filter(c => c.data?.ativo !== false)
      setContas(ativos)
      if (ativos.length > 0 && !contaId) setContaId(ativos[0].id)
      setExtratos(rE.data || [])
      setReceivable((rR.data || []).map(flatten))
      setPayable((rP.data || []).map(flatten))
      setLoading(false)
    })
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
  const saldoSistema = useMemo(() => {
    if (!conta) return 0
    const sIni = Number(conta.data?.saldo_inicial || 0)
    const tIn = receivable.filter(r => r.status === 'Recebido').reduce((a, r) => a + r.value, 0)
    const tOut = payable.filter(r => r.status === 'Pago').reduce((a, r) => a + r.value, 0)
    return sIni + tIn - tOut
  }, [conta, receivable, payable])

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
      const payload = novos.map(t => ({
        user_id: user.id, conta_id: contaId, status: 'pendente', fit_id: t.fit_id, data: t,
      }))
      const { error } = await supabase.from('transacoes_extrato').insert(payload)
      if (error) throw error
      showToast(`${novos.length} transações importadas.`, 'success')
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

  // ── Ações ────────────────────────────────────────────────────────────
  async function vincular(extrato, lancamento) {
    const tipoTabela = extrato.data?.tipo === 'entrada' ? 'receivable' : 'payable'
    const agora = new Date().toISOString()
    try {
      await supabase.from('transacoes_extrato').update({
        status: 'conciliado', lancamento_tipo: tipoTabela, lancamento_id: lancamento.id,
      }).eq('id', extrato.id)
      const statusNovo = tipoTabela === 'receivable' ? 'Recebido' : 'Pago'
      const merged = { ...(lancamento.data || {}), status: statusNovo, data_pagamento: lancamento.data?.data_pagamento || extrato.data?.data }
      await supabase.from(tipoTabela).update({ data: merged, conciliado_em: agora, extrato_id: extrato.id }).eq('id', lancamento.id)
      showToast('Conciliado.', 'success')
      setExpandido(null); carregar()
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
    const { data: inserted, error } = await supabase.from(tipoTabela).insert({
      user_id: user.id, data: novoLanc, conciliado_em: new Date().toISOString(), extrato_id: extrato.id,
    }).select('id').single()
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    await supabase.from('transacoes_extrato').update({
      status: 'conciliado', lancamento_tipo: tipoTabela, lancamento_id: inserted.id,
    }).eq('id', extrato.id)
    showToast('Lançamento criado e conciliado.', 'success')
    setExpandido(null); carregar()
  }

  async function marcarTransferencia(extrato) {
    if (!confirm('Marcar como transferência entre contas próprias?')) return
    await supabase.from('transacoes_extrato').update({
      status: 'ignorado',
      data: { ...(extrato.data || {}), motivo: 'transferencia_propria' },
    }).eq('id', extrato.id)
    showToast('Marcado como transferência interna.', 'info')
    setExpandido(null); carregar()
  }

  async function ignorar(extrato) {
    if (!confirm('Ignorar essa transação?')) return
    await supabase.from('transacoes_extrato').update({ status: 'ignorado' }).eq('id', extrato.id)
    showToast('Ignorada.', 'info'); setExpandido(null); carregar()
  }
  async function restaurar(extrato) {
    await supabase.from('transacoes_extrato').update({ status: 'pendente' }).eq('id', extrato.id)
    showToast('Voltou pra pendentes.', 'info'); setExpandido(null); carregar()
  }
  async function desconciliar(extrato) {
    if (!confirm('Desconciliar? Lançamento vinculado volta pra pendente.')) return
    const tipo = extrato.lancamento_tipo, lid = extrato.lancamento_id
    await supabase.from('transacoes_extrato').update({ status: 'pendente', lancamento_tipo: null, lancamento_id: null }).eq('id', extrato.id)
    if (tipo && lid) await supabase.from(tipo).update({ conciliado_em: null, extrato_id: null }).eq('id', lid)
    showToast('Desconciliado.', 'info'); setExpandido(null); carregar()
  }

  function limparPeriodo() {
    setDataDe(''); setDataAte('')
  }

  if (loading) return <AppLayout title="Conciliação"><div style={emptyState}>Carregando…</div></AppLayout>
  if (contas.length === 0) return (
    <AppLayout title="Conciliação">
      <div style={emptyState}>
        Nenhuma conta bancária cadastrada. <a href="/contas-bancarias" style={{ color: 'var(--gold)', textDecoration: 'underline', fontWeight: 600 }}>Cadastrar conta</a>.
      </div>
    </AppLayout>
  )

  return (
    <AppLayout title="Conciliação Bancária">
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
        </div>
        <div style={saldosBox}>
          <Saldo label="Saldo no Banco" sub="da conta no banco" valor={saldoBancoFinal} dim={saldoBancoFinal == null} />
          <Saldo label="Saldo no Sistema" sub="recebido − pago" valor={saldoSistema} />
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

      {/* Tabela */}
      {extratosFiltrados.length === 0 ? (
        <div style={emptyState}>
          {extratos.filter(e => e.conta_id === contaId).length === 0
            ? 'Importe um OFX pra começar.'
            : 'Nenhuma transação com os filtros aplicados.'}
        </div>
      ) : (
        <>
          {/* Header — JS-controlled. Renderiza sempre o natural (pra ocupar
              espaço) e adicionalmente um clone position:fixed no topo do
              scroll-main quando rolar pra baixo. */}
          <div ref={headerRef} style={headerNatural}>
            <div style={{ padding: '12px 14px' }}>DATA</div>
            <div style={{ padding: '12px 14px' }}>DESCRIÇÃO</div>
            <div style={{ padding: '12px 14px', textAlign: 'right' }}>VALOR</div>
            <div style={{ padding: '12px 14px', textAlign: 'center' }}>STATUS</div>
            <div style={{ padding: '12px 14px' }}></div>
          </div>
          {fixedHdr && (
            <div style={{ ...headerNatural, position: 'fixed', top: fixedHdr.top, left: fixedHdr.left, width: fixedHdr.width, zIndex: 100, borderRadius: 0, boxShadow: '0 4px 12px rgba(0,32,62,0.18)' }}>
              <div style={{ padding: '12px 14px' }}>DATA</div>
              <div style={{ padding: '12px 14px' }}>DESCRIÇÃO</div>
              <div style={{ padding: '12px 14px', textAlign: 'right' }}>VALOR</div>
              <div style={{ padding: '12px 14px', textAlign: 'center' }}>STATUS</div>
              <div style={{ padding: '12px 14px' }}></div>
            </div>
          )}
          <div style={tableWrap}>
            {extratosFiltrados.map(ext => (
              <LinhaExtrato
                key={ext.id}
                extrato={ext}
                receivable={receivable}
                payable={payable}
                expandido={expandido === ext.id}
                onToggle={() => setExpandido(expandido === ext.id ? null : ext.id)}
                onVincular={lanc => vincular(ext, lanc)}
                onCriar={() => criarLancamento(ext)}
                onTransferencia={() => marcarTransferencia(ext)}
                onIgnorar={() => ignorar(ext)}
                onRestaurar={() => restaurar(ext)}
                onDesconciliar={() => desconciliar(ext)}
              />
            ))}
          </div>
        </>
      )}
    </AppLayout>
  )
}

function LinhaExtrato({ extrato, receivable, payable, expandido, onToggle, onVincular, onCriar, onTransferencia, onIgnorar, onRestaurar, onDesconciliar }) {
  const tipo = extrato.data?.tipo
  const valor = Number(extrato.data?.valor || 0)
  const desc = extrato.data?.descricao || '(sem descrição)'
  const data = extrato.data?.data
  const cnpj = extrato.data?.cnpj
  const status = extrato.status

  const candidatos = tipo === 'entrada' ? receivable : payable
  const sugestoes = useMemo(
    () => status === 'pendente' ? sugerirMatches(extrato.data || {}, candidatos.filter(c => c.status !== (tipo === 'entrada' ? 'Recebido' : 'Pago') || extrato.lancamento_id === c.id)) : [],
    [extrato, candidatos, tipo, status],
  )
  const temSugestao = sugestoes.length > 0
  const corValor = tipo === 'entrada' ? 'var(--green)' : 'var(--red)'

  let badge
  if (status === 'pendente') badge = { txt: temSugestao ? '💡 Sugestão' : '⏳ Pendente', bg: temSugestao ? 'rgba(204,145,94,0.15)' : 'rgba(230,126,34,0.12)', cor: temSugestao ? 'var(--gold-dark)' : 'var(--orange)' }
  else if (status === 'conciliado') badge = { txt: '✓ Conciliado', bg: 'rgba(39,174,96,0.10)', cor: 'var(--green)' }
  else badge = { txt: '⨯ Ignorado', bg: 'rgba(0,0,0,0.05)', cor: 'var(--text-mid)' }

  return (
    <>
      <div onClick={onToggle} style={{ ...rowGrid, cursor: 'pointer', background: expandido ? 'var(--cream)' : 'var(--white)', opacity: status === 'ignorado' ? 0.6 : 1, borderBottom: '1px solid var(--cream-dark)' }}>
        <div style={cell}>{fmtDataBR(data)}</div>
        <div style={{ ...cell, minWidth: 0 }}>
          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>{desc}</div>
          {cnpj && <div style={{ fontSize: 10, color: 'var(--text-mid)', fontFamily: 'monospace' }}>CNPJ {cnpj}</div>}
        </div>
        <div style={{ ...cell, textAlign: 'right', fontWeight: 700, color: corValor, fontSize: 13 }}>
          {tipo === 'entrada' ? '+' : '−'} {fmtMoney(valor)}
        </div>
        <div style={{ ...cell, textAlign: 'center' }}>
          <span style={{ background: badge.bg, color: badge.cor, padding: '3px 9px', borderRadius: 999, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>{badge.txt}</span>
        </div>
        <div style={{ ...cell, textAlign: 'center', color: 'var(--text-mid)' }}>{expandido ? '▾' : '▸'}</div>
      </div>
      {expandido && (
        <div style={{ background: 'var(--cream)', borderBottom: '1px solid var(--cream-dark)', padding: '14px 18px' }}>
          <div>
            {status === 'pendente' ? (
              <>
                {temSugestao && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-mid)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Sugestões automáticas</div>
                    {sugestoes.slice(0, 3).map((s, i) => (
                      <div key={i} style={sugestaoRow}>
                        <div style={{ flex: 1, fontSize: 12 }}>
                          <strong>{s.lancamento.codigo}</strong> — <span style={{ color: 'var(--text-mid)' }}>{s.lancamento.desc || s.lancamento.client || s.lancamento.supplier}</span>
                          <div style={{ fontSize: 10, color: 'var(--text-mid)', marginTop: 2 }}>{s.motivo}</div>
                        </div>
                        <button onClick={() => onVincular(s.lancamento)} style={btnOk}>✓ Vincular</button>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {!temSugestao && <em style={{ fontSize: 11, color: 'var(--text-mid)', marginRight: 8, alignSelf: 'center' }}>Nenhuma sugestão automática.</em>}
                  <button onClick={onCriar} style={btnAcao}>+ Criar lançamento</button>
                  <button onClick={onTransferencia} style={btnAcao}>↔ Transferência entre contas</button>
                  <button onClick={onIgnorar} style={{ ...btnAcao, color: 'var(--text-mid)' }}>⨯ Ignorar</button>
                </div>
              </>
            ) : status === 'conciliado' ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--text-mid)' }}>Vinculado a {extrato.lancamento_tipo} {extrato.lancamento_id?.substring(0, 8)}</span>
                <button onClick={onDesconciliar} style={btnLink}>↶ Desconciliar</button>
              </div>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button onClick={onRestaurar} style={btnLink}>↻ Restaurar pra pendentes</button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
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

const filtrosBar = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'var(--white)', borderRadius: 10, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)', marginBottom: 14 }
const filtroSep = { fontSize: 11, color: 'var(--text-mid)' }
const divisor = { width: 1, height: 22, background: 'var(--cream-dark)', margin: '0 4px' }
const inputData = { padding: '7px 10px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 12, color: 'var(--navy)', background: 'var(--white)', outline: 'none' }
const btnLimpar = { background: 'none', border: 'none', color: 'var(--text-mid)', cursor: 'pointer', fontSize: 14, fontWeight: 700, fontFamily: 'var(--body)', padding: '4px 6px' }
const selectFiltro = { padding: '7px 28px 7px 10px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 12, color: 'var(--navy)', background: 'var(--white)', outline: 'none', cursor: 'pointer', appearance: 'none', backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path d='M1 1l4 4 4-4' stroke='%2300203E' stroke-width='1.5' fill='none'/></svg>\")", backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center' }
const inputFiltro = { padding: '7px 10px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 12, color: 'var(--navy)', background: 'var(--white)', outline: 'none' }

const tableWrap = { background: 'var(--white)', borderRadius: '0 0 10px 10px', border: '1px solid var(--cream-dark)', borderTop: 'none', boxShadow: 'var(--shadow)' }
const GRID_COLS = '110px 1fr 150px 150px 40px'
const rowGrid = { display: 'grid', gridTemplateColumns: GRID_COLS, alignItems: 'center', gap: 0 }
const headerNatural = { display: 'grid', gridTemplateColumns: GRID_COLS, alignItems: 'center', background: 'var(--navy)', color: '#fff', fontSize: 9, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', borderBottom: '2px solid var(--gold)', borderRadius: '10px 10px 0 0', fontFamily: 'var(--body)', boxShadow: 'var(--shadow)' }
const cell = { padding: '12px 14px', fontSize: 12, color: 'var(--navy)' }

const sugestaoRow = { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'var(--white)', borderRadius: 6, marginBottom: 6 }
const btnOk = { padding: '6px 12px', borderRadius: 4, border: 'none', background: 'var(--green)', color: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 700, fontFamily: 'var(--body)' }
const btnAcao = { padding: '6px 12px', borderRadius: 4, border: '1.5px solid var(--cream-dark)', background: 'var(--white)', color: 'var(--navy)', cursor: 'pointer', fontSize: 11, fontWeight: 600, fontFamily: 'var(--body)' }
const btnLink = { background: 'none', border: 'none', color: 'var(--gold-dark)', cursor: 'pointer', fontSize: 11, fontWeight: 600, textDecoration: 'underline', fontFamily: 'var(--body)' }
const emptyState = { padding: '60px 24px', textAlign: 'center', fontFamily: 'var(--body)', color: 'var(--text-mid)', fontSize: 13, background: 'var(--white)', borderRadius: 12, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)' }
