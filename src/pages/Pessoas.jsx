import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import AppLayout from '../components/AppLayout'
import EstadoErro from '../components/EstadoErro'
import ModalPessoa from './components/ModalPessoa'
import { showToast } from '../components/Toast'

function fmtDoc(s) {
  if (!s) return '—'
  const n = String(s).replace(/\D/g, '')
  if (n.length === 11) return n.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  if (n.length === 14) return n.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
  return s
}

export default function Pessoas({ tipo, titulo, labelDoc = 'CNPJ/CPF' }) {
  const { user } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState(null)
  const [busca, setBusca] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [edicao, setEdicao] = useState(null)

  const recarregar = useCallback(() => {
    if (!user) return
    setLoading(true)
    supabase
      .from('pessoas')
      .select('*')
      .order('updated_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) { setErro(error); setRows([]) }
        else { setErro(null); setRows((data || []).filter(p => (p.data?.tipo || '') === tipo)) }
        setLoading(false)
      })
      .catch((e) => { setErro(e); setLoading(false) })
  }, [user, tipo])

  useEffect(() => { recarregar() }, [recarregar])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(item => {
      const d = item.data || {}
      const blob = [item.codigo, d.nome, d.fantasia, d.doc, d.email, d.telefone, d.cidade, d.uf]
        .filter(Boolean).join(' ').toLowerCase()
      return blob.includes(q)
    })
  }, [rows, busca])

  function abrirNovo() { setEdicao(null); setModalOpen(true) }
  function abrirEdicao(row) { setEdicao(row); setModalOpen(true) }

  async function excluir(row, e) {
    e?.stopPropagation()
    const nome = row.data?.nome || row.codigo || 'este cadastro'
    if (!confirm(`Excluir "${nome}"? Esta ação não pode ser desfeita.`)) return
    const { error } = await supabase.from('pessoas').delete().eq('id', row.id)
    if (error) { showToast('Erro ao excluir: ' + error.message, 'error'); return }
    showToast('Cadastro excluído.', 'info')
    recarregar()
  }

  const colgroup = (
    <colgroup>
      <col style={{ width: 90 }} />
      <col />
      <col style={{ width: 150 }} />
      <col />
      <col style={{ width: 130 }} />
      <col style={{ width: 150 }} />
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
              <input
                value={busca} onChange={e => setBusca(e.target.value)}
                placeholder={`Buscar ${titulo.toLowerCase()}...`}
                style={searchInput}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={resumo}>
                <span style={{ color: 'var(--text-mid)' }}>{filtrados.length} {filtrados.length === 1 ? 'cadastro' : 'cadastros'}</span>
              </div>
              <button onClick={abrirNovo} style={btnNovo}>
                <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> Novo {tipo === 'Órgão Público' ? 'órgão' : tipo.toLowerCase()}
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
                    <th style={th}>Nome</th>
                    <th style={th}>{labelDoc}</th>
                    <th style={th}>Email</th>
                    <th style={th}>Telefone</th>
                    <th style={th}>Cidade/UF</th>
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
        ) : erro ? (
          <EstadoErro onRetry={recarregar} />
        ) : filtrados.length === 0 ? (
          <div style={emptyState}>
            {rows.length === 0 ? `Nenhum ${tipo.toLowerCase()} cadastrado. Clique em "Novo" pra começar.` : 'Nenhum resultado para a busca.'}
          </div>
        ) : (
          <table style={{ ...tbl, tableLayout: 'fixed' }}>
            {colgroup}
            <tbody>
              {filtrados.map(p => {
                const d = p.data || {}
                return (
                  <tr
                    key={p.id}
                    onClick={() => abrirEdicao(p)}
                    style={{ cursor: 'pointer' }}
                    title="Clique para editar"
                  >
                    <td style={tdMono}>{p.codigo || '—'}</td>
                    <td style={td}>{d.nome || '—'}</td>
                    <td style={{ ...td, color: 'var(--text-mid)' }}>{fmtDoc(d.doc)}</td>
                    <td style={{ ...td, color: 'var(--text-mid)' }}>{d.email || '—'}</td>
                    <td style={{ ...td, color: 'var(--text-mid)' }}>{d.telefone || '—'}</td>
                    <td style={{ ...td, color: 'var(--text-mid)' }}>{[d.cidade, d.uf].filter(Boolean).join('/') || '—'}</td>
                    <td style={{ ...td, textAlign: 'center' }}>
                      <button
                        onClick={e => excluir(p, e)}
                        title="Excluir" aria-label="Excluir cadastro"
                        style={btnExcluir}
                      >×</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <ModalPessoa
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        tipo={tipo}
        registro={edicao}
        onSaved={recarregar}
      />
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
