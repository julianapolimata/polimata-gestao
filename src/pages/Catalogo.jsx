import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import AppLayout from '../components/AppLayout'

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

  useEffect(() => {
    if (!user) return
    supabase
      .from(tabela)
      .select('*')
      .order('updated_at', { ascending: false })
      .then(({ data }) => {
        setRows(data || [])
        setLoading(false)
      })
  }, [user, tabela])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(item => {
      const d = item.data || {}
      const blob = [item.codigo, d.name, d.client, d.value, d.status, d.notes].filter(Boolean).join(' ').toLowerCase()
      return blob.includes(q)
    })
  }, [rows, busca])

  const total = useMemo(
    () => filtrados.reduce((s, x) => s + (parseFloat(x.data?.value) || 0), 0),
    [filtrados],
  )

  return (
    <AppLayout title={titulo}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 480 }}>
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
            style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-mid)' }}>
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder={`Buscar ${titulo.toLowerCase()}...`} style={searchInput} />
        </div>
        <div style={resumo}>
          <span style={{ color: 'var(--text-mid)' }}>{filtrados.length} {filtrados.length === 1 ? 'registro' : 'registros'}</span>
          <span style={{ width: 1, height: 14, background: 'var(--cream-dark)' }} />
          <span style={{ fontWeight: 600, color: 'var(--navy)' }}>{fmtMoeda(total)}</span>
        </div>
      </div>

      <div style={tableWrap}>
        {loading ? (
          <div style={emptyState}>Carregando…</div>
        ) : filtrados.length === 0 ? (
          <div style={emptyState}>{rows.length === 0 ? `Nenhum ${titulo.toLowerCase().slice(0,-1)} cadastrado.` : 'Nenhum resultado para a busca.'}</div>
        ) : (
          <table style={tbl}>
            <thead>
              <tr>
                <th style={{ ...th, width: 110 }}>Cód.</th>
                <th style={th}>Nome</th>
                <th style={th}>{labelParte}</th>
                <th style={{ ...th, width: 140, textAlign: 'right' }}>Valor</th>
                <th style={{ ...th, width: 110 }}>Prazo</th>
                <th style={{ ...th, width: 110 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map(p => {
                const d = p.data || {}
                return (
                  <tr key={p.id}>
                    <td style={tdMono}>{p.codigo || '—'}</td>
                    <td style={td}>{d.name || '—'}</td>
                    <td style={{ ...td, color: 'var(--text-mid)' }}>{d.client || '—'}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{fmtMoeda(d.value)}</td>
                    <td style={{ ...td, color: 'var(--text-mid)' }}>{fmtData(d.deadline)}</td>
                    <td style={{ ...td, color: 'var(--text-mid)' }}>{d.status || '—'}</td>
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
