import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import AppLayout from '../components/AppLayout'
import ModalLancamento from './components/ModalLancamento'
import FiltrosAvancados from './components/FiltrosAvancados'
import { resolveDateRange } from '../lib/dateRanges'
import { showToast } from '../components/Toast'

// ─── helpers ──────────────────────────────────────────────────────────────
function fmtMoeda(v) {
  const n = parseFloat(v) || 0
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
function fmtData(s) {
  if (!s) return '—'
  const [y, m, d] = s.split('-')
  return `${d}/${m}/${y}`
}
function statusCfg(status) {
  const s = (status || '').toLowerCase()
  if (s === 'recebido') return { label: 'Recebido', bg: 'rgba(39,174,96,0.10)', color: 'var(--green)' }
  if (s === 'atrasado') return { label: 'Atrasado', bg: 'rgba(231,76,60,0.10)', color: 'var(--red)' }
  return { label: 'Pendente', bg: 'rgba(230,126,34,0.10)', color: 'var(--orange)' }
}

export default function Receber() {
  const { user } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [busca, setBusca] = useState('')
  const [sortCol, setSortCol] = useState('due')
  const [sortDir, setSortDir] = useState('desc')
  const [filtroStatus, setFiltroStatus] = useState('')
  const [filtrosAvancados, setFiltrosAvancados] = useState({ periodo: '', dataDe: '', dataAte: '', categoria: '', vmin: '', vmax: '' })
  const [filtrosExpanded, setFiltrosExpanded] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [edicao, setEdicao] = useState(null)

  const recarregar = useCallback(() => {
    if (!user) return
    setLoading(true)
    supabase
      .from('receivable')
      .select('*')
      .order('updated_at', { ascending: false })
      .then(({ data }) => {
        setRows(data || [])
        setLoading(false)
      })
  }, [user])

  useEffect(() => { recarregar() }, [recarregar])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    let r = rows
    if (filtroStatus) {
      r = r.filter(item => (item.data?.status || '').toLowerCase() === filtroStatus.toLowerCase())
    }
    if (q) {
      r = r.filter(item => {
        const d = item.data || {}
        const blob = [item.codigo, d.client, d.desc, d.value, d.cat].filter(Boolean).join(' ').toLowerCase()
        return blob.includes(q)
      })
    }
    // Filtros avançados — período por vencimento, categoria, valor min/max
    const range = resolveDateRange(filtrosAvancados.periodo, filtrosAvancados.dataDe, filtrosAvancados.dataAte)
    if (range) {
      r = r.filter(item => {
        const due = item.data?.due
        return due && due >= range.from && due <= range.to
      })
    }
    if (filtrosAvancados.categoria) {
      r = r.filter(item => item.data?.cat === filtrosAvancados.categoria)
    }
    const vmin = parseFloat(filtrosAvancados.vmin)
    const vmax = parseFloat(filtrosAvancados.vmax)
    if (!isNaN(vmin)) r = r.filter(item => parseFloat(item.data?.value || 0) >= vmin)
    if (!isNaN(vmax)) r = r.filter(item => parseFloat(item.data?.value || 0) <= vmax)
    return [...r].sort((a, b) => {
      const va = (a.data?.[sortCol] ?? a[sortCol] ?? '').toString()
      const vb = (b.data?.[sortCol] ?? b[sortCol] ?? '').toString()
      let cmp = 0
      if (sortCol === 'value') cmp = parseFloat(va || 0) - parseFloat(vb || 0)
      else cmp = va.localeCompare(vb)
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [rows, busca, filtroStatus, filtrosAvancados, sortCol, sortDir])

  function toggleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  const total = useMemo(
    () => filtrados.reduce((s, x) => s + (parseFloat(x.data?.value) || 0), 0),
    [filtrados],
  )

  function abrirNovo() { setEdicao(null); setModalOpen(true) }
  function abrirEdicao(row) { setEdicao(row); setModalOpen(true) }

  async function excluir(row, e) {
    e?.stopPropagation()
    const desc = row.data?.desc || row.codigo || 'este lançamento'
    if (!confirm(`Excluir "${desc}"?`)) return
    const { error } = await supabase.from('receivable').delete().eq('id', row.id)
    if (error) { showToast('Erro ao excluir: ' + error.message, 'error'); return }
    showToast('Lançamento excluído.', 'info')
    recarregar()
  }

  return (
    <AppLayout title="Contas a Receber">
      {/* Topo: chips + botão novo */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[
            { key: '', label: 'Todos', color: 'var(--navy)', bg: 'rgba(0,32,62,0.06)' },
            { key: 'Pendente', label: 'Pendente', color: 'var(--orange)', bg: 'rgba(230,126,34,0.10)' },
            { key: 'Recebido', label: 'Recebido', color: 'var(--green)', bg: 'rgba(39,174,96,0.10)' },
            { key: 'Atrasado', label: 'Atrasado', color: 'var(--red)', bg: 'rgba(231,76,60,0.10)' },
          ].map(opt => {
            const active = filtroStatus === opt.key
            return (
              <button
                key={opt.key || 'all'}
                onClick={() => setFiltroStatus(opt.key)}
                style={{
                  padding: '7px 14px', borderRadius: 999,
                  fontFamily: 'var(--body)', fontSize: 11, fontWeight: 600, letterSpacing: 0.5,
                  cursor: 'pointer', transition: 'all .15s',
                  border: `1.5px solid ${active ? opt.color : 'var(--cream-dark)'}`,
                  background: active ? opt.bg : 'var(--white)',
                  color: active ? opt.color : 'var(--text-mid)',
                  textTransform: 'uppercase',
                }}
              >{opt.label}</button>
            )
          })}
        </div>
        <button onClick={abrirNovo} style={btnNovo}>
          <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> Nova conta
        </button>
      </div>

      {/* Barra de busca + resumo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 480 }}>
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
            style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-mid)' }}>
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            value={busca} onChange={e => setBusca(e.target.value)}
            placeholder="Buscar por cliente, descrição, código..."
            style={searchInput}
          />
        </div>
        <div style={resumo}>
          <span style={{ color: 'var(--text-mid)' }}>{filtrados.length} {filtrados.length === 1 ? 'lançamento' : 'lançamentos'}</span>
          <span style={{ width: 1, height: 14, background: 'var(--cream-dark)' }} />
          <span style={{ fontWeight: 600, color: 'var(--navy)' }}>{fmtMoeda(total)}</span>
        </div>
      </div>

      {/* Filtros avançados */}
      <FiltrosAvancados
        tipo="rec"
        filtros={filtrosAvancados}
        setFiltros={setFiltrosAvancados}
        expanded={filtrosExpanded}
        setExpanded={setFiltrosExpanded}
      />

      {/* Tabela */}
      <div style={tableWrap}>
        {loading ? (
          <div style={emptyState}>Carregando…</div>
        ) : filtrados.length === 0 ? (
          <div style={emptyState}>
            {rows.length === 0 ? 'Nenhuma conta a receber cadastrada. Clique em "Nova conta" pra começar.' : 'Nenhum resultado para os filtros.'}
          </div>
        ) : (
          <table style={tbl}>
            <thead>
              <tr>
                <Th onClick={() => toggleSort('codigo')} active={sortCol === 'codigo'} dir={sortDir} width={90}>Cód.</Th>
                <Th onClick={() => toggleSort('client')} active={sortCol === 'client'} dir={sortDir}>Cliente</Th>
                <th style={th}>Descrição</th>
                <Th onClick={() => toggleSort('value')} active={sortCol === 'value'} dir={sortDir} align="right" width={120}>Valor</Th>
                <Th onClick={() => toggleSort('due')} active={sortCol === 'due'} dir={sortDir} width={140}>Datas</Th>
                <th style={th}>Categoria</th>
                <Th onClick={() => toggleSort('status')} active={sortCol === 'status'} dir={sortDir} width={110}>Status</Th>
                <th style={{ ...th, width: 50, textAlign: 'center' }}></th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map(item => {
                const d = item.data || {}
                const cfg = statusCfg(d.status)
                return (
                  <tr
                    key={item.id}
                    onClick={() => abrirEdicao(item)}
                    style={trStyle}
                    title="Clique para editar"
                  >
                    <td style={tdMono}>{item.codigo || '—'}{item.anexo_path && <span style={{ marginLeft: 6, color: 'var(--gold)' }} title="Anexo fiscal">📎</span>}</td>
                    <td style={td}>{d.client || '—'}</td>
                    <td style={{ ...td, color: 'var(--text-mid)' }}>{d.desc || '—'}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{fmtMoeda(d.value)}</td>
                    <td style={td}>
                      {d.data_competencia && <div style={{ fontSize: 10, color: 'var(--text-mid)', lineHeight: 1.4 }}>📄 {fmtData(d.data_competencia)}</div>}
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--navy)', lineHeight: 1.4 }}>📅 {fmtData(d.due)}</div>
                      {d.data_pagamento && <div style={{ fontSize: 10, color: 'var(--green)', lineHeight: 1.4 }}>✓ {fmtData(d.data_pagamento)}</div>}
                    </td>
                    <td style={{ ...td, color: 'var(--text-mid)' }}>{d.cat || '—'}</td>
                    <td style={td}>
                      <span style={{
                        display: 'inline-block', padding: '3px 9px', borderRadius: 999,
                        fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
                        background: cfg.bg, color: cfg.color, textTransform: 'uppercase',
                      }}>{cfg.label}</span>
                    </td>
                    <td style={{ ...td, textAlign: 'center' }}>
                      <button
                        onClick={e => excluir(item, e)}
                        title="Excluir"
                        style={btnExcluir}
                        aria-label="Excluir lançamento"
                      >×</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <ModalLancamento
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        tipo="rec"
        registro={edicao}
        onSaved={recarregar}
      />
    </AppLayout>
  )
}

// ─── celulas de cabeçalho com sort ─────────────────────────────────────────
function Th({ children, onClick, active, dir, align = 'left', width }) {
  return (
    <th
      onClick={onClick}
      style={{ ...th, cursor: 'pointer', userSelect: 'none', textAlign: align, width, color: active ? 'var(--gold)' : 'var(--text-mid)' }}
    >
      {children}
      <span style={{ fontSize: 9, marginLeft: 4, opacity: active ? 1 : 0.4 }}>{active && dir === 'asc' ? '▲' : '▼'}</span>
    </th>
  )
}

// ─── styles ───────────────────────────────────────────────────────────────
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
  transition: 'all .15s',
}
const searchInput = {
  width: '100%', padding: '10px 13px 10px 32px',
  border: '1.5px solid var(--cream-dark)', borderRadius: 6,
  fontFamily: 'var(--body)', fontSize: 12,
  color: 'var(--navy)', background: 'var(--white)', outline: 'none',
}
const resumo = {
  display: 'flex', alignItems: 'center', gap: 12,
  fontFamily: 'var(--body)', fontSize: 12,
  padding: '8px 14px', background: 'var(--white)',
  border: '1px solid var(--cream-dark)', borderRadius: 6,
}
const tableWrap = {
  background: 'var(--white)', borderRadius: 12,
  border: '1px solid var(--cream-dark)',
  boxShadow: 'var(--shadow)',
  overflow: 'hidden',
}
const tbl = { width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--body)' }
const th = {
  textAlign: 'left', padding: '12px 14px',
  fontSize: 9, fontWeight: 700, letterSpacing: 1.5,
  color: 'var(--text-mid)', textTransform: 'uppercase',
  background: 'var(--cream)',
  borderBottom: '1px solid var(--cream-dark)',
}
const trStyle = { transition: 'background .15s', cursor: 'pointer' }
const td = {
  padding: '12px 14px', fontSize: 12, color: 'var(--navy)',
  borderBottom: '1px solid var(--cream-dark)',
  verticalAlign: 'middle',
}
const tdMono = { ...td, fontFamily: 'var(--body)', fontWeight: 600, color: 'var(--text-mid)', letterSpacing: 0.5 }
const emptyState = {
  padding: '60px 24px', textAlign: 'center',
  fontFamily: 'var(--body)', color: 'var(--text-mid)', fontSize: 13,
}
