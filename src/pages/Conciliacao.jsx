import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import AppLayout from '../components/AppLayout'
import { showToast } from '../components/Toast'
import { fmtMoney, flatten } from '../lib/finance'
import { parseOFX } from '../lib/ofx'
import { sugerirMatches } from '../lib/matchExtrato'

// =====================================================================
// CONCILIAÇÃO v1 — MVP baseado em pesquisa de ERPs (Conta Azul, Omie,
// Nibo, Granatum, QuickBooks, Xero, YNAB). Veja design docs no PR.
//
// Padrões herdados:
//  - 3 abas canônicas (Pendentes / Conciliados / Ignorados)
//  - Match auto valor exato + data ±3 dias + CNPJ se houver
//  - 4 ações por linha (Vincular existente / Criar / Transferência / Ignorar)
//  - Banner Saldo banco × sistema × divergência
//  - Lock visual após conciliar
// =====================================================================

function fmtData(s) {
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
  const [aba, setAba] = useState('pendente')
  const [uploading, setUploading] = useState(false)
  const [saldoBanco, setSaldoBanco] = useState(null) // último saldo OFX importado

  const carregar = useCallback(() => {
    if (!user) return
    setLoading(true)
    Promise.all([
      supabase.from('contas_bancarias').select('*').order('updated_at', { ascending: false }),
      supabase.from('transacoes_extrato').select('*').order('created_at', { ascending: false }),
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

  // Extratos filtrados pela conta + aba ativa
  const extratosFiltrados = useMemo(() => {
    return extratos.filter(e => e.conta_id === contaId && e.status === aba)
  }, [extratos, contaId, aba])

  const counts = useMemo(() => {
    const c = { pendente: 0, conciliado: 0, ignorado: 0 }
    for (const e of extratos) {
      if (e.conta_id === contaId) c[e.status] = (c[e.status] || 0) + 1
    }
    return c
  }, [extratos, contaId])

  // Saldo sistema = soma de receivable Recebido − payable Pago, todos vinculados a essa conta
  // V1: simplificado — pega o saldo_inicial + tudo Recebido − tudo Pago no sistema. Não filtra por conta no lançamento porque V1 não associou conta a lançamento.
  const saldoSistema = useMemo(() => {
    if (!conta) return 0
    const sIni = Number(conta.data?.saldo_inicial || 0)
    const tIn = receivable.filter(r => r.status === 'Recebido').reduce((a, r) => a + r.value, 0)
    const tOut = payable.filter(r => r.status === 'Pago').reduce((a, r) => a + r.value, 0)
    return sIni + tIn - tOut
  }, [conta, receivable, payable])

  const divergencia = saldoBanco != null ? saldoBanco - saldoSistema : null

  // ── Upload OFX ────────────────────────────────────────────────────────
  async function handleUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!contaId) { showToast('Selecione uma conta antes.', 'warning'); return }
    if (!user) { showToast('Sessão expirada.', 'error'); return }
    setUploading(true)
    try {
      const texto = await file.text()
      const { transacoes, saldoFinal } = parseOFX(texto)
      if (!transacoes.length) {
        showToast('Nenhuma transação encontrada no OFX.', 'warning')
        return
      }
      // Dedup por fit_id (importações repetidas não duplicam)
      const fitIdsExistentes = new Set(
        extratos.filter(e => e.conta_id === contaId && e.fit_id).map(e => e.fit_id)
      )
      const novos = transacoes.filter(t => !t.fit_id || !fitIdsExistentes.has(t.fit_id))
      if (!novos.length) {
        showToast(`Todas as ${transacoes.length} transações já estavam importadas.`, 'info')
        if (saldoFinal != null) setSaldoBanco(saldoFinal)
        return
      }
      const payload = novos.map(t => ({
        user_id: user.id,
        conta_id: contaId,
        status: 'pendente',
        fit_id: t.fit_id,
        data: t,
      }))
      const { error } = await supabase.from('transacoes_extrato').insert(payload)
      if (error) throw error
      showToast(`${novos.length} transações importadas (${transacoes.length - novos.length} duplicadas ignoradas).`, 'success')
      if (saldoFinal != null) setSaldoBanco(saldoFinal)
      carregar()
    } catch (err) {
      console.error(err)
      showToast('Erro ao processar OFX: ' + err.message, 'error')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  // ── Ações por linha ───────────────────────────────────────────────────
  async function vincular(extrato, lancamento) {
    const tipoTabela = extrato.data?.tipo === 'entrada' ? 'receivable' : 'payable'
    const agora = new Date().toISOString()
    try {
      // 1. Marca extrato como conciliado
      await supabase.from('transacoes_extrato').update({
        status: 'conciliado',
        lancamento_tipo: tipoTabela,
        lancamento_id: lancamento.id,
      }).eq('id', extrato.id)
      // 2. Marca lançamento como conciliado + atualiza status pra liquidado se ainda Pendente
      const statusNovo = tipoTabela === 'receivable' ? 'Recebido' : 'Pago'
      const dataPag = extrato.data?.data
      const mergedData = {
        ...(lancamento.data || {}),
        status: statusNovo,
        data_pagamento: lancamento.data?.data_pagamento || dataPag,
      }
      await supabase.from(tipoTabela).update({
        data: mergedData,
        conciliado_em: agora,
        extrato_id: extrato.id,
      }).eq('id', lancamento.id)
      showToast('Conciliado.', 'success')
      carregar()
    } catch (e) {
      showToast('Erro: ' + e.message, 'error')
    }
  }

  async function ignorar(extrato) {
    if (!confirm('Ignorar essa transação? Você pode restaurar depois.')) return
    await supabase.from('transacoes_extrato').update({ status: 'ignorado' }).eq('id', extrato.id)
    showToast('Transação ignorada.', 'info')
    carregar()
  }

  async function restaurar(extrato) {
    await supabase.from('transacoes_extrato').update({ status: 'pendente' }).eq('id', extrato.id)
    showToast('Voltou pra fila.', 'info')
    carregar()
  }

  async function desconciliar(extrato) {
    if (!confirm('Desconciliar? O lançamento vinculado vai voltar pra pendente também.')) return
    const tipoTabela = extrato.lancamento_tipo
    const lancId = extrato.lancamento_id
    await supabase.from('transacoes_extrato').update({
      status: 'pendente', lancamento_tipo: null, lancamento_id: null,
    }).eq('id', extrato.id)
    if (tipoTabela && lancId) {
      await supabase.from(tipoTabela).update({
        conciliado_em: null, extrato_id: null,
      }).eq('id', lancId)
    }
    showToast('Desconciliado.', 'info')
    carregar()
  }

  async function criarLancamento(extrato) {
    if (!user) return
    const tipoTabela = extrato.data?.tipo === 'entrada' ? 'receivable' : 'payable'
    const agora = new Date().toISOString()
    const dataExt = extrato.data?.data
    const descExt = extrato.data?.descricao || '(sem descrição)'
    const statusNovo = tipoTabela === 'receivable' ? 'Recebido' : 'Pago'
    const novoLanc = {
      [tipoTabela === 'receivable' ? 'client' : 'supplier']: descExt.substring(0, 80),
      desc: descExt,
      value: Number(extrato.data?.valor || 0),
      due: dataExt, data_pagamento: dataExt,
      status: statusNovo,
      cat: '', subcat: '',
      doc_status: 'pendente', sem_documento: true,
      created: dataExt,
      criado_via_conciliacao: true,
    }
    const { data: inserted, error } = await supabase.from(tipoTabela).insert({
      user_id: user.id, data: novoLanc, conciliado_em: agora, extrato_id: extrato.id,
    }).select('id').single()
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    await supabase.from('transacoes_extrato').update({
      status: 'conciliado', lancamento_tipo: tipoTabela, lancamento_id: inserted.id,
    }).eq('id', extrato.id)
    showToast(`Lançamento criado e conciliado. Edite depois pra preencher categoria.`, 'success')
    carregar()
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
      {/* Banner topo: conta + saldos + upload */}
      <div style={topo}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={contaId} onChange={e => { setContaId(e.target.value); setSaldoBanco(null) }} style={select}>
            {contas.map(c => <option key={c.id} value={c.id}>{c.data?.nome} ({c.data?.banco})</option>)}
          </select>
          <label style={btnUpload}>
            <input type="file" onChange={handleUpload} accept=".ofx,.OFX" style={{ display: 'none' }} disabled={uploading} />
            {uploading ? '⏳ Processando…' : '📥 Importar OFX'}
          </label>
        </div>
        <div style={saldosBox}>
          <Saldo label="Banco" valor={saldoBanco} dim={saldoBanco == null} />
          <Saldo label="Sistema" valor={saldoSistema} />
          <Saldo
            label="Divergência" valor={divergencia}
            cor={divergencia == null ? 'var(--text-mid)' : (Math.abs(divergencia) < 0.01 ? 'var(--green)' : 'var(--red)')}
            dim={divergencia == null}
          />
        </div>
      </div>

      {/* Tabs */}
      <div style={tabsBar}>
        {[
          { k: 'pendente', l: 'Pendentes' },
          { k: 'conciliado', l: 'Conciliados' },
          { k: 'ignorado', l: 'Ignorados' },
        ].map(t => (
          <button key={t.k} onClick={() => setAba(t.k)} style={aba === t.k ? tabActive : tabInactive}>
            {t.l} <span style={{ marginLeft: 6, padding: '2px 7px', borderRadius: 999, background: aba === t.k ? 'rgba(255,255,255,0.18)' : 'rgba(0,32,62,0.10)', fontSize: 10 }}>{counts[t.k] || 0}</span>
          </button>
        ))}
      </div>

      {/* Lista */}
      {extratosFiltrados.length === 0 ? (
        <div style={emptyState}>
          {aba === 'pendente'
            ? 'Tudo conciliado nesta conta! Importe um OFX pra começar.'
            : aba === 'conciliado' ? 'Nenhuma transação conciliada ainda.' : 'Nenhuma transação ignorada.'}
        </div>
      ) : (
        <div style={lista}>
          {extratosFiltrados.map(e => (
            <LinhaExtrato
              key={e.id}
              extrato={e}
              receivable={receivable}
              payable={payable}
              onVincular={lanc => vincular(e, lanc)}
              onIgnorar={() => ignorar(e)}
              onRestaurar={() => restaurar(e)}
              onDesconciliar={() => desconciliar(e)}
              onCriar={() => criarLancamento(e)}
            />
          ))}
        </div>
      )}
    </AppLayout>
  )
}

function LinhaExtrato({ extrato, receivable, payable, onVincular, onIgnorar, onRestaurar, onDesconciliar, onCriar }) {
  const [aberto, setAberto] = useState(false)
  const tipo = extrato.data?.tipo
  const valor = Number(extrato.data?.valor || 0)
  const desc = extrato.data?.descricao || '(sem descrição)'
  const data = extrato.data?.data
  const candidatos = tipo === 'entrada' ? receivable : payable
  const sugestoes = useMemo(
    () => sugerirMatches({ ...extrato.data }, candidatos.filter(c => c.status !== (tipo === 'entrada' ? 'Recebido' : 'Pago') || extrato.lancamento_id === c.id)),
    [extrato, candidatos, tipo],
  )
  const topSugestao = sugestoes[0]
  const isConciliado = extrato.status === 'conciliado'
  const isIgnorado = extrato.status === 'ignorado'

  return (
    <div style={{ ...card, borderLeft: `3px solid ${tipo === 'entrada' ? 'var(--green)' : 'var(--red)'}`, opacity: isIgnorado ? 0.55 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer' }} onClick={() => setAberto(o => !o)}>
        <div style={{ minWidth: 90, fontSize: 11, color: 'var(--text-mid)' }}>{fmtData(data)}</div>
        <div style={{ flex: 1, fontSize: 12, color: 'var(--navy)', fontWeight: 500 }}>
          {desc}
          {extrato.data?.cnpj && <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--text-mid)', fontFamily: 'monospace' }}>CNPJ {extrato.data.cnpj}</span>}
        </div>
        <div style={{ minWidth: 130, fontSize: 14, fontWeight: 700, color: tipo === 'entrada' ? 'var(--green)' : 'var(--red)', textAlign: 'right' }}>
          {tipo === 'entrada' ? '+' : '−'} {fmtMoney(valor)}
        </div>
        {isConciliado && <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--green)', background: 'rgba(39,174,96,0.10)', padding: '3px 8px', borderRadius: 999, textTransform: 'uppercase', letterSpacing: 0.5 }}>🔒 Conciliado</span>}
        {isIgnorado && <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-mid)', background: 'rgba(0,0,0,0.05)', padding: '3px 8px', borderRadius: 999, textTransform: 'uppercase', letterSpacing: 0.5 }}>Ignorado</span>}
      </div>

      {aberto && !isConciliado && !isIgnorado && (
        <div style={{ marginTop: 14, padding: '14px 0 0 0', borderTop: '1px solid var(--cream-dark)' }}>
          {topSugestao && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 10, background: 'rgba(204,145,94,0.06)', borderRadius: 6, marginBottom: 10 }}>
              <div style={{ flex: 1, fontSize: 12 }}>
                <strong style={{ color: 'var(--navy)' }}>💡 Sugestão:</strong>{' '}
                <span style={{ color: 'var(--text-mid)' }}>{topSugestao.lancamento.codigo} — {topSugestao.lancamento.desc || topSugestao.lancamento.client || topSugestao.lancamento.supplier}</span>
                <div style={{ fontSize: 10, color: 'var(--text-mid)', marginTop: 2 }}>{topSugestao.motivo}</div>
              </div>
              <button onClick={() => onVincular(topSugestao.lancamento)} style={btnOk}>✓ OK</button>
            </div>
          )}
          {sugestoes.length > 1 && (
            <details style={{ marginBottom: 10 }}>
              <summary style={{ cursor: 'pointer', fontSize: 11, color: 'var(--text-mid)' }}>Outras {sugestoes.length - 1} sugestões</summary>
              <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {sugestoes.slice(1).map((s, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 6, fontSize: 11, color: 'var(--text-mid)' }}>
                    <span style={{ flex: 1 }}>{s.lancamento.codigo} — {s.lancamento.desc}</span>
                    <button onClick={() => onVincular(s.lancamento)} style={btnLink}>Vincular</button>
                  </div>
                ))}
              </div>
            </details>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {!topSugestao && <em style={{ fontSize: 11, color: 'var(--text-mid)' }}>Nenhuma sugestão automática.</em>}
            <button onClick={onCriar} style={btnAcao}>+ Criar lançamento</button>
            <button onClick={onIgnorar} style={{ ...btnAcao, color: 'var(--text-mid)' }}>⨯ Ignorar</button>
          </div>
        </div>
      )}
      {aberto && isConciliado && (
        <div style={{ marginTop: 14, padding: '14px 0 0 0', borderTop: '1px solid var(--cream-dark)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--text-mid)' }}>Vinculado a <strong>{extrato.lancamento_tipo}</strong> {extrato.lancamento_id?.substring(0, 8)}</span>
          <button onClick={onDesconciliar} style={btnLink}>↶ Desconciliar</button>
        </div>
      )}
      {aberto && isIgnorado && (
        <div style={{ marginTop: 14, padding: '14px 0 0 0', borderTop: '1px solid var(--cream-dark)', textAlign: 'right' }}>
          <button onClick={onRestaurar} style={btnLink}>↻ Restaurar pra Pendentes</button>
        </div>
      )}
    </div>
  )
}

function Saldo({ label, valor, cor, dim }) {
  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-mid)' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: cor || 'var(--navy)', opacity: dim ? 0.5 : 1 }}>
        {valor == null ? '—' : fmtMoney(valor)}
      </div>
    </div>
  )
}

const topo = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 18, flexWrap: 'wrap', background: 'var(--white)', padding: 14, borderRadius: 10, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)' }
const saldosBox = { display: 'flex', gap: 24, alignItems: 'center' }
const select = { padding: '9px 12px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 13, color: 'var(--navy)', background: 'var(--white)', outline: 'none', minWidth: 200 }
const btnUpload = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 6, border: '1.5px solid var(--gold)', background: 'var(--gold)', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', fontFamily: 'var(--body)' }
const tabsBar = { display: 'flex', gap: 4, marginBottom: 16, background: 'var(--cream)', padding: 4, borderRadius: 8, width: 'fit-content' }
const tabBase = { border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 11, fontWeight: 700, letterSpacing: 0.6, cursor: 'pointer', fontFamily: 'var(--body)', textTransform: 'uppercase' }
const tabActive = { ...tabBase, background: 'var(--navy)', color: '#fff' }
const tabInactive = { ...tabBase, background: 'transparent', color: 'var(--text-mid)' }
const lista = { display: 'flex', flexDirection: 'column', gap: 8 }
const card = { background: 'var(--white)', borderRadius: 10, padding: '12px 16px', border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)' }
const btnOk = { padding: '7px 14px', borderRadius: 6, border: 'none', background: 'var(--green)', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 700, letterSpacing: 0.5, fontFamily: 'var(--body)' }
const btnAcao = { padding: '6px 12px', borderRadius: 4, border: '1.5px solid var(--cream-dark)', background: 'var(--white)', color: 'var(--navy)', cursor: 'pointer', fontSize: 11, fontWeight: 600, fontFamily: 'var(--body)' }
const btnLink = { background: 'none', border: 'none', color: 'var(--gold-dark)', cursor: 'pointer', fontSize: 11, fontWeight: 600, textDecoration: 'underline', fontFamily: 'var(--body)' }
const emptyState = { padding: '60px 24px', textAlign: 'center', fontFamily: 'var(--body)', color: 'var(--text-mid)', fontSize: 13, background: 'var(--white)', borderRadius: 12, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)' }
