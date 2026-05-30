import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Chart } from 'chart.js/auto'
import AppLayout from '../components/AppLayout'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import {
  fmtMoney, flatten, isOverdue, getDocStatus, inMonth, monthLabels,
} from '../lib/finance'

// =====================================================================
// PAINEL FINANCEIRO — replica fielmente o renderDashboard() do legado.
// 3 KPIs: Contratos Ativos | Caixa Atual | ICC (Cobertura de Caixa)
// Banner de alertas (vencidos + NF pendente).
// Gráfico Chart.js misto: barras (entradas/saídas) + linha (saldo acumulado),
// com cores saturadas pra meses realizados e claras pra projetados.
// Tabela mês a mês com status (Realizado / Em curso / Projetado).
// =====================================================================

export default function Dashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [receivable, setReceivable] = useState([])
  const [payable, setPayable] = useState([])
  const [contracts, setContracts] = useState([])
  const [loading, setLoading] = useState(true)
  const canvasRef = useRef(null)
  const chartRef = useRef(null)

  // Carrega receivable + payable + contracts em paralelo
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

  // ── Alertas ──────────────────────────────────────────────────────────
  const alerts = useMemo(() => {
    const out = []
    const overdueRec = receivable.filter(r => r.status !== 'Recebido' && isOverdue(r.due))
    const overduePay = payable.filter(r => r.status !== 'Pago' && isOverdue(r.due))
    if (overdueRec.length) {
      out.push({
        kind: 'danger',
        text: `⚠️ ${overdueRec.length} recebível(is) vencido(s) — ${fmtMoney(overdueRec.reduce((a, r) => a + r.value, 0))}`,
      })
    }
    if (overduePay.length) {
      out.push({
        kind: 'danger',
        text: `🔴 ${overduePay.length} pagamento(s) em atraso — ${fmtMoney(overduePay.reduce((a, r) => a + r.value, 0))}`,
      })
    }
    const semDoc = [
      ...receivable.filter(r => getDocStatus(r) === 'pendente'),
      ...payable.filter(r => getDocStatus(r) === 'pendente'),
    ]
    if (semDoc.length) {
      out.push({
        kind: 'warning',
        text: `📎 ${semDoc.length} lançamento(s) com NF pendente — ${fmtMoney(semDoc.reduce((a, r) => a + r.value, 0))} (atenção contábil)`,
      })
    }
    return out
  }, [receivable, payable])

  // ── KPI 1: Contratos Ativos ──────────────────────────────────────────
  const kpiContratos = useMemo(() => {
    const ativos = contracts.filter(c => {
      const s = (c.data?.status || '').toLowerCase()
      return s === 'ativo' || s === 'em vigor' || s === 'vigente' || (!c.data?.status && c.value)
    })
    const total = ativos.reduce((a, c) => a + Number(c.data?.value || c.value || 0), 0)
    return { qtd: ativos.length, total }
  }, [contracts])

  // ── KPI 2: Caixa Atual ───────────────────────────────────────────────
  const kpiCaixa = useMemo(() => {
    const totalRecebido = receivable.filter(r => r.status === 'Recebido').reduce((a, r) => a + r.value, 0)
    const totalPago = payable.filter(r => r.status === 'Pago').reduce((a, r) => a + r.value, 0)
    return { recebido: totalRecebido, pago: totalPago, atual: totalRecebido - totalPago }
  }, [receivable, payable])

  // ── KPI 3: ICC (Cobertura de Caixa) ──────────────────────────────────
  const kpiIcc = useMemo(() => {
    const hoje = new Date()
    const tresMesesAtras = new Date(hoje.getFullYear(), hoje.getMonth() - 3, hoje.getDate())
    const despUltimos3 = payable.filter(r => {
      if (r.status !== 'Pago') return false
      const ref = r.due || r.created || hoje.toISOString().split('T')[0]
      const d = new Date(ref + 'T12:00:00')
      return d >= tresMesesAtras
    }).reduce((a, r) => a + r.value, 0)
    const fixaMensal = despUltimos3 / 3
    const caixa = kpiCaixa.atual
    if (caixa < 0) {
      return { texto: 'Negativo', cor: 'var(--red)', sub: `caixa em déficit · ${fmtMoney(caixa)}` }
    }
    if (fixaMensal <= 0) {
      return { texto: '—', cor: 'var(--text-mid)', sub: 'sem despesas pagas pra calcular' }
    }
    const meses = caixa / fixaMensal
    if (meses > 24) {
      return { texto: '24+ meses', cor: 'var(--green)', sub: `caixa ${fmtMoney(caixa)} ÷ ${fmtMoney(fixaMensal)}/mês` }
    }
    const cor = meses >= 6 ? 'var(--green)' : (meses >= 3 ? 'var(--orange)' : 'var(--red)')
    return { texto: `${meses.toFixed(1)} meses`, cor, sub: `caixa ${fmtMoney(caixa)} ÷ ${fmtMoney(fixaMensal)}/mês` }
  }, [payable, kpiCaixa])

  // ── Série mensal (jan-dez do ano corrente) ───────────────────────────
  const dadosMensais = useMemo(() => {
    const hoje = new Date()
    const ano = hoje.getFullYear()
    const mesAtual = hoje.getMonth()
    const labels = monthLabels(ano)
    let acum = 0
    return labels.map((label, m) => {
      const futuro = m > mesAtual
      const atual = m === mesAtual
      let entradas, saidas
      if (futuro) {
        entradas = receivable
          .filter(r => r.status !== 'Recebido' && inMonth(r.due, ano, m))
          .reduce((a, r) => a + r.value, 0)
        saidas = payable
          .filter(r => r.status !== 'Pago' && inMonth(r.due, ano, m))
          .reduce((a, r) => a + r.value, 0)
      } else {
        entradas = receivable
          .filter(r => r.status === 'Recebido' && inMonth(r.due || r.created, ano, m))
          .reduce((a, r) => a + r.value, 0)
        saidas = payable
          .filter(r => r.status === 'Pago' && inMonth(r.due || r.created, ano, m))
          .reduce((a, r) => a + r.value, 0)
      }
      const saldoMes = entradas - saidas
      acum += saldoMes
      return { label, mes: m, futuro, atual, entradas, saidas, saldoMes, saldoAcum: acum }
    })
  }, [receivable, payable])

  // ── Chart.js render ──────────────────────────────────────────────────
  useEffect(() => {
    if (!canvasRef.current || dadosMensais.length === 0) return
    if (chartRef.current) {
      chartRef.current.destroy()
      chartRef.current = null
    }
    const labels = dadosMensais.map(d => d.label.charAt(0).toUpperCase() + d.label.slice(1))
    const corEntrada = d => d.futuro ? 'rgba(39,174,96,0.35)' : 'rgba(39,174,96,0.85)'
    const corSaida = d => d.futuro ? 'rgba(204,145,94,0.35)' : 'rgba(204,145,94,0.85)'
    chartRef.current = new Chart(canvasRef.current, {
      data: {
        labels,
        datasets: [
          {
            type: 'bar',
            label: 'Entradas',
            data: dadosMensais.map(d => d.entradas),
            backgroundColor: dadosMensais.map(corEntrada),
            borderColor: 'rgba(39,174,96,1)',
            borderWidth: 1,
            order: 2,
          },
          {
            type: 'bar',
            label: 'Saídas',
            data: dadosMensais.map(d => d.saidas),
            backgroundColor: dadosMensais.map(corSaida),
            borderColor: 'rgba(204,145,94,1)',
            borderWidth: 1,
            order: 2,
          },
          {
            type: 'line',
            label: 'Saldo Acumulado',
            data: dadosMensais.map(d => d.saldoAcum),
            borderColor: 'rgba(0,32,62,1)',
            backgroundColor: 'rgba(0,32,62,0.05)',
            borderWidth: 2.5,
            tension: 0.3,
            pointRadius: 4,
            pointBackgroundColor: dadosMensais.map(d => d.futuro ? 'rgba(0,32,62,0.4)' : 'rgba(0,32,62,1)'),
            pointBorderColor: 'rgba(0,32,62,1)',
            pointBorderWidth: 1.5,
            fill: false,
            order: 1,
            segment: {
              borderDash: ctx => {
                const i = ctx.p1DataIndex
                return (dadosMensais[i] && dadosMensais[i].futuro) ? [6, 4] : undefined
              },
            },
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => {
                const v = ctx.parsed.y
                return `${ctx.dataset.label}: R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              },
            },
          },
        },
        scales: {
          y: {
            ticks: { callback: v => 'R$ ' + (v / 1000).toFixed(1) + 'k', font: { size: 10 } },
            grid: { color: 'rgba(0,0,0,0.05)' },
          },
          x: {
            ticks: { font: { size: 11 } },
            grid: { display: false },
          },
        },
      },
    })
    return () => {
      if (chartRef.current) {
        chartRef.current.destroy()
        chartRef.current = null
      }
    }
  }, [dadosMensais])

  // ── Render ───────────────────────────────────────────────────────────
  if (loading) {
    return (
      <AppLayout title="Painel Financeiro">
        <div style={emptyState}>Carregando…</div>
      </AppLayout>
    )
  }

  return (
    <AppLayout title="Painel Financeiro">
      {/* Banner de alertas */}
      {alerts.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          {alerts.map((a, i) => (
            <div key={i} style={a.kind === 'danger' ? alertDanger : alertWarning}>
              {a.text}
            </div>
          ))}
        </div>
      )}

      {/* 3 KPIs essenciais */}
      <div style={kpiGrid}>
        <div
          style={{ ...kpiCard, borderTop: '3px solid var(--gold)', cursor: 'pointer' }}
          onClick={() => navigate('/contratos')}
          role="button"
          tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter') navigate('/contratos') }}
        >
          <div style={kpiLabel}>Contratos Ativos</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <div style={kpiNum}>{kpiContratos.qtd}</div>
            <div style={kpiUnit}>contrato(s)</div>
          </div>
          <div style={kpiSubGold}>{fmtMoney(kpiContratos.total)} em valor total</div>
        </div>

        <div style={{ ...kpiCard, borderTop: '3px solid var(--green)' }}>
          <div style={kpiLabel}>Caixa Atual</div>
          <div style={{ ...kpiBigVal, color: kpiCaixa.atual >= 0 ? 'var(--green)' : 'var(--red)' }}>
            {fmtMoney(kpiCaixa.atual)}
          </div>
          <div style={kpiSub}>
            {fmtMoney(kpiCaixa.recebido)} recebido − {fmtMoney(kpiCaixa.pago)} pago
          </div>
        </div>

        <div style={{ ...kpiCard, borderTop: `3px solid ${kpiIcc.cor}` }}>
          <div style={kpiLabel}>ICC · Cobertura de Caixa</div>
          <div style={{ ...kpiBigVal, color: kpiIcc.cor }}>{kpiIcc.texto}</div>
          <div style={kpiSub}>{kpiIcc.sub}</div>
        </div>
      </div>

      {/* Gráfico Evolução do Caixa */}
      <div style={chartCard}>
        <div style={chartHeader}>
          <div>
            <div style={chartTitle}>Evolução do Caixa</div>
            <div style={chartSubtitle}>
              Janeiro a dezembro do ano corrente · barras saturadas = realizado · barras claras = projetado
            </div>
          </div>
          <div style={legendWrap}>
            <span style={legendItem}><span style={{ ...swatch, background: 'rgba(39,174,96,0.85)' }} />Entradas</span>
            <span style={legendItem}><span style={{ ...swatch, background: 'rgba(204,145,94,0.85)' }} />Saídas</span>
            <span style={legendItem}><span style={{ ...swatchLine, background: 'var(--navy)' }} />Saldo Acumulado</span>
            <span style={{ ...legendItem, fontStyle: 'italic', color: 'var(--text-mid)' }}>· cores claras = projetado</span>
          </div>
        </div>
        <div style={{ height: 280, position: 'relative' }}>
          <canvas ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }} />
        </div>
      </div>

      {/* Tabela mês a mês */}
      <div style={tableCard}>
        <div style={tableHeader}>
          <div style={chartTitle}>Mês a Mês</div>
          <div style={chartSubtitle}>Entradas, saídas e saldo mês a mês</div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={tbl}>
            <thead>
              <tr style={{ background: 'var(--navy)', color: '#fff' }}>
                <th style={{ ...thBase, textAlign: 'left' }}>Mês</th>
                <th style={{ ...thBase, textAlign: 'right' }}>Entradas</th>
                <th style={{ ...thBase, textAlign: 'right' }}>Saídas</th>
                <th style={{ ...thBase, textAlign: 'right' }}>Saldo do Mês</th>
                <th style={{ ...thBase, textAlign: 'right' }}>Saldo Acumulado</th>
                <th style={{ ...thBase, textAlign: 'center' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {dadosMensais.map(d => {
                const labelPretty = d.label.charAt(0).toUpperCase() + d.label.slice(1)
                const corSaldo = d.saldoMes >= 0 ? 'var(--green)' : 'var(--red)'
                const corAcum = d.saldoAcum >= 0 ? 'var(--green)' : 'var(--red)'
                let badge
                if (d.futuro) badge = <Badge bg="rgba(204,145,94,0.15)" color="var(--gold-dark)">Projetado</Badge>
                else if (d.atual) badge = <Badge bg="rgba(0,32,62,0.10)" color="var(--navy)">Em curso</Badge>
                else badge = <Badge bg="rgba(39,174,96,0.12)" color="var(--green)">Realizado</Badge>
                return (
                  <tr key={d.mes} style={{
                    borderBottom: '1px solid var(--cream-dark)',
                    background: d.atual ? 'rgba(204,145,94,0.04)' : 'transparent',
                  }}>
                    <td style={{ ...td, fontWeight: 600, color: 'var(--navy)' }}>{labelPretty}</td>
                    <td style={{ ...td, textAlign: 'right', color: d.entradas > 0 ? 'var(--green)' : 'var(--text-mid)' }}>
                      {fmtMoney(d.entradas)}
                    </td>
                    <td style={{ ...td, textAlign: 'right', color: d.saidas > 0 ? 'var(--red)' : 'var(--text-mid)' }}>
                      {d.saidas > 0 ? '(' : ''}{fmtMoney(d.saidas)}{d.saidas > 0 ? ')' : ''}
                    </td>
                    <td style={{ ...td, textAlign: 'right', color: corSaldo, fontWeight: 600 }}>{fmtMoney(d.saldoMes)}</td>
                    <td style={{ ...td, textAlign: 'right', color: corAcum, fontWeight: 700 }}>{fmtMoney(d.saldoAcum)}</td>
                    <td style={{ ...td, textAlign: 'center' }}>{badge}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </AppLayout>
  )
}

// ─── Componentes utilitários ─────────────────────────────────────────────────
function Badge({ bg, color, children }) {
  return (
    <span style={{
      background: bg, color, padding: '3px 9px', borderRadius: 10,
      fontSize: 9, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase',
    }}>{children}</span>
  )
}

// ─── styles ──────────────────────────────────────────────────────────────────
const emptyState = {
  padding: '60px 24px', textAlign: 'center',
  fontFamily: 'var(--body)', color: 'var(--text-mid)', fontSize: 13,
}

const kpiGrid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  gap: 16, marginBottom: 24,
}
const kpiCard = {
  background: 'var(--white)', borderRadius: 12,
  padding: 24,
  border: '1px solid var(--cream-dark)',
  boxShadow: 'var(--shadow)',
}
const kpiLabel = {
  fontSize: 10, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase',
  color: 'var(--text-mid)', marginBottom: 10,
  fontFamily: 'var(--body)',
}
const kpiNum = { fontSize: 42, fontWeight: 700, color: 'var(--navy)', lineHeight: 1 }
const kpiUnit = { fontSize: 11, color: 'var(--text-mid)' }
const kpiBigVal = { fontSize: 32, fontWeight: 700, lineHeight: 1, fontFamily: 'var(--body)' }
const kpiSub = { fontSize: 11, color: 'var(--text-mid)', marginTop: 8 }
const kpiSubGold = { fontSize: 13, color: 'var(--gold-dark)', marginTop: 8, fontWeight: 600 }

const chartCard = {
  background: 'var(--white)', borderRadius: 12,
  padding: 24, marginBottom: 24,
  border: '1px solid var(--cream-dark)',
  boxShadow: 'var(--shadow)',
}
const chartHeader = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
  marginBottom: 14, gap: 16, flexWrap: 'wrap',
}
const chartTitle = { fontSize: 14, fontWeight: 600, color: 'var(--navy)', fontFamily: 'var(--body)' }
const chartSubtitle = { fontSize: 11, color: 'var(--text-mid)', marginTop: 2 }
const legendWrap = { display: 'flex', gap: 16, fontSize: 11, color: 'var(--text-mid)', flexWrap: 'wrap' }
const legendItem = { display: 'inline-flex', alignItems: 'center', gap: 5 }
const swatch = { display: 'inline-block', width: 12, height: 12, borderRadius: 2 }
const swatchLine = { display: 'inline-block', width: 14, height: 3 }

const tableCard = {
  background: 'var(--white)', borderRadius: 12,
  border: '1px solid var(--cream-dark)',
  boxShadow: 'var(--shadow)',
  overflow: 'hidden',
}
const tableHeader = { padding: '18px 24px 14px', borderBottom: '1px solid var(--cream-dark)' }
const tbl = { width: '100%', fontSize: 12, borderCollapse: 'collapse', fontFamily: 'var(--body)' }
const thBase = {
  padding: '10px 16px',
  fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase',
}
const td = { padding: '10px 16px', verticalAlign: 'middle' }

const alertDanger = {
  background: 'rgba(231,76,60,0.10)', borderLeft: '3px solid var(--red)',
  color: 'var(--red)', padding: '10px 14px', borderRadius: 6,
  fontSize: 12, fontFamily: 'var(--body)', marginBottom: 8, fontWeight: 600,
}
const alertWarning = {
  background: 'rgba(204,145,94,0.10)', borderLeft: '3px solid var(--gold)',
  color: 'var(--navy)', padding: '10px 14px', borderRadius: 6,
  fontSize: 12, fontFamily: 'var(--body)', marginBottom: 8, fontWeight: 600,
}
