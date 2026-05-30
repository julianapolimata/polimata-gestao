import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import AppLayout from '../components/AppLayout'
import ModalCartao from './components/ModalCartao'
import { showToast } from '../components/Toast'

export default function Cartoes() {
  const { user } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [busca, setBusca] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [edicao, setEdicao] = useState(null)

  const recarregar = useCallback(() => {
    if (!user) return
    setLoading(true)
    supabase.from('cartoes').select('*').order('updated_at', { ascending: false })
      .then(({ data }) => { setRows(data || []); setLoading(false) })
  }, [user])

  useEffect(() => { recarregar() }, [recarregar])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(item => {
      const d = item.data || {}
      return [d.nome, d.bandeira, d.observacoes].filter(Boolean).join(' ').toLowerCase().includes(q)
    })
  }, [rows, busca])

  function abrirNovo() { setEdicao(null); setModalOpen(true) }
  function abrirEdicao(row) { setEdicao(row); setModalOpen(true) }

  async function excluir(row, e) {
    e?.stopPropagation()
    if (!confirm(`Excluir cartão "${row.data?.nome || ''}"? Lançamentos vinculados continuarão registrados mas perderão o vínculo.`)) return
    const { error } = await supabase.from('cartoes').delete().eq('id', row.id)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast('Cartão excluído.', 'info'); recarregar()
  }

  return (
    <AppLayout title="Cartões de Crédito">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 480 }}>
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
            style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-mid)' }}>
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar cartão..." style={searchInput} />
        </div>
        <button onClick={abrirNovo} style={btnNovo}>+ Novo cartão</button>
      </div>

      <div style={tableWrap}>
        {loading ? (
          <div style={emptyState}>Carregando…</div>
        ) : filtrados.length === 0 ? (
          <div style={emptyState}>
            {rows.length === 0 ? 'Nenhum cartão cadastrado. Clique em "+ Novo cartão" pra começar.' : 'Nenhum resultado.'}
          </div>
        ) : (
          <table style={tbl}>
            <thead>
              <tr>
                <th style={th}>Nome</th>
                <th style={{ ...th, width: 130 }}>Bandeira</th>
                <th style={{ ...th, width: 110, textAlign: 'center' }}>Fechamento</th>
                <th style={{ ...th, width: 110, textAlign: 'center' }}>Vencimento</th>
                <th style={{ ...th, width: 90, textAlign: 'center' }}>Status</th>
                <th style={{ ...th, width: 50, textAlign: 'center' }}></th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map(c => {
                const d = c.data || {}
                return (
                  <tr key={c.id} onClick={() => abrirEdicao(c)} style={{ cursor: 'pointer' }} title="Clique para editar">
                    <td style={{ ...td, fontWeight: 600 }}>{d.nome || '—'}</td>
                    <td style={{ ...td, color: 'var(--text-mid)' }}>{d.bandeira || '—'}</td>
                    <td style={{ ...td, textAlign: 'center' }}>Dia {d.dia_fechamento || '—'}</td>
                    <td style={{ ...td, textAlign: 'center' }}>Dia {d.dia_vencimento || '—'}</td>
                    <td style={{ ...td, textAlign: 'center' }}>
                      {d.ativo !== false
                        ? <span style={{ background: 'rgba(39,174,96,0.10)', color: 'var(--green)', padding: '3px 10px', borderRadius: 999, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Ativo</span>
                        : <span style={{ background: 'rgba(0,0,0,0.05)', color: 'var(--text-mid)', padding: '3px 10px', borderRadius: 999, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Inativo</span>}
                    </td>
                    <td style={{ ...td, textAlign: 'center' }}>
                      <button onClick={e => excluir(c, e)} title="Excluir" aria-label="Excluir cartão" style={btnExcluir}>×</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <ModalCartao open={modalOpen} onClose={() => setModalOpen(false)} registro={edicao} onSaved={recarregar} />
    </AppLayout>
  )
}

const btnNovo = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 6, border: 'none', background: 'var(--gold)', color: '#fff', fontFamily: 'var(--body)', fontSize: 12, fontWeight: 700, letterSpacing: 0.5, cursor: 'pointer', textTransform: 'uppercase' }
const btnExcluir = { background: 'none', border: '1px solid transparent', borderRadius: 4, color: 'var(--text-mid)', fontSize: 18, lineHeight: 1, cursor: 'pointer', width: 26, height: 26, padding: 0 }
const searchInput = { width: '100%', padding: '10px 13px 10px 32px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 12, color: 'var(--navy)', background: 'var(--white)', outline: 'none' }
const tableWrap = { background: 'var(--white)', borderRadius: 12, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)', overflow: 'hidden' }
const tbl = { width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--body)' }
const th = { textAlign: 'left', padding: '12px 14px', fontSize: 9, fontWeight: 700, letterSpacing: 1.5, color: 'var(--text-mid)', textTransform: 'uppercase', background: 'var(--cream)', borderBottom: '1px solid var(--cream-dark)' }
const td = { padding: '12px 14px', fontSize: 12, color: 'var(--navy)', borderBottom: '1px solid var(--cream-dark)', verticalAlign: 'middle' }
const emptyState = { padding: '60px 24px', textAlign: 'center', fontFamily: 'var(--body)', color: 'var(--text-mid)', fontSize: 13 }
