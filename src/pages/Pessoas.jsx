import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import AppLayout from '../components/AppLayout'

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
  const [busca, setBusca] = useState('')

  useEffect(() => {
    if (!user) return
    supabase
      .from('pessoas')
      .select('*')
      .order('updated_at', { ascending: false })
      .then(({ data }) => {
        const filtered = (data || []).filter(p => (p.data?.tipo || '') === tipo)
        setRows(filtered)
        setLoading(false)
      })
  }, [user, tipo])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(item => {
      const d = item.data || {}
      const blob = [item.codigo, d.nome, d.doc, d.email, d.telefone, d.cidade, d.uf].filter(Boolean).join(' ').toLowerCase()
      return blob.includes(q)
    })
  }, [rows, busca])

  return (
    <AppLayout title={titulo}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
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
        <div style={resumo}>
          <span style={{ color: 'var(--text-mid)' }}>{filtrados.length} {filtrados.length === 1 ? 'cadastro' : 'cadastros'}</span>
        </div>
      </div>

      <div style={tableWrap}>
        {loading ? (
          <div style={emptyState}>Carregando…</div>
        ) : filtrados.length === 0 ? (
          <div style={emptyState}>
            {rows.length === 0 ? `Nenhum ${tipo.toLowerCase()} cadastrado.` : 'Nenhum resultado para a busca.'}
          </div>
        ) : (
          <table style={tbl}>
            <thead>
              <tr>
                <th style={{ ...th, width: 90 }}>Cód.</th>
                <th style={th}>Nome</th>
                <th style={{ ...th, width: 150 }}>{labelDoc}</th>
                <th style={th}>Email</th>
                <th style={{ ...th, width: 130 }}>Telefone</th>
                <th style={{ ...th, width: 150 }}>Cidade/UF</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map(p => {
                const d = p.data || {}
                return (
                  <tr key={p.id}>
                    <td style={tdMono}>{p.codigo || '—'}</td>
                    <td style={td}>{d.nome || '—'}</td>
                    <td style={{ ...td, color: 'var(--text-mid)' }}>{fmtDoc(d.doc)}</td>
                    <td style={{ ...td, color: 'var(--text-mid)' }}>{d.email || '—'}</td>
                    <td style={{ ...td, color: 'var(--text-mid)' }}>{d.telefone || '—'}</td>
                    <td style={{ ...td, color: 'var(--text-mid)' }}>{[d.cidade, d.uf].filter(Boolean).join('/') || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </AppLayout>
  )
}

const searchInput = { width: '100%', padding: '10px 13px 10px 32px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 12, color: 'var(--navy)', background: 'var(--white)', outline: 'none' }
const resumo = { display: 'flex', alignItems: 'center', gap: 12, fontFamily: 'var(--body)', fontSize: 12, padding: '8px 14px', background: 'var(--white)', border: '1px solid var(--cream-dark)', borderRadius: 6 }
const tableWrap = { background: 'var(--white)', borderRadius: 12, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)', overflow: 'hidden' }
const tbl = { width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--body)' }
const th = { textAlign: 'left', padding: '12px 14px', fontSize: 9, fontWeight: 700, letterSpacing: 1.5, color: 'var(--text-mid)', textTransform: 'uppercase', background: 'var(--cream)', borderBottom: '1px solid var(--cream-dark)' }
const td = { padding: '12px 14px', fontSize: 12, color: 'var(--navy)', borderBottom: '1px solid var(--cream-dark)', verticalAlign: 'middle' }
const tdMono = { ...td, fontWeight: 600, color: 'var(--text-mid)', letterSpacing: 0.5 }
const emptyState = { padding: '60px 24px', textAlign: 'center', fontFamily: 'var(--body)', color: 'var(--text-mid)', fontSize: 13 }
