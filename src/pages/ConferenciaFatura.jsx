import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import AppLayout from '../components/AppLayout'
import { showToast } from '../components/Toast'
import { fmtMoney, flatten } from '../lib/finance'
import { periodoFatura, rotuloFatura } from '../lib/fatura'
import { parseOFX } from '../lib/ofx'

// =====================================================================
// CONFERÊNCIA DE FATURA — soma os lançamentos do cartão no período da
// fatura escolhida e compara com o valor real da fatura (você digita).
// Decisão UX 30/05: período = (dia_fechamento+1 mês ant.) → (dia_fech).
// =====================================================================

function fmtDataBR(s) {
  if (!s) return '—'
  const [y, m, d] = s.split('-')
  return `${d}/${m}/${y}`
}

export default function ConferenciaFatura() {
  const { user } = useAuth()
  const [cartoes, setCartoes] = useState([])
  const [cartaoId, setCartaoId] = useState('')
  const [payable, setPayable] = useState([])
  const [loading, setLoading] = useState(true)

  const hoje = new Date()
  const [ano, setAno] = useState(hoje.getFullYear())
  const [mes, setMes] = useState(hoje.getMonth())
  const [valorFatura, setValorFatura] = useState('')
  const [uploading, setUploading] = useState(false)

  const carregar = useCallback(() => {
    if (!user) return
    setLoading(true)
    Promise.all([
      supabase.from('cartoes').select('*').order('updated_at', { ascending: false }),
      supabase.from('payable').select('*'),
    ]).then(([rC, rP]) => {
      const ativos = (rC.data || []).filter(c => c.data?.ativo !== false)
      setCartoes(ativos)
      setPayable((rP.data || []).map(r => ({ ...flatten(r), cartao_id: r.cartao_id, parent_id: r.parent_id })))
      // Seleciona o primeiro cartão automaticamente
      if (ativos.length > 0 && !cartaoId) setCartaoId(ativos[0].id)
      setLoading(false)
    })
  }, [user, cartaoId])

  useEffect(() => { carregar() }, [carregar])

  // ── Import OFX da fatura ─────────────────────────────────────────────
  async function handleUploadFatura(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!cartaoId) { showToast('Selecione um cartão antes.', 'warning'); return }
    if (!user) { showToast('Sessão expirada.', 'error'); return }
    if (!periodo) { showToast('Selecione mês/ano antes.', 'warning'); return }
    setUploading(true)
    try {
      const buf = await file.arrayBuffer()
      let texto
      try { texto = new TextDecoder('windows-1252').decode(buf) }
      catch { texto = new TextDecoder('utf-8').decode(buf) }
      const { transacoes } = parseOFX(texto)
      if (!transacoes.length) { showToast('OFX sem transações.', 'warning'); return }
      // Dedup por fit_id dentro dos lançamentos do cartão
      const fitsExistentes = new Set(payable.filter(p => p.cartao_id === cartaoId && p.fit_id).map(p => p.fit_id))
      const debitos = transacoes.filter(t => t.tipo === 'saida' && (!t.fit_id || !fitsExistentes.has(t.fit_id)))
      if (!debitos.length) {
        showToast(`Todas as ${transacoes.length} transações já estavam importadas.`, 'info')
        return
      }
      // Cria N lançamentos em payable
      const payload = debitos.map(t => ({
        user_id: user.id,
        cartao_id: cartaoId,
        fit_id: t.fit_id || null,
        data: {
          supplier: (t.descricao || '').substring(0, 80),
          desc: t.descricao,
          value: Math.abs(Number(t.valor || 0)),
          data_competencia: t.data,
          due: periodo.vencimento,
          status: 'Pendente',
          cat: '',
          subcat: '',
          forma_pagamento: 'Cartão Crédito',
          criado_via_import_fatura: true,
          created: new Date().toISOString().slice(0, 10),
        },
      }))
      const { error } = await supabase.from('payable').insert(payload)
      if (error) throw error
      showToast(`${debitos.length} lançamentos importados da fatura.`, 'success')
      carregar()
    } catch (err) {
      console.error(err)
      showToast('Erro: ' + err.message, 'error')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }


  const cartao = useMemo(() => cartoes.find(c => c.id === cartaoId), [cartoes, cartaoId])

  const periodo = useMemo(() => cartao ? periodoFatura(cartao, ano, mes) : null, [cartao, ano, mes])

  const lancamentos = useMemo(() => {
    if (!cartao || !periodo) return []
    return payable
      .filter(p => p.cartao_id === cartaoId)
      .filter(p => p.due && p.due >= periodo.ini && p.due <= periodo.fim)
      .sort((a, b) => a.due.localeCompare(b.due))
  }, [payable, cartao, periodo, cartaoId])

  const totalSistema = useMemo(
    () => lancamentos.reduce((s, x) => s + Number(x.value || 0), 0),
    [lancamentos],
  )
  const valFatura = parseFloat(valorFatura) || 0
  const diferenca = valFatura > 0 ? valFatura - totalSistema : 0

  // Anos disponíveis pro select — corrente e os 2 últimos
  const anos = [hoje.getFullYear(), hoje.getFullYear() - 1, hoje.getFullYear() - 2]

  const colgroup = (
    <colgroup>
      <col style={{ width: 90 }} />
      <col />
      <col />
      <col style={{ width: 90 }} />
      <col style={{ width: 110 }} />
      <col style={{ width: 130 }} />
      <col style={{ width: 90 }} />
    </colgroup>
  )
  const temDados = !loading && cartoes.length > 0 && lancamentos.length > 0

  if (cartoes.length === 0 && !loading) {
    return (
      <AppLayout title="Conferência de Fatura">
        <div style={emptyState}>
          Nenhum cartão ativo cadastrado. <a href="/cartoes" style={{ color: 'var(--gold)', textDecoration: 'underline', fontWeight: 600 }}>Cadastrar cartão</a>.
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout
      title="Conferência de Fatura"
      stickyTop={(
        <>
          {/* Seletor */}
          <div style={topo}>
            <Field label="Cartão">
              <select value={cartaoId} onChange={e => setCartaoId(e.target.value)} style={select}>
                {cartoes.map(c => <option key={c.id} value={c.id}>{c.data?.nome} ({c.data?.bandeira})</option>)}
              </select>
            </Field>
            <Field label="Mês de Vencimento">
              <select value={mes} onChange={e => setMes(Number(e.target.value))} style={select}>
                {['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'].map((m, i) =>
                  <option key={i} value={i}>{m}</option>
                )}
              </select>
            </Field>
            <Field label="Ano">
              <select value={ano} onChange={e => setAno(Number(e.target.value))} style={select}>
                {anos.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </Field>
            <label style={btnUploadFatura}>
              <input type="file" onChange={handleUploadFatura} accept=".ofx,.OFX" style={{ display: 'none' }} disabled={uploading} />
              {uploading ? '⏳ Processando…' : '📥 Importar OFX da fatura'}
            </label>
          </div>

          {periodo && (
            <div style={periodoBox}>
              <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 12, color: 'var(--navy)' }}>
                <div><strong>Fatura:</strong> {rotuloFatura(ano, mes)}</div>
                <div><strong>Período coberto:</strong> {fmtDataBR(periodo.ini)} → {fmtDataBR(periodo.fim)}</div>
                <div><strong>Vencimento:</strong> {fmtDataBR(periodo.vencimento)}</div>
              </div>
            </div>
          )}

          {/* Resumo */}
          <div style={resumoGrid}>
            <Card label="Total no sistema" valor={fmtMoney(totalSistema)} sub={`${lancamentos.length} lançamento(s)`} color="var(--navy)" />
            <Card label="Valor da fatura real (você digita)" valor={
              <input
                type="number" step="0.01" value={valorFatura}
                onChange={e => setValorFatura(e.target.value)}
                placeholder="0,00"
                style={{ ...select, fontSize: 22, fontWeight: 700, color: 'var(--navy)', padding: '4px 8px' }}
              />
            } sub="o que veio no app do cartão" color="var(--gold)" />
            <Card
              label="Diferença"
              valor={fmtMoney(diferenca)}
              sub={valFatura === 0 ? 'digite o valor da fatura' : (Math.abs(diferenca) < 0.01 ? '✓ batem!' : (diferenca > 0 ? 'fatura > sistema' : 'sistema > fatura'))}
              color={valFatura === 0 ? 'var(--text-mid)' : (Math.abs(diferenca) < 0.01 ? 'var(--green)' : 'var(--red)')}
            />
          </div>

          {/* Header de colunas (sticky) */}
          {temDados && (
            <div style={{ ...tableWrap, marginTop: 14, marginBottom: 0, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderBottom: 'none' }}>
              <div style={tableHeader}>
                <div style={chartTitle}>Lançamentos do período</div>
              </div>
              <table style={{ ...tbl, tableLayout: 'fixed' }}>
                {colgroup}
                <thead>
                  <tr>
                    <th style={th}>Cód.</th>
                    <th style={th}>Fornecedor</th>
                    <th style={th}>Descrição</th>
                    <th style={{ ...th, textAlign: 'center' }}>Parcela</th>
                    <th style={th}>Vencimento</th>
                    <th style={{ ...th, textAlign: 'right' }}>Valor</th>
                    <th style={{ ...th, textAlign: 'center' }}>Status</th>
                  </tr>
                </thead>
              </table>
            </div>
          )}
        </>
      )}
    >
      {/* Lista de lançamentos (body só) */}
      <div style={{ ...tableWrap, borderTopLeftRadius: temDados ? 0 : 10, borderTopRightRadius: temDados ? 0 : 10, borderTop: temDados ? 'none' : '1px solid var(--cream-dark)' }}>
        {loading ? (
          <div style={emptyState}>Carregando…</div>
        ) : lancamentos.length === 0 ? (
          <div style={emptyState}>Nenhum lançamento neste cartão no período {fmtDataBR(periodo?.ini)} → {fmtDataBR(periodo?.fim)}.</div>
        ) : (
          <table style={{ ...tbl, tableLayout: 'fixed' }}>
            {colgroup}
            <tbody>
                  {lancamentos.map(p => {
                    const parc = (p.data?.parcela_atual && p.data?.parcela_total) ? `${p.data.parcela_atual}/${p.data.parcela_total}` : '—'
                    const isPago = p.status === 'Pago'
                    return (
                      <tr key={p.id}>
                        <td style={{ ...td, fontWeight: 600, color: 'var(--text-mid)' }}>{p.codigo || '—'}</td>
                        <td style={td}>{p.supplier || '—'}</td>
                        <td style={{ ...td, color: 'var(--text-mid)' }}>{p.desc || '—'}</td>
                        <td style={{ ...td, textAlign: 'center', color: 'var(--text-mid)' }}>{parc}</td>
                        <td style={td}>{fmtDataBR(p.due)}</td>
                        <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{fmtMoney(p.value)}</td>
                        <td style={{ ...td, textAlign: 'center' }}>
                          <span style={{ background: isPago ? 'rgba(39,174,96,0.10)' : 'rgba(230,126,34,0.10)', color: isPago ? 'var(--green)' : 'var(--orange)', padding: '3px 9px', borderRadius: 999, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                            {p.status || 'Pendente'}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                  <tr style={{ background: 'var(--cream)' }}>
                    <td style={{ ...td, fontWeight: 700 }} colSpan={5}>Total</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: 'var(--navy)' }}>{fmtMoney(totalSistema)}</td>
                    <td style={td}></td>
                  </tr>
                </tbody>
              </table>
            )}
      </div>
    </AppLayout>
  )
}

function Field({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  )
}

function Card({ label, valor, sub, color }) {
  return (
    <div style={{ ...cardBase, borderTop: `3px solid ${color}` }}>
      <div style={labelStyle}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color, fontFamily: 'var(--body)' }}>{valor}</div>
      <div style={{ fontSize: 11, color: 'var(--text-mid)', marginTop: 6 }}>{sub}</div>
    </div>
  )
}

const topo = { display: 'flex', gap: 14, marginBottom: 14, flexWrap: 'wrap' }
const btnUploadFatura = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 6, border: '1.5px solid var(--gold)', background: 'var(--gold)', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', fontFamily: 'var(--body)', alignSelf: 'flex-end' }
const select = { padding: '9px 12px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 13, color: 'var(--navy)', background: 'var(--white)', outline: 'none', minWidth: 180 }
const periodoBox = { background: 'rgba(0,32,62,0.04)', borderLeft: '3px solid var(--navy)', padding: 14, borderRadius: 6, marginBottom: 18 }
const resumoGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 18 }
const cardBase = { background: 'var(--white)', borderRadius: 12, padding: 20, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)' }
const labelStyle = { fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-mid)', marginBottom: 6, fontFamily: 'var(--body)' }
const tableWrap = { background: 'var(--white)', borderRadius: 12, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)', overflow: 'clip' }
const tableHeader = { padding: '18px 24px 14px', borderBottom: '1px solid var(--cream-dark)' }
const chartTitle = { fontSize: 14, fontWeight: 600, color: 'var(--navy)', fontFamily: 'var(--body)' }
const tbl = { width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--body)' }
const th = { textAlign: 'left', padding: '12px 14px', fontSize: 9, fontWeight: 700, letterSpacing: 1.5, color: '#fff', textTransform: 'uppercase', background: 'var(--navy)', borderBottom: '2px solid var(--gold)' }
const td = { padding: '12px 14px', fontSize: 12, color: 'var(--navy)', borderBottom: '1px solid var(--cream-dark)', verticalAlign: 'middle' }
const emptyState = { padding: '60px 24px', textAlign: 'center', fontFamily: 'var(--body)', color: 'var(--text-mid)', fontSize: 13, background: 'var(--white)', borderRadius: 12, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)' }
