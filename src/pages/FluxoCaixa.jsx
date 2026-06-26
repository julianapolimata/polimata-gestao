import { useEffect, useMemo, useRef, useState } from 'react'
import { Chart } from 'chart.js/auto'
import AppLayout from '../components/AppLayout'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { fmtMoney, flatten, calcularProjecaoFutura } from '../lib/finance'
import FluxoMatricial from './components/FluxoMatricial'

// =====================================================================
// FLUXO DE CAIXA — replica fielmente renderCashflow() do legado.
// 3 cards (Entradas/Saídas/Saldo) + seletor Ano + seletor Modo
// (Realizado / Projetado +3/+6/+12 / Ambos) + toggle Cascata/Barras
// Gráfico Chart.js: cascata custom (plugin) ou barras agrupadas.
// Tabela mês a mês com acumulado, em ordem reversa.
// =====================================================================

const MES_CURTO = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

export default function FluxoCaixa() {
  const { user } = useAuth()
  const [receivable, setReceivable] = useState([])
  const [payable, setPayable] = useState([])
  const [contracts, setContracts] = useState([])
  const [loading, setLoading] = useState(true)
  const [modo, setModo] = useState('projetado_6')
  const [tipoChart, setTipoChart] = useState('waterfall')
  const [viewMode, setViewMode] = useState('grafico')
  const [ano, setAno] = useState(String(new Date().getFullYear()))
  const canvasRef = useRef(null)
  const chartRef = useRef(null)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    setLoading(true)
    Promise.all([
      supabase.from('receivable').select('id,codigo,data,created_at,updated_at,anexo_path'),
      supabase.from('payable').select('id,codigo,data,created_at,updated_at,anexo_path'),
      supabase.from('contracts').select('id,codigo,data,created_at,updated_at'),
    ]).then(([rRec, rPay, rCon]) => {
      if (cancelled) return
      setReceivable((rRec.data || []).map(flatten))
      setPayable((rPay.data || []).map(flatten))
      setContracts((rCon.data || []).map(flatten))
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [user])

  // ── Anos disponíveis ─────────────────────────────────────────────────
  const anosDisponiveis = useMemo(() => {
    const todas = [...receivable.map(r => r.due || r.created), ...payable.map(r => r.due || r.created)].filter(Boolean)
    const set = new Set(todas.map(d => d.substring(0, 4)))
    if (!set.size) set.add(String(new Date().getFullYear()))
    return [...set].sort().reverse()
  }, [receivable, payable])

  useEffect(() => {
    if (anosDisponiveis.length && !anosDisponiveis.includes(ano)) setAno(anosDisponiveis[0])
  }, [anosDisponiveis, ano])

  // ── Totais cards ─────────────────────────────────────────────────────
  const totals = useMemo(() => {
    const totalIn = receivable.reduce((a, r) => a + r.value, 0)
    const totalOut = payable.reduce((a, r) => a + r.value, 0)
    return { totalIn, totalOut, balance: totalIn - totalOut }
  }, [receivable, payable])

  // ── Série mensal ─────────────────────────────────────────────────────
  const serie = useMemo(() => {
    const entriesByMonth = new Array(12).fill(0)
    const saidasByMonth = new Array(12).fill(0)
    receivable.forEach(r => {
      // Regime caixa: usa data_pagamento (quando o dinheiro entrou de fato).
      // Fallback pro vencimento se ainda não pago, e pra created como último recurso.
      const d = r.data?.data_pagamento || r.due || r.created
      if (!d || !d.startsWith(ano)) return
      const m = parseInt(d.substring(5, 7), 10) - 1
      if (m >= 0 && m < 12) entriesByMonth[m] += r.value
    })
    payable.forEach(r => {
      const d = r.data?.data_pagamento || r.due || r.created
      if (!d || !d.startsWith(ano)) return
      const m = parseInt(d.substring(5, 7), 10) - 1
      if (m >= 0 && m < 12) saidasByMonth[m] += r.value
    })
    const curMonth = String(new Date().getFullYear()) === ano ? new Date().getMonth() : 11
    let labels, dataIn, dataOut
    if (modo === 'realizado') {
      labels = MES_CURTO.slice(0, curMonth + 1)
      dataIn = entriesByMonth.slice(0, curMonth + 1)
      dataOut = saidasByMonth.slice(0, curMonth + 1)
    } else if (modo === 'ambos') {
      const proj = calcularProjecaoFutura(6, { receivable, payable, contracts })
      labels = [
        ...MES_CURTO.slice(0, curMonth + 1).map(m => `${m}/${ano.slice(2)} ✓`),
        ...proj.labels.map(l => `${l} →`),
      ]
      dataIn = [...entriesByMonth.slice(0, curMonth + 1), ...proj.entradas]
      dataOut = [...saidasByMonth.slice(0, curMonth + 1), ...proj.saidas]
    } else {
      const n = { projetado_3: 3, projetado_6: 6, projetado_12: 12 }[modo] || 6
      const proj = calcularProjecaoFutura(n, { receivable, payable, contracts })
      labels = proj.labels
      dataIn = proj.entradas
      dataOut = proj.saidas
    }
    const dataSaldo = dataIn.map((e, i) => e - dataOut[i])
    return { labels, dataIn, dataOut, dataSaldo }
  }, [receivable, payable, contracts, ano, modo])

  // ── Chart.js render ──────────────────────────────────────────────────
  useEffect(() => {
    if (!canvasRef.current) return
    if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null }
    const { labels, dataIn, dataOut, dataSaldo } = serie
    if (!labels.length) return

    if (tipoChart === 'bar') {
      chartRef.current = new Chart(canvasRef.current.getContext('2d'), {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label: 'Entradas', data: dataIn, backgroundColor: 'rgba(39,174,96,0.75)', borderColor: 'rgba(39,174,96,1)', borderWidth: 1.5, borderRadius: 4 },
            { label: 'Saídas', data: dataOut, backgroundColor: 'rgba(231,76,60,0.75)', borderColor: 'rgba(231,76,60,1)', borderWidth: 1.5, borderRadius: 4 },
            { label: 'Saldo', data: dataSaldo,
              backgroundColor: dataSaldo.map(v => v >= 0 ? 'rgba(204,145,94,0.85)' : 'rgba(231,76,60,0.4)'),
              borderColor: dataSaldo.map(v => v >= 0 ? 'rgba(204,145,94,1)' : 'rgba(231,76,60,1)'),
              borderWidth: 1.5, borderRadius: 4 },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { position: 'top', labels: { font: { family: 'Montserrat', size: 11 }, color: '#00203E', padding: 16 } },
            tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${fmtMoney(c.raw)}` } },
          },
          scales: {
            x: { grid: { display: false }, ticks: { font: { family: 'Montserrat', size: 11 }, color: '#44515e' } },
            y: { grid: { color: 'rgba(0,32,62,0.05)' }, ticks: { font: { family: 'Montserrat', size: 10 }, color: '#44515e', callback: v => 'R$ ' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v.toFixed(0)) } },
          },
        },
      })
    } else {
      // Cascata (waterfall) — plugin custom
      const floatData = []
      const barColors = []
      const acumulado = []
      let running = 0
      dataSaldo.forEach((s, i) => {
        const bottom = running
        const top = running + s
        floatData.push({ x: labels[i], bottom, top, value: s })
        barColors.push(s >= 0 ? 'rgba(39,174,96,0.82)' : 'rgba(231,76,60,0.82)')
        running = top
        acumulado.push(running)
      })

      const waterfallPlugin = {
        id: 'waterfall',
        beforeDatasetsDraw(chart) {
          const { ctx, scales: { x, y } } = chart
          ctx.save()
          floatData.forEach((d, i) => {
            const xCenter = x.getPixelForValue(d.x)
            const barW = x.width / (labels.length * 2.2)
            const yTop = y.getPixelForValue(d.top)
            const yBot = y.getPixelForValue(d.bottom)
            const h = Math.abs(yBot - yTop)
            const barH = Math.max(h, 2)
            const bx = xCenter - barW / 2
            const by = d.value >= 0 ? yTop : yBot
            ctx.fillStyle = barColors[i]
            ctx.beginPath()
            if (ctx.roundRect) ctx.roundRect(bx, by, barW, barH, [4, 4, 0, 0])
            else ctx.rect(bx, by, barW, barH)
            ctx.fill()
            ctx.strokeStyle = d.value >= 0 ? 'rgba(39,174,96,1)' : 'rgba(231,76,60,1)'
            ctx.lineWidth = 1.5
            ctx.stroke()

            ctx.fillStyle = '#00203E'
            ctx.font = '600 10px Montserrat, sans-serif'
            ctx.textAlign = 'center'
            const labelY = d.value >= 0 ? yTop - 6 : yBot + 14
            const absVal = Math.abs(d.value)
            const lbl = absVal >= 1000 ? 'R$' + (absVal / 1000).toFixed(1) + 'k' : 'R$' + absVal.toFixed(0)
            ctx.fillText(lbl, xCenter, labelY)

            if (i < floatData.length - 1) {
              const xNext = x.getPixelForValue(floatData[i + 1].x) - barW / 2 - 2
              const xEnd = xCenter + barW / 2 + 2
              const yConn = y.getPixelForValue(d.top)
              ctx.strokeStyle = 'rgba(90,106,122,0.35)'
              ctx.lineWidth = 1
              ctx.setLineDash([4, 3])
              ctx.beginPath(); ctx.moveTo(xEnd, yConn); ctx.lineTo(xNext, yConn); ctx.stroke()
              ctx.setLineDash([])
            }
          })
          const y0 = y.getPixelForValue(0)
          ctx.strokeStyle = 'rgba(0,32,62,0.18)'
          ctx.lineWidth = 1.5
          ctx.setLineDash([])
          ctx.beginPath(); ctx.moveTo(x.left, y0); ctx.lineTo(x.right, y0); ctx.stroke()
          ctx.restore()
        },
      }

      const allVals = floatData.map(d => d.bottom).concat(floatData.map(d => d.top))
      const minVal = Math.min(...allVals, 0)
      const maxVal = Math.max(...allVals, 0)
      const padding = (maxVal - minVal) * 0.18 || 500

      chartRef.current = new Chart(canvasRef.current.getContext('2d'), {
        type: 'line',
        plugins: [waterfallPlugin],
        data: {
          labels,
          datasets: [
            {
              label: 'Saldo Acumulado',
              data: acumulado,
              borderColor: 'rgba(204,145,94,1)',
              backgroundColor: 'transparent',
              borderWidth: 2,
              borderDash: [6, 3],
              pointRadius: 4,
              pointBackgroundColor: acumulado.map(v => v >= 0 ? 'rgba(204,145,94,1)' : 'rgba(231,76,60,1)'),
              pointBorderColor: '#fff',
              pointBorderWidth: 1.5,
              tension: 0.35,
              order: 1,
            },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          animation: { duration: 600, easing: 'easeOutQuart' },
          plugins: {
            legend: {
              position: 'top',
              labels: {
                font: { family: 'Montserrat', size: 11 }, color: '#00203E', padding: 16,
                generateLabels: () => [
                  { text: '▮  Mês positivo', fillStyle: 'rgba(39,174,96,0.82)', strokeStyle: 'rgba(39,174,96,1)', lineWidth: 1.5, fontColor: '#00203E' },
                  { text: '▮  Mês negativo', fillStyle: 'rgba(231,76,60,0.82)', strokeStyle: 'rgba(231,76,60,1)', lineWidth: 1.5, fontColor: '#00203E' },
                  { text: '╌  Saldo acumulado', fillStyle: 'rgba(204,145,94,0)', strokeStyle: 'rgba(204,145,94,1)', lineWidth: 2, fontColor: '#00203E', lineDash: [6, 3] },
                ],
              },
            },
            tooltip: {
              callbacks: {
                label: ctx => {
                  const i = ctx.dataIndex
                  const e = dataIn[i] || 0, s = dataOut[i] || 0, sal = dataSaldo[i] || 0, ac = acumulado[i] || 0
                  return [
                    ` Entradas: ${fmtMoney(e)}`,
                    ` Saídas:   ${fmtMoney(s)}`,
                    ` Saldo mês: ${sal >= 0 ? '+' : ''}${fmtMoney(sal)}`,
                    ` Acumulado: ${fmtMoney(ac)}`,
                  ]
                },
                title: ctx => `${ctx[0].label} / ${ano}`,
              },
              titleFont: { family: 'Montserrat', weight: '600' },
              bodyFont: { family: 'Montserrat', size: 11 },
              padding: 12,
            },
          },
          scales: {
            x: { grid: { display: false }, ticks: { font: { family: 'Montserrat', size: 11 }, color: '#44515e' } },
            y: {
              min: minVal - padding, max: maxVal + padding,
              grid: { color: 'rgba(0,32,62,0.05)' },
              ticks: {
                font: { family: 'Montserrat', size: 10 }, color: '#44515e',
                callback: v => {
                  const abs = Math.abs(v)
                  const fmtted = abs >= 1000 ? (abs / 1000).toFixed(0) + 'k' : abs.toFixed(0)
                  return 'R$ ' + (v < 0 ? '-' : '') + fmtted
                },
              },
            },
          },
        },
      })
    }
    return () => {
      if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null }
    }
  }, [serie, tipoChart, ano])

  if (loading) {
    return (
      <AppLayout title="Fluxo de Caixa">
        <div style={emptyState}>Carregando…</div>
      </AppLayout>
    )
  }

  const semDados = !serie.dataIn.some(v => v > 0) && !serie.dataOut.some(v => v > 0)

  return (
    <AppLayout title="Fluxo de Caixa">
      {/* Tabs */}
      <div style={tabsBar}>
        <button onClick={() => setViewMode('grafico')} style={viewMode === 'grafico' ? tabActive : tabInactive}>Gráfico</button>
        <button onClick={() => setViewMode('matricial')} style={viewMode === 'matricial' ? tabActive : tabInactive}>Matricial (Real × Projetado)</button>
      </div>

      {viewMode === 'matricial' && (
        <FluxoMatricial receivable={receivable} payable={payable} anosDisponiveis={anosDisponiveis} />
      )}

      {viewMode === 'grafico' && (<>
      {/* Cards de resumo */}
      <div style={kpiGrid}>
        <StatCard color="green" label="Entradas" value={fmtMoney(totals.totalIn)} sub="Total recebido + a receber" />
        <StatCard color="red" label="Saídas" value={fmtMoney(totals.totalOut)} sub="Total pago + a pagar" />
        <StatCard
          color="gold"
          label="Saldo"
          value={fmtMoney(totals.balance)}
          valueColor={totals.balance >= 0 ? 'var(--green)' : 'var(--red)'}
          sub="Entradas − Saídas"
        />
      </div>

      {/* Card do gráfico */}
      <div style={chartCard}>
        <div style={chartHeader}>
          <div style={chartTitle}>Fluxo Mensal</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={ano} onChange={e => setAno(e.target.value)} style={selectStyle}>
              {anosDisponiveis.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <select value={modo} onChange={e => setModo(e.target.value)} style={selectStyle}>
              <option value="realizado">Realizado</option>
              <option value="projetado_3">Projeção +3 meses</option>
              <option value="projetado_6">Projeção +6 meses</option>
              <option value="projetado_12">Projeção +12 meses</option>
              <option value="ambos">Realizado + Projetado</option>
            </select>
            <div style={toggleWrap}>
              <button
                onClick={() => setTipoChart('waterfall')}
                style={tipoChart === 'waterfall' ? toggleActive : toggleInactive}
              >Cascata</button>
              <button
                onClick={() => setTipoChart('bar')}
                style={tipoChart === 'bar' ? toggleActive : toggleInactive}
              >Barras</button>
            </div>
          </div>
        </div>
        <div style={{ padding: '20px 20px 16px' }}>
          <div style={{ position: 'relative', height: 340 }}>
            <canvas ref={canvasRef} />
          </div>
        </div>
      </div>

      {/* Tabela mensal */}
      <div style={{ ...chartCard, marginTop: 20 }}>
        <div style={chartHeader}>
          <div style={chartTitle}>Resumo por Mês</div>
        </div>
        <div style={{ overflowX: 'visible' }}>
          <table style={tbl}>
            <thead>
              <tr>
                <th style={th}>Mês</th>
                <th style={{ ...th, textAlign: 'right' }}>Entradas</th>
                <th style={{ ...th, textAlign: 'right' }}>Saídas</th>
                <th style={{ ...th, textAlign: 'right' }}>Saldo Mensal</th>
                <th style={{ ...th, textAlign: 'right' }}>Saldo Acumulado</th>
              </tr>
            </thead>
            <tbody>
              {semDados ? (
                <tr><td colSpan={5} style={emptyRow}>Nenhum lançamento em {ano}.</td></tr>
              ) : (
                buildTableRows(serie, ano).map(row => (
                  <tr key={row.key} style={{ borderBottom: '1px solid var(--cream-dark)' }}>
                    <td style={{ ...td, fontWeight: 600 }}>{row.mes}</td>
                    <td style={{ ...td, textAlign: 'right', color: row.entradas > 0 ? 'var(--green)' : 'var(--text-mid)' }}>
                      {row.entradas > 0 ? fmtMoney(row.entradas) : '—'}
                    </td>
                    <td style={{ ...td, textAlign: 'right', color: row.saidas > 0 ? 'var(--red)' : 'var(--text-mid)' }}>
                      {row.saidas > 0 ? fmtMoney(row.saidas) : '—'}
                    </td>
                    <td style={{ ...td, textAlign: 'right', color: row.saldo >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
                      {(row.saldo >= 0 ? '+' : '') + fmtMoney(row.saldo)}
                    </td>
                    <td style={{ ...td, textAlign: 'right', color: row.acum >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>
                      {fmtMoney(row.acum)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      </>)}
    </AppLayout>
  )
}

function buildTableRows(serie, ano) {
  let acum = 0
  const rows = serie.labels.map((mes, i) => {
    acum += serie.dataSaldo[i]
    return {
      key: `${mes}-${i}`,
      mes: mes.includes('/') ? mes : `${mes}/${ano}`,
      entradas: serie.dataIn[i],
      saidas: serie.dataOut[i],
      saldo: serie.dataSaldo[i],
      acum,
    }
  })
  return rows.reverse()
}

function StatCard({ color, label, value, valueColor, sub }) {
  const borders = { green: 'var(--green)', red: 'var(--red)', gold: 'var(--gold)' }
  return (
    <div style={{ ...kpiCard, borderTop: `3px solid ${borders[color] || 'var(--gold)'}` }}>
      <div style={kpiLabel}>{label}</div>
      <div style={{ ...kpiBigVal, color: valueColor || borders[color] || 'var(--navy)' }}>{value}</div>
      <div style={kpiSub}>{sub}</div>
    </div>
  )
}

// ─── styles ──────────────────────────────────────────────────────────────────
const tabsBar = { display: 'flex', gap: 4, marginBottom: 18, background: 'var(--cream)', padding: 4, borderRadius: 8, width: 'fit-content' }
const tabBase = { border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 11, fontWeight: 700, letterSpacing: 0.6, cursor: 'pointer', fontFamily: 'var(--body)', textTransform: 'uppercase' }
const tabActive = { ...tabBase, background: 'var(--navy)', color: '#fff' }
const tabInactive = { ...tabBase, background: 'transparent', color: 'var(--text-mid)' }
const emptyState = { padding: '60px 24px', textAlign: 'center', fontFamily: 'var(--body)', color: 'var(--text-mid)', fontSize: 13 }
const emptyRow = { padding: '40px 16px', textAlign: 'center', color: 'var(--text-mid)', fontStyle: 'italic', fontSize: 12 }

const kpiGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, marginBottom: 24 }
const kpiCard = { background: 'var(--white)', borderRadius: 12, padding: 24, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)' }
const kpiLabel = { fontSize: 10, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--text-mid)', marginBottom: 10, fontFamily: 'var(--body)' }
const kpiBigVal = { fontSize: 32, fontWeight: 700, lineHeight: 1, fontFamily: 'var(--body)' }
const kpiSub = { fontSize: 11, color: 'var(--text-mid)', marginTop: 8 }

const chartCard = { background: 'var(--white)', borderRadius: 12, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)', overflow: 'hidden' }
const chartHeader = { padding: '18px 24px 14px', borderBottom: '1px solid var(--cream-dark)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }
const chartTitle = { fontSize: 14, fontWeight: 600, color: 'var(--navy)', fontFamily: 'var(--body)' }

const selectStyle = {
  fontFamily: 'var(--body)', fontSize: 11, padding: '6px 10px',
  border: '1.5px solid var(--cream-dark)', borderRadius: 6,
  background: 'var(--white)', color: 'var(--navy)', cursor: 'pointer', outline: 'none',
}
const toggleWrap = { display: 'flex', gap: 4, background: 'var(--cream)', borderRadius: 6, padding: 3 }
const toggleBtnBase = {
  border: 'none', borderRadius: 4, padding: '5px 12px',
  fontSize: 10, fontWeight: 600, letterSpacing: 1, cursor: 'pointer',
  fontFamily: 'var(--body)', textTransform: 'uppercase',
}
const toggleActive = { ...toggleBtnBase, background: 'var(--navy)', color: '#fff' }
const toggleInactive = { ...toggleBtnBase, background: 'transparent', color: 'var(--text-mid)' }

const tbl = { width: '100%', fontSize: 12, borderCollapse: 'collapse', fontFamily: 'var(--body)' }
const th = {
  textAlign: 'left', padding: '12px 14px',
  fontSize: 9, fontWeight: 700, letterSpacing: 1.5, color: '#fff',
  textTransform: 'uppercase', background: 'var(--navy)',
  borderBottom: '2px solid var(--gold)',
}
const td = { padding: '12px 14px', fontSize: 12, color: 'var(--navy)' }
