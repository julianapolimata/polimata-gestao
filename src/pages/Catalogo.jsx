import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import AppLayout from '../components/AppLayout'
import ModalContrato from './components/ModalContrato'
import ModalProjeto from './components/ModalProjeto'
import { showToast } from '../components/Toast'

function fmtMoeda(v) {
  const n = parseFloat(v) || 0
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
function fmtData(s) {
  if (!s) return '—'
  const [y, m, d] = s.split('-')
  return `${d}/${m}/${y}`
}

export default function Catalogo({ tabela, titulo, labelParte = 'Cliente' }) {
  const { user } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [busca, setBusca] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [edicao, setEdicao] = useState(null)

  const isContrato = tabela === 'contracts'
  const novoLabel = isContrato ? 'contrato' : 'projeto'

  const recarregar = useCallback(() => {
    if (!user) return
    setLoading(true)
    supabase
      .from(tabela)
      .select('*')
      .order('updated_at', { ascending: false })
      .then(({ data }) => {
        setRows(data || [])
        setLoading(false)
      })
  }, [user, tabela])

  useEffect(() => { recarregar() }, [recarregar])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(item => {
      const d = item.data || {}
      const blob = [item.codigo, d.name, d.party, d.client, d.object, d.value, d.status, d.notes]
        .filter(Boolean).join(' ').toLowerCase()
      return blob.includes(q)
    })
  }, [rows, busca])

  const total = useMemo(
    () => filtrados.reduce((s, x) => s + (parseFloat(x.data?.value) || 0), 0),
    [filtrados],
  )

  function abrirNovo() { setEdicao(null); setModalOpen(true) }
  function abrirEdicao(row) { setEdicao(row); setModalOpen(true) }

  async function excluir(row, e) {
    e?.stopPropagation()
    const nome = row.data?.name || row.data?.party || row.codigo || `este ${novoLabel}`
    if (!confirm(`Excluir "${nome}"?`)) return
    const { error } = await supabase.from(tabela).delete().eq('id', row.id)
    if (error) { showToast('Erro ao excluir: ' + error.message, 'error'); return }
    showToast(`${isContrato ? 'Contrato' : 'Projeto'} excluído.`, 'info')
    recarregar()
  }

  const colgroup = (
    <colgroup>
      <col style={{ width: 110 }} />
      <col />
      <col />
      <col style={{ width: 140 }} />
      <col style={{ width: 110 }} />
      <col style={{ width: 110 }} />
      <col style={{ width: 50 }} />
    </colgroup>
  )
  const temDados = !loading && filtrados.length > 0

  return (
    <AppLayout
      title={titulo}
      stickyTop={(
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: 1, maxWidth: 480 }}>
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
                style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-mid)' }}>
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input value={busca} onChange={e => setBusca(e.target.value)} placeholder={`Buscar ${titulo.toLowerCase()}...`} style={searchInput} />
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={resumo}>
                <span style={{ color: 'var(--text-mid)' }}>{filtrados.length} {filtrados.length === 1 ? 'registro' : 'registros'}</span>
                <span style={{ width: 1, height: 14, background: 'var(--cream-dark)' }} />
                <span style={{ fontWeight: 600, color: 'var(--navy)' }}>{fmtMoeda(total)}</span>
              </div>
              <button onClick={abrirNovo} style={btnNovo}>
                <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> Novo {novoLabel}
              </button>
            </div>
          </div>
          {temDados && (
            <div style={{ ...tableWrap, marginBottom: 0, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderBottom: 'none' }}>
              <table style={{ ...tbl, tableLayout: 'fixed' }}>
                {colgroup}
                <thead>
                  <tr>
                    <th style={th}>Cód.</th>
                    <th style={th}>{isContrato ? 'Objeto' : 'Nome'}</th>
                    <th style={th}>{labelParte}</th>
                    <th style={{ ...th, textAlign: 'right' }}>Valor</th>
                    <th style={th}>{isContrato ? 'Início' : 'Prazo'}</th>
                    <th style={th}>Status</th>
                    <th style={{ ...th, textAlign: 'center' }}></th>
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
            {rows.length === 0 ? `Nenhum ${novoLabel} cadastrado. Clique em "Novo ${novoLabel}" pra começar.` : 'Nenhum resultado para a busca.'}
          </div>
        ) : (
          <table style={{ ...tbl, tableLayout: 'fixed' }}>
            {colgroup}
            <tbody>
              {filtrados.map(p => {
                const d = p.data || {}
                return (
                  <tr key={p.id} onClick={() => abrirEdicao(p)} style={{ cursor: 'pointer' }} title="Clique para editar">
                    <td style={tdMono}>{p.codigo || '—'}</td>
                    <td style={td}>{(isContrato ? d.object : d.name) || '—'}</td>
                    <td style={{ ...td, color: 'var(--text-mid)' }}>{(isContrato ? d.party : d.client) || '—'}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{fmtMoeda(d.value)}</td>
                    <td style={{ ...td, color: 'var(--text-mid)' }}>{fmtData(isContrato ? d.start : d.deadline)}</td>
                    <td style={{ ...td, color: 'var(--text-mid)' }}>{d.status || '—'}</td>
                    <td style={{ ...td, textAlign: 'center' }}>
                      <button onClick={e => excluir(p, e)} title="Excluir" aria-label="Excluir" style={btnExcluir}>×</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {isContrato ? (
        <ModalContrato open={modalOpen} onClose={() => setModalOpen(false)} registro={edicao} onSaved={recarregar} />
      ) : (
        <ModalProjeto open={modalOpen} onClose={() => setModalOpen(false)} registro={edicao} onSaved={recarregar} />
      )}
    </AppLayout>
  )
}

const btnNovo = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '8px 16px', borderRadius: 6,
  border: 'none', background: 'var(--gold)', color: '#fff',
  fontFamily: 'var(--body)', fontSize: 12, fontWeight: 700, letterSpacing: 0.5,
  cursor: 'pointer', textTransform: 'uppercase',
}
const btnExcluir = {
  background: 'none', border: '1px solid transparent', borderRadius: 4,
  color: 'var(--text-mid)', fontSize: 18, lineHeight: 1, cursor: 'pointer',
  width: 26, height: 26, padding: 0,
}
const searchInput = { width: '100%', padding: '10px 13px 10px 32px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 12, color: 'var(--navy)', background: 'var(--white)', outline: 'none' }
const resumo = { display: 'flex', alignItems: 'center', gap: 12, fontFamily: 'var(--body)', fontSize: 12, padding: '8px 14px', background: 'var(--white)', border: '1px solid var(--cream-dark)', borderRadius: 6 }
const tableWrap = { background: 'var(--white)', borderRadius: 12, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)', overflow: 'clip' }
const tbl = { width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--body)' }
const th = { textAlign: 'left', padding: '12px 14px', fontSize: 9, fontWeight: 700, letterSpacing: 1.5, color: '#fff', textTransform: 'uppercase', background: 'var(--navy)', borderBottom: '2px solid var(--gold)' }
const td = { padding: '12px 14px', fontSize: 12, color: 'var(--navy)', borderBottom: '1px solid var(--cream-dark)', verticalAlign: 'middle' }
const tdMono = { ...td, fontWeight: 600, color: 'var(--text-mid)', letterSpacing: 0.5 }
const emptyState = { padding: '60px 24px', textAlign: 'center', fontFamily: 'var(--body)', color: 'var(--text-mid)', fontSize: 13 }
