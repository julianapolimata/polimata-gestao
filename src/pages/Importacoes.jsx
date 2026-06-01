import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import AppLayout from '../components/AppLayout'
import { showToast } from '../components/Toast'

const TIPO_LABEL = {
  ofx_extrato: '🏦 OFX Extrato bancário',
  ofx_fatura_cartao: '💳 OFX Fatura cartão',
  xlsx_extrato: '📊 XLSX Extrato',
  pdf_emprestimo: '📄 PDF Empréstimo',
  email_nfse: '📧 NFS-e via email',
  upload_manual_nf: '📤 Upload manual NF',
}

const STATUS_COR = {
  ativa: { bg: 'rgba(0,32,62,0.08)', cor: 'var(--navy)', txt: 'Ativa' },
  revertida: { bg: 'rgba(231,76,60,0.10)', cor: 'var(--red)', txt: 'Revertida' },
}

function fmtData(s) {
  if (!s) return '—'
  const d = new Date(s)
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export default function Importacoes() {
  const { user } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [filtroTipo, setFiltroTipo] = useState('')
  const [busca, setBusca] = useState('')
  const [expandido, setExpandido] = useState(null)
  const [detalhe, setDetalhe] = useState({})

  const recarregar = useCallback(() => {
    if (!user) return
    setLoading(true)
    supabase.from('importacoes').select('*').order('created_at', { ascending: false })
      .then(({ data }) => { setRows(data || []); setLoading(false) })
  }, [user])

  useEffect(() => { recarregar() }, [recarregar])

  const filtrados = useMemo(() => {
    let r = rows
    if (filtroTipo) r = r.filter(x => x.tipo === filtroTipo)
    if (busca.trim()) {
      const q = busca.trim().toLowerCase()
      r = r.filter(x => (x.arquivo_nome || '').toLowerCase().includes(q))
    }
    return r
  }, [rows, filtroTipo, busca])

  const counts = useMemo(() => {
    const c = { total: rows.length, ativa: 0, revertida: 0 }
    for (const r of rows) c[r.status] = (c[r.status] || 0) + 1
    return c
  }, [rows])

  async function carregarDetalhe(imp) {
    if (detalhe[imp.id]) return
    const queries = []
    if (imp.tipo === 'ofx_extrato') {
      queries.push(supabase.from('transacoes_extrato').select('*').eq('importacao_id', imp.id))
    } else if (imp.tipo === 'ofx_fatura_cartao') {
      queries.push(supabase.from('payable').select('*').eq('importacao_id', imp.id))
    } else if (imp.tipo === 'email_nfse' || imp.tipo === 'upload_manual_nf') {
      queries.push(supabase.from('receivable').select('*').eq('importacao_id', imp.id))
      queries.push(supabase.from('payable').select('*').eq('importacao_id', imp.id))
    }
    const results = await Promise.all(queries)
    const all = results.flatMap(r => r.data || [])
    setDetalhe(d => ({ ...d, [imp.id]: all }))
  }

  function toggle(imp) {
    if (expandido === imp.id) { setExpandido(null); return }
    setExpandido(imp.id)
    carregarDetalhe(imp)
  }

  async function baixarArquivo(imp) {
    if (!imp.arquivo_path) { showToast('Arquivo não disponível.', 'warning'); return }
    const { data, error } = await supabase.storage.from('anexos-fiscais').createSignedUrl(imp.arquivo_path, 60)
    if (error || !data?.signedUrl) { showToast('Erro: ' + (error?.message || 'sem URL'), 'error'); return }
    window.open(data.signedUrl, '_blank')
  }

  async function reverter(imp) {
    if (imp.status === 'revertida') { showToast('Já revertida.', 'info'); return }
    if (!confirm(`Reverter "${imp.arquivo_nome}"? Vai DELETAR os ${imp.qtd_registros} lançamentos vinculados. Esta ação não pode ser desfeita.`)) return
    try {
      // Deleta lançamentos vinculados (por tabela tipo)
      if (imp.tipo === 'ofx_extrato') {
        await supabase.from('transacoes_extrato').delete().eq('importacao_id', imp.id)
      } else if (imp.tipo === 'ofx_fatura_cartao') {
        await supabase.from('payable').delete().eq('importacao_id', imp.id)
      } else if (imp.tipo === 'email_nfse' || imp.tipo === 'upload_manual_nf') {
        await supabase.from('receivable').delete().eq('importacao_id', imp.id)
        await supabase.from('payable').delete().eq('importacao_id', imp.id)
      }
      // Marca import como revertida
      await supabase.from('importacoes').update({ status: 'revertida', revertida_em: new Date().toISOString() }).eq('id', imp.id)
      showToast(`${imp.qtd_registros} lançamentos removidos. Import marcado como revertido.`, 'info')
      setExpandido(null)
      setDetalhe(d => { const c = { ...d }; delete c[imp.id]; return c })
      recarregar()
    } catch (e) {
      showToast('Erro: ' + e.message, 'error')
    }
  }

  const colgroup = (
    <colgroup>
      <col style={{ width: 160 }} />
      <col style={{ width: 180 }} />
      <col />
      <col style={{ width: 110, textAlign: 'right' }} />
      <col style={{ width: 100 }} />
      <col style={{ width: 130 }} />
    </colgroup>
  )
  const temDados = !loading && filtrados.length > 0

  return (
    <AppLayout
      title="Importações"
      stickyTop={(
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {[
                { k: '', l: 'Todos', c: counts.total },
                ...Object.entries(TIPO_LABEL).map(([k, l]) => ({ k, l, c: rows.filter(r => r.tipo === k).length })).filter(x => x.c > 0),
              ].map(s => (
                <button key={s.k || 'all'} onClick={() => setFiltroTipo(s.k)} style={filtroTipo === s.k ? chipActive : chipInactive}>
                  {s.l} <span style={{ marginLeft: 4, opacity: 0.7 }}>{s.c}</span>
                </button>
              ))}
            </div>
            <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="🔍 Buscar nome..." style={{ ...inputFiltro, width: 240 }} />
          </div>
          {temDados && (
            <div style={{ ...tableWrap, marginBottom: 0, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderBottom: 'none' }}>
              <table style={{ ...tbl, tableLayout: 'fixed' }}>
                {colgroup}
                <thead>
                  <tr>
                    <th style={th}>Data</th>
                    <th style={th}>Tipo</th>
                    <th style={th}>Arquivo</th>
                    <th style={{ ...th, textAlign: 'right' }}>Qtd</th>
                    <th style={{ ...th, textAlign: 'center' }}>Status</th>
                    <th style={{ ...th, textAlign: 'center' }}>Ações</th>
                  </tr>
                </thead>
              </table>
            </div>
          )}
        </>
      )}
    >
      <div style={{ ...tableWrap, borderTopLeftRadius: temDados ? 0 : 10, borderTopRightRadius: temDados ? 0 : 10, borderTop: temDados ? 'none' : '1px solid var(--cream-dark)' }}>
        {loading ? (
          <div style={emptyState}>Carregando…</div>
        ) : filtrados.length === 0 ? (
          <div style={emptyState}>
            {rows.length === 0 ? 'Nenhum arquivo importado ainda. Vá em Conciliação, Conferência de Fatura ou Empréstimos pra importar.' : 'Nenhum resultado.'}
          </div>
        ) : (
          <table style={{ ...tbl, tableLayout: 'fixed' }}>
            {colgroup}
            <tbody>
              {filtrados.map(r => {
                const isOpen = expandido === r.id
                const st = STATUS_COR[r.status] || STATUS_COR.ativa
                return (
                  <>
                    <tr key={r.id} onClick={() => toggle(r)} style={{ cursor: 'pointer', background: isOpen ? 'var(--cream)' : 'var(--white)', opacity: r.status === 'revertida' ? 0.6 : 1 }}>
                      <td style={td}>{fmtData(r.created_at)}</td>
                      <td style={{ ...td, color: 'var(--text-mid)' }}>{TIPO_LABEL[r.tipo] || r.tipo}</td>
                      <td style={{ ...td, fontFamily: 'monospace', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.arquivo_nome || '—'}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{r.qtd_registros}</td>
                      <td style={{ ...td, textAlign: 'center' }}>
                        <span style={{ background: st.bg, color: st.cor, padding: '3px 9px', borderRadius: 999, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>{st.txt}</span>
                      </td>
                      <td style={{ ...td, textAlign: 'center', color: 'var(--text-mid)' }}>{isOpen ? '▾' : '▸'}</td>
                    </tr>
                    {isOpen && (
                      <tr style={{ background: 'var(--cream)' }}>
                        <td colSpan={6} style={{ padding: '14px 18px' }}>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                            {r.arquivo_path && (
                              <button onClick={() => baixarArquivo(r)} style={btnAcao}>📥 Baixar arquivo</button>
                            )}
                            {r.status === 'ativa' && (
                              <button onClick={() => reverter(r)} style={{ ...btnAcao, color: 'var(--red)', borderColor: 'var(--red)' }}>↶ Reverter (deletar {r.qtd_registros} lançamentos)</button>
                            )}
                          </div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-mid)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
                            Lançamentos gerados ({detalhe[r.id]?.length || 0})
                          </div>
                          {!detalhe[r.id] ? (
                            <div style={{ fontSize: 11, color: 'var(--text-mid)' }}>Carregando…</div>
                          ) : detalhe[r.id].length === 0 ? (
                            <div style={{ fontSize: 11, color: 'var(--text-mid)', fontStyle: 'italic' }}>Sem lançamentos vinculados.</div>
                          ) : (
                            <div style={{ maxHeight: 240, overflowY: 'auto', background: 'var(--white)', borderRadius: 6, border: '1px solid var(--cream-dark)' }}>
                              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                                <tbody>
                                  {detalhe[r.id].map(l => (
                                    <tr key={l.id} style={{ borderBottom: '1px solid var(--cream-dark)' }}>
                                      <td style={{ padding: '6px 10px', fontFamily: 'monospace', color: 'var(--text-mid)' }}>{l.codigo || l.id.substring(0, 8)}</td>
                                      <td style={{ padding: '6px 10px' }}>{l.data?.descricao || l.data?.desc || l.data?.supplier || '—'}</td>
                                      <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600 }}>R$ {Number(l.data?.valor || l.data?.value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                          {Object.keys(r.metadata || {}).length > 0 && (
                            <details style={{ marginTop: 10 }}>
                              <summary style={{ fontSize: 11, color: 'var(--text-mid)', cursor: 'pointer' }}>Detalhes técnicos</summary>
                              <pre style={{ fontSize: 10, color: 'var(--text-mid)', background: 'var(--white)', padding: 8, borderRadius: 4, marginTop: 6, overflowX: 'auto' }}>{JSON.stringify(r.metadata, null, 2)}</pre>
                            </details>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </AppLayout>
  )
}

const tableWrap = { background: 'var(--white)', borderRadius: 10, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)' }
const tbl = { width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontFamily: 'var(--body)' }
const th = { textAlign: 'left', padding: '12px 14px', fontSize: 9, fontWeight: 700, letterSpacing: 1.5, color: '#fff', textTransform: 'uppercase', background: 'var(--navy)', borderBottom: '2px solid var(--gold)' }
const td = { padding: '12px 14px', fontSize: 12, color: 'var(--navy)', borderBottom: '1px solid var(--cream-dark)' }
const inputFiltro = { padding: '8px 12px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 12, color: 'var(--navy)', background: 'var(--white)', outline: 'none' }
const chipBase = { border: 'none', padding: '6px 12px', borderRadius: 999, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--body)' }
const chipActive = { ...chipBase, background: 'var(--navy)', color: '#fff' }
const chipInactive = { ...chipBase, background: 'var(--cream)', color: 'var(--text-mid)' }
const btnAcao = { padding: '6px 12px', borderRadius: 4, border: '1.5px solid var(--cream-dark)', background: 'var(--white)', color: 'var(--navy)', cursor: 'pointer', fontSize: 11, fontWeight: 600, fontFamily: 'var(--body)' }
const emptyState = { padding: '60px 24px', textAlign: 'center', fontFamily: 'var(--body)', color: 'var(--text-mid)', fontSize: 13 }
