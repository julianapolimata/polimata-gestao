import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Chart } from 'chart.js/auto'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import AppLayout from '../components/AppLayout'
import EstadoErro from '../components/EstadoErro'
import ModalLancamento from './components/ModalLancamento'
import FiltrosAvancados from './components/FiltrosAvancados'
import { resolveDateRange } from '../lib/dateRanges'
import { showToast } from '../components/Toast'
import { getDocStatus, isOverdue } from '../lib/finance'
import { calcMRR } from '../lib/indicadores'
import { proximoCodigoReceivable } from '../lib/codigos'
import { promoverProvisao } from '../lib/gerarRecorrencias'

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
  if (s === 'provisão' || s === 'provisao') return { label: 'Provisão', bg: 'rgba(29,59,92,0.10)', color: 'var(--navy-light)' }
  if (s === 'atrasado') return { label: 'Atrasado', bg: 'rgba(231,76,60,0.10)', color: 'var(--red)' }
  return { label: 'Pendente', bg: 'rgba(230,126,34,0.10)', color: 'var(--orange)' }
}

export default function Receber() {
  const { user } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState(null)
  const [busca, setBusca] = useState('')
  const [sortCol, setSortCol] = useState('due')
  const [sortDir, setSortDir] = useState('desc')
  const [filtroStatus, setFiltroStatus] = useState('')
  const [dataDe, setDataDe] = useState('')
  const [dataAte, setDataAte] = useState('')
  const [tipoData, setTipoData] = useState('due') // due | data_pagamento | data_competencia
  const [filtrosAvancados, setFiltrosAvancados] = useState({ periodo: '', dataDe: '', dataAte: '', categoria: '', vmin: '', vmax: '' })
  const [filtrosExpanded, setFiltrosExpanded] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [edicao, setEdicao] = useState(null)
  const [anoSel, setAnoSel] = useState(String(new Date().getFullYear()))
  const [recorrencias, setRecorrencias] = useState([])
  const chartRef = useRef(null)
  const chartInst = useRef(null)

  useEffect(() => {
    if (!user) return
    supabase.from('recurring_masters').select('*').then(({ data }) => setRecorrencias(data || []))
  }, [user])

  const recarregar = useCallback(() => {
    if (!user) return
    setLoading(true)
    supabase
      .from('receivable')
      .select('*')
      .order('updated_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) { setErro(error); setRows([]) }
        else { setErro(null); setRows(data || []) }
        setLoading(false)
      })
      .catch((e) => { setErro(e); setLoading(false) })
  }, [user])

  useEffect(() => { recarregar() }, [recarregar])

  // Filtro vindo por URL (ex.: cards de alerta do Início → ?filtro=vencidos)
  const [searchParams] = useSearchParams()
  useEffect(() => {
    const f = searchParams.get('filtro')
    if (f === 'vencidos') setFiltroStatus('__vencidos__')
    else if (f === 'sem_doc') setFiltroStatus('__sem_doc__')
  }, [searchParams])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    let r = rows
    if (filtroStatus) {
      if (filtroStatus === '__sem_doc__') r = r.filter(item => getDocStatus(item) === 'pendente')
      else if (filtroStatus === '__doc_dispensado__') r = r.filter(item => getDocStatus(item) === 'dispensado')
      else if (filtroStatus === '__vencidos__') r = r.filter(item => {
        const st = (item.data?.status || '').toLowerCase()
        return st !== 'recebido' && st !== 'provisão' && st !== 'provisao' && isOverdue(item.data?.due)
      })
      else r = r.filter(item => (item.data?.status || '').toLowerCase() === filtroStatus.toLowerCase())
    }
    if (q) {
      r = r.filter(item => {
        const d = item.data || {}
        const blob = [item.codigo, d.client, d.desc, d.value, d.cat].filter(Boolean).join(' ').toLowerCase()
        return blob.includes(q)
      })
    }
    // Filtro principal por data (De/Até + tipo: vencimento/pagamento/competência)
    if (dataDe || dataAte) {
      r = r.filter(item => {
        const v = tipoData === 'due' ? item.data?.due : item.data?.[tipoData]
        if (!v) return false
        if (dataDe && v < dataDe) return false
        if (dataAte && v > dataAte) return false
        return true
      })
    }
    // Filtros avançados — período preset (vencimento), categoria, valor min/max
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
  }, [rows, busca, filtroStatus, dataDe, dataAte, tipoData, filtrosAvancados, sortCol, sortDir])

  function toggleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  const total = useMemo(
    () => filtrados.reduce((s, x) => s + (parseFloat(x.data?.value) || 0), 0),
    [filtrados],
  )

  // ── Anos disponíveis (por competência ou vencimento) ────────────────
  const anosDisponiveis = useMemo(() => {
    const set = new Set()
    for (const r of rows) {
      const ref = r.data?.data_competencia || r.data?.due
      if (ref) set.add(ref.slice(0, 4))
    }
    if (!set.size) set.add(String(new Date().getFullYear()))
    return [...set].sort().reverse()
  }, [rows])
  useEffect(() => {
    if (anosDisponiveis.length && !anosDisponiveis.includes(anoSel)) setAnoSel(anosDisponiveis[0])
  }, [anosDisponiveis, anoSel])

  // ── Receita mês a mês do ano (competência), com composição por mês ──
  const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
  const porMes = useMemo(() => {
    const meses = MESES.map((_, m) => ({ mes: m, total: 0, recebido: 0, aReceber: 0, itens: [] }))
    for (const r of rows) {
      const d = r.data
      if (!d || d.status === 'Provisão') continue // provisão não é faturamento até virar NF
      const ref = d.data_competencia || d.due
      if (!ref || !String(ref).startsWith(anoSel)) continue
      const m = parseInt(String(ref).slice(5, 7), 10) - 1
      if (m < 0 || m > 11) continue
      const v = Number(d.value || 0)
      const g = meses[m]
      g.total += v
      if ((d.status || '').toLowerCase() === 'recebido') g.recebido += v
      else g.aReceber += v
      g.itens.push({ nome: d.client || '—', value: v, status: d.status || 'Pendente', codigo: r.codigo })
    }
    return meses
  }, [rows, anoSel])

  const kpisRec = useMemo(() => {
    const faturado = porMes.reduce((s, m) => s + m.total, 0)
    const recebido = porMes.reduce((s, m) => s + m.recebido, 0)
    const aReceber = porMes.reduce((s, m) => s + m.aReceber, 0)
    let vencido = 0
    for (const r of rows) {
      const d = r.data
      if (!d || d.status === 'Provisão') continue
      if ((d.status || '').toLowerCase() === 'recebido') continue
      const ref = d.data_competencia || d.due
      if (ref && String(ref).startsWith(anoSel) && isOverdue(d.due)) vencido += Number(d.value || 0)
    }
    return { faturado, recebido, aReceber, vencido }
  }, [porMes, rows, anoSel])

  // ── Concentração por cliente + ticket médio + nº de notas ───────────
  const analiseAno = useMemo(() => {
    const porCliente = new Map()
    let nNotas = 0, faturado = 0
    for (const r of rows) {
      const d = r.data
      if (!d || d.status === 'Provisão') continue
      const ref = d.data_competencia || d.due
      if (!ref || !String(ref).startsWith(anoSel)) continue
      const v = Number(d.value || 0)
      faturado += v; nNotas++
      const c = d.client || '—'
      porCliente.set(c, (porCliente.get(c) || 0) + v)
    }
    const clientes = [...porCliente.entries()]
      .map(([nome, val]) => ({ nome, val, pct: faturado ? val / faturado : 0 }))
      .sort((a, b) => b.val - a.val)
    return { clientes, nNotas, faturado, ticket: nNotas ? faturado / nNotas : 0, mesesComNota: porMes.filter(m => m.itens.length).length }
  }, [rows, anoSel, porMes])

  const mrr = useMemo(() => calcMRR(recorrencias), [recorrencias])

  // ── Gráfico de receita mês a mês ────────────────────────────────────
  useEffect(() => {
    if (!chartRef.current) return
    if (chartInst.current) { chartInst.current.destroy(); chartInst.current = null }
    chartInst.current = new Chart(chartRef.current, {
      type: 'line',
      data: {
        labels: MESES,
        datasets: [
          { label: 'Faturado', data: porMes.map(m => m.total), borderColor: 'rgba(204,145,94,1)', backgroundColor: 'rgba(204,145,94,0.10)', borderWidth: 2.5, tension: 0.35, fill: true, pointRadius: 4, pointBackgroundColor: 'rgba(204,145,94,1)', pointBorderColor: '#fff', pointBorderWidth: 1.5, pointHoverRadius: 6 },
          { label: 'Recebido', data: porMes.map(m => m.recebido), borderColor: 'rgba(39,174,96,1)', backgroundColor: 'transparent', borderWidth: 2, borderDash: [5, 3], tension: 0.35, fill: false, pointRadius: 3, pointBackgroundColor: 'rgba(39,174,96,1)', pointBorderColor: '#fff', pointBorderWidth: 1 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { font: { family: 'Montserrat', size: 11 }, color: '#00203E', padding: 14 } },
          tooltip: {
            callbacks: {
              title: items => `${MESES[items[0].dataIndex]}/${anoSel}`,
              label: () => '',
              afterBody: items => {
                const m = items[0].dataIndex
                const itens = porMes[m].itens.slice().sort((a, b) => b.value - a.value)
                if (!itens.length) return ['(sem faturamento neste mês)']
                const lines = itens.slice(0, 12).map(it => `• ${String(it.nome).slice(0, 26)}  ${fmtMoeda(it.value)}${(it.status || '').toLowerCase() === 'recebido' ? ' ✓' : ''}`)
                if (itens.length > 12) lines.push(`  … +${itens.length - 12} nota(s)`)
                lines.push('────────────')
                lines.push(`Total: ${fmtMoeda(porMes[m].total)}`)
                return lines
              },
            },
            titleFont: { family: 'Montserrat', weight: '600' }, bodyFont: { family: 'Montserrat', size: 11 }, padding: 12,
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { family: 'Montserrat', size: 11 }, color: '#5a6a7a' } },
          y: { beginAtZero: true, grid: { color: 'rgba(0,32,62,0.05)' }, ticks: { font: { family: 'Montserrat', size: 10 }, color: '#5a6a7a', callback: v => 'R$ ' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v) } },
        },
      },
    })
    return () => { if (chartInst.current) { chartInst.current.destroy(); chartInst.current = null } }
  }, [porMes, anoSel])

  function abrirNovo() { setEdicao(null); setModalOpen(true) }
  function abrirEdicao(row) { setEdicao(row); setModalOpen(true) }

  async function marcarLiquidado(row, e) {
    e?.stopPropagation()
    if (row.data?.status === 'Recebido') {
      showToast('Lançamento já está marcado como recebido.', 'info')
      return
    }
    const hoje = new Date().toISOString().slice(0, 10)
    const dataPag = prompt(`Data de recebimento (YYYY-MM-DD):`, hoje)
    if (!dataPag) return
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataPag)) {
      showToast('Data inválida. Use AAAA-MM-DD.', 'warning')
      return
    }
    const merged = { ...(row.data || {}), status: 'Recebido', data_pagamento: dataPag }
    const updates = { data: merged }
    if (!row.codigo) updates.codigo = await proximoCodigoReceivable() // provisão realizada direto ganha código
    const { error } = await supabase.from('receivable').update(updates).eq('id', row.id)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast(`Marcado como recebido.`, 'success')
    recarregar()
  }

  async function confirmarProvisao(row, e) {
    e?.stopPropagation()
    try {
      const codigo = await promoverProvisao(row, 'receivable')
      showToast(`Provisão confirmada (${codigo}) — agora é Pendente.`, 'success')
      recarregar()
    } catch (err) { showToast('Erro: ' + (err?.message || err), 'error') }
  }

  async function excluir(row, e) {
    e?.stopPropagation()
    const desc = row.data?.desc || row.codigo || 'este lançamento'
    if (!confirm(`Excluir "${desc}"?`)) return
    const { error } = await supabase.from('receivable').delete().eq('id', row.id)
    if (error) { showToast('Erro ao excluir: ' + error.message, 'error'); return }
    showToast('Lançamento excluído.', 'info')
    recarregar()
  }

  const colgroup = (
    <colgroup>
      <col style={{ width: 90 }} />
      <col />
      <col />
      <col style={{ width: 120 }} />
      <col style={{ width: 140 }} />
      <col />
      <col style={{ width: 110 }} />
      <col style={{ width: 70 }} />
    </colgroup>
  )
  const temDados = !loading && filtrados.length > 0

  return (
    <AppLayout
      title="Contas a Receber"
      stickyTop={(
        <>
          {/* Topo: chips + botão novo */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {[
                { key: '', label: 'Todos', color: 'var(--navy)', bg: 'rgba(0,32,62,0.06)' },
                { key: 'Provisão', label: 'Provisão', color: 'var(--navy-light)', bg: 'rgba(29,59,92,0.10)' },
                { key: 'Pendente', label: 'Pendente', color: 'var(--orange)', bg: 'rgba(230,126,34,0.10)' },
                { key: 'Recebido', label: 'Recebido', color: 'var(--green)', bg: 'rgba(39,174,96,0.10)' },
                { key: 'Atrasado', label: 'Atrasado', color: 'var(--red)', bg: 'rgba(231,76,60,0.10)' },
                { key: '__vencidos__', label: '⚠️ Vencidos', color: 'var(--red)', bg: 'rgba(231,76,60,0.10)' },
                { key: '__sem_doc__', label: '📎 NF pendente', color: 'var(--gold-dark)', bg: 'rgba(204,145,94,0.10)' },
                { key: '__doc_dispensado__', label: '✓ Doc dispensado', color: 'var(--navy)', bg: 'rgba(0,32,62,0.08)' },
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
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

          {/* Filtro por data: De/Até + seletor de tipo */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', padding: '10px 14px', background: 'var(--white)', borderRadius: 10, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)' }}>
            <input type="date" value={dataDe} onChange={e => setDataDe(e.target.value)} style={inputData} title="De" />
            <span style={{ fontSize: 11, color: 'var(--text-mid)' }}>até</span>
            <input type="date" value={dataAte} onChange={e => setDataAte(e.target.value)} style={inputData} title="Até" />
            {(dataDe || dataAte) && (
              <button onClick={() => { setDataDe(''); setDataAte('') }} style={{ background: 'none', border: 'none', color: 'var(--text-mid)', cursor: 'pointer', fontSize: 14, fontWeight: 700, padding: '4px 6px' }} title="Limpar período">×</button>
            )}
            <div style={{ width: 1, height: 22, background: 'var(--cream-dark)', margin: '0 4px' }} />
            <select value={tipoData} onChange={e => setTipoData(e.target.value)} style={selectTipoData} title="Tipo de data">
              <option value="due">Vencimento</option>
              <option value="data_pagamento">Pagamento</option>
              <option value="data_competencia">Competência</option>
            </select>
          </div>

          {/* Filtros avançados */}
          <FiltrosAvancados
            tipo="rec"
            filtros={filtrosAvancados}
            setFiltros={setFiltrosAvancados}
            expanded={filtrosExpanded}
            setExpanded={setFiltrosExpanded}
          />

        </>
      )}
    >
      {/* Faixa de KPIs + gráfico de receita mês a mês */}
      {temDados && (
        <>
          <div style={kpiStrip}>
            <Kpi label={`Faturado ${anoSel}`} valor={fmtMoeda(kpisRec.faturado)} cor="var(--navy)" />
            <Kpi label="Recebido" valor={fmtMoeda(kpisRec.recebido)} cor="var(--green)" />
            <Kpi label="A receber" valor={fmtMoeda(kpisRec.aReceber)} cor="var(--gold-dark)" />
            <Kpi label="Vencido" valor={fmtMoeda(kpisRec.vencido)} cor="var(--red)" />
            <Kpi label="Ticket médio" valor={fmtMoeda(analiseAno.ticket)} cor="var(--navy)" />
            <Kpi label={`Nº de notas ${anoSel}`} valor={String(analiseAno.nNotas)} cor="var(--navy)" />
            <Kpi label="MRR · recorrente/mês" valor={fmtMoeda(mrr)} cor="var(--gold-dark)" />
          </div>
          <div style={chartCard}>
            <div style={chartHeader}>
              <div>
                <div style={chartTitle}>Evolução da receita — {anoSel}</div>
                <div style={chartSub}>Passe o mouse num mês pra ver a composição · linha cobre = faturado · tracejado verde = recebido</div>
              </div>
              <select value={anoSel} onChange={e => setAnoSel(e.target.value)} style={anoSelect}>
                {anosDisponiveis.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div style={{ height: 260, position: 'relative' }}><canvas ref={chartRef} /></div>
          </div>

          {analiseAno.clientes.length > 0 && (
            <div style={{ ...chartCard, marginTop: 16 }}>
              <div style={chartTitle}>Concentração por cliente — {anoSel}</div>
              <div style={chartSub}>Quem representa cada fatia da sua receita {analiseAno.clientes[0].pct > 0.5 && <strong style={{ color: 'var(--red)' }}>· ⚠️ dependência alta do maior cliente</strong>}</div>
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {analiseAno.clientes.slice(0, 6).map(c => (
                  <div key={c.nome} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ flex: '0 0 210px', fontSize: 12, color: 'var(--navy)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.nome}>{c.nome}</div>
                    <div style={{ flex: 1, height: 16, background: 'var(--cream)', borderRadius: 999, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${Math.max(3, c.pct * 100)}%`, background: c.pct > 0.5 ? 'var(--red)' : 'linear-gradient(90deg, var(--gold), var(--gold-dark))', borderRadius: 999 }} />
                    </div>
                    <div style={{ flex: '0 0 130px', textAlign: 'right', fontSize: 12 }}>
                      <strong style={{ color: 'var(--navy)' }}>{(c.pct * 100).toFixed(1)}%</strong>
                      <span style={{ color: 'var(--text-mid)' }}> · {fmtMoeda(c.val)}</span>
                    </div>
                  </div>
                ))}
                {analiseAno.clientes.length > 6 && (
                  <div style={{ fontSize: 11, color: 'var(--text-mid)', marginTop: 2 }}>+ {analiseAno.clientes.length - 6} outro(s) cliente(s)</div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      <div style={{ ...tableWrap, marginTop: temDados ? 16 : 0 }}>
        {loading ? (
          <div style={emptyState}>Carregando…</div>
        ) : erro ? (
          <EstadoErro onRetry={recarregar} />
        ) : filtrados.length === 0 ? (
          <div style={emptyState}>
            {rows.length === 0 ? 'Nenhuma conta a receber cadastrada. Clique em "Nova conta" pra começar.' : 'Nenhum resultado para os filtros.'}
          </div>
        ) : (
          <table style={{ ...tbl, tableLayout: 'fixed' }}>
            {colgroup}
            <thead>
              <tr>
                <Th onClick={() => toggleSort('codigo')} active={sortCol === 'codigo'} dir={sortDir}>Cód.</Th>
                <Th onClick={() => toggleSort('client')} active={sortCol === 'client'} dir={sortDir}>Cliente</Th>
                <th style={th}>Descrição</th>
                <Th onClick={() => toggleSort('value')} active={sortCol === 'value'} dir={sortDir} align="right">Valor</Th>
                <Th onClick={() => toggleSort('due')} active={sortCol === 'due'} dir={sortDir}>Datas</Th>
                <Th onClick={() => toggleSort('cat')} active={sortCol === 'cat'} dir={sortDir}>Categoria</Th>
                <Th onClick={() => toggleSort('status')} active={sortCol === 'status'} dir={sortDir}>Status</Th>
                <th style={{ ...th, textAlign: 'center' }}></th>
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
                      {d.status === 'Provisão' && (
                        <button
                          onClick={e => confirmarProvisao(item, e)}
                          title="Confirmar provisão (vira Pendente — ex: NF emitida)"
                          style={{ ...btnExcluir, color: 'var(--gold)', fontSize: 15, fontWeight: 700 }}
                          aria-label="Confirmar provisão"
                        >⬆</button>
                      )}
                      <button
                        onClick={e => marcarLiquidado(item, e)}
                        title="Marcar como recebido"
                        style={{ ...btnExcluir, color: d.status === 'Recebido' ? 'var(--green)' : 'var(--text-mid)', fontSize: 14, fontWeight: 700 }}
                        disabled={d.status === 'Recebido'}
                        aria-label="Marcar como recebido"
                      >✓</button>
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
      style={{ ...th, cursor: 'pointer', userSelect: 'none', textAlign: align, width, color: active ? 'var(--gold-light)' : '#fff' }}
    >
      {children}
      <span style={{ fontSize: 9, marginLeft: 4, opacity: active ? 1 : 0.4 }}>{active && dir === 'asc' ? '▲' : '▼'}</span>
    </th>
  )
}

function Kpi({ label, valor, cor }) {
  return (
    <div style={{ background: 'var(--white)', borderRadius: 10, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)', padding: '12px 16px', borderTop: `3px solid ${cor}` }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-mid)', marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: cor, fontFamily: 'var(--body)' }}>{valor}</div>
    </div>
  )
}

// ─── styles ───────────────────────────────────────────────────────────────
const kpiStrip = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 14 }
const chartCard = { background: 'var(--white)', borderRadius: 12, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)', padding: 18, marginBottom: 4 }
const chartHeader = { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12, flexWrap: 'wrap' }
const chartTitle = { fontSize: 14, fontWeight: 600, color: 'var(--navy)', fontFamily: 'var(--body)' }
const chartSub = { fontSize: 11, color: 'var(--text-mid)', marginTop: 2 }
const anoSelect = { padding: '7px 10px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 12, color: 'var(--navy)', background: 'var(--white)', outline: 'none', cursor: 'pointer' }
const inputData = { padding: '7px 10px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 12, color: 'var(--navy)', background: 'var(--white)', outline: 'none' }
const selectTipoData = { padding: '7px 28px 7px 10px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 12, color: 'var(--navy)', background: 'var(--white)', outline: 'none', cursor: 'pointer', appearance: 'none', backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path d='M1 1l4 4 4-4' stroke='%2300203E' stroke-width='1.5' fill='none'/></svg>\")", backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center' }
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
  color: '#fff', textTransform: 'uppercase',
  background: 'var(--navy)',
  borderBottom: '2px solid var(--gold)',
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
