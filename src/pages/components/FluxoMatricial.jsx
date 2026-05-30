import { useEffect, useMemo, useState } from 'react'
// supabase não usado — recebemos receivable/payable do pai
import { fmtMoney, classificarFluxo } from '../../lib/finance'
import { fetchPlanoContas } from '../../lib/planoContas'

// =============================================================================
// FLUXO DE CAIXA MATRICIAL — replica a decisão UX de 26/abr/2026.
// Linhas: Saldo Inicial / Entradas Op / Saídas Op / Saldo Op / Investimento /
//         Saldo Final / Saldo Acumulado
// Colunas: 12 meses × 2 sub-colunas (Real | Projetado) + Total ano.
// Critério Real = liquidado (Recebido/Pago) com data_pagamento no mês.
// Critério Projetado = todos os lançamentos com vencimento no mês.
// Classificação CPC 03 vem de classificarFluxo() no finance.js.
// =============================================================================

const MES_LABEL = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

export default function FluxoMatricial({ receivable, payable, anosDisponiveis }) {
  const [ano, setAno] = useState(String(new Date().getFullYear()))
  const [plano, setPlano] = useState([])

  useEffect(() => {
    if (anosDisponiveis.length && !anosDisponiveis.includes(ano)) setAno(anosDisponiveis[0])
  }, [anosDisponiveis, ano])

  useEffect(() => {
    fetchPlanoContas().then(setPlano)
  }, [])

  // ── Agrupa por mês × {real,projetado} × {op_entrada, op_saida, inv_entrada, inv_saida} ──
  const matriz = useMemo(() => {
    if (!plano.length) return null

    const slots = {} // slots[mes] = { real:{opIn,opOut,invIn,invOut}, proj:{...} }
    for (let m = 0; m < 12; m++) {
      slots[m] = {
        real: { opIn: 0, opOut: 0, invIn: 0, invOut: 0 },
        proj: { opIn: 0, opOut: 0, invIn: 0, invOut: 0 },
      }
    }

    function ehDoAno(dateStr) {
      return dateStr && dateStr.startsWith(ano)
    }
    function mesDe(dateStr) {
      return parseInt(dateStr.substring(5, 7), 10) - 1
    }

    // ── Receivable ──────────────────────────────────────────────────────
    receivable.forEach(r => {
      const tipo = classificarFluxo({ ...r, _tipoFin: 'Entrada' }, plano)
      // Projetado: usa vencimento (qualquer lançamento)
      if (ehDoAno(r.due)) {
        const m = mesDe(r.due)
        if (tipo === 'investimento') slots[m].proj.invIn += r.value
        else slots[m].proj.opIn += r.value
      }
      // Real: só liquidado, usa data_pagamento (com fallback)
      if (r.status === 'Recebido') {
        const ref = r.data?.data_pagamento || r.due || r.created
        if (ehDoAno(ref)) {
          const m = mesDe(ref)
          if (tipo === 'investimento') slots[m].real.invIn += r.value
          else slots[m].real.opIn += r.value
        }
      }
    })

    // ── Payable ─────────────────────────────────────────────────────────
    payable.forEach(r => {
      const tipo = classificarFluxo({ ...r, _tipoFin: 'Saída' }, plano)
      if (ehDoAno(r.due)) {
        const m = mesDe(r.due)
        if (tipo === 'investimento') slots[m].proj.invOut += r.value
        else slots[m].proj.opOut += r.value
      }
      if (r.status === 'Pago') {
        const ref = r.data?.data_pagamento || r.due || r.created
        if (ehDoAno(ref)) {
          const m = mesDe(ref)
          if (tipo === 'investimento') slots[m].real.invOut += r.value
          else slots[m].real.opOut += r.value
        }
      }
    })

    // ── Saldo Inicial (= acumulado de meses anteriores no Real) ─────────
    // Pra Projetado, usa o Saldo Final Projetado do mês anterior
    let saldoRealAcum = 0
    let saldoProjAcum = 0
    const meses = []
    for (let m = 0; m < 12; m++) {
      const s = slots[m]
      const saldoOpReal = s.real.opIn - s.real.opOut
      const saldoOpProj = s.proj.opIn - s.proj.opOut
      const invRealLiq = s.real.invIn - s.real.invOut
      const invProjLiq = s.proj.invIn - s.proj.invOut
      const variacaoReal = saldoOpReal + invRealLiq
      const variacaoProj = saldoOpProj + invProjLiq
      const saldoIniReal = saldoRealAcum
      const saldoIniProj = saldoProjAcum
      const saldoFimReal = saldoIniReal + variacaoReal
      const saldoFimProj = saldoIniProj + variacaoProj
      saldoRealAcum = saldoFimReal
      saldoProjAcum = saldoFimProj
      meses.push({
        m, label: MES_LABEL[m],
        real: { saldoIni: saldoIniReal, opIn: s.real.opIn, opOut: s.real.opOut, saldoOp: saldoOpReal, inv: invRealLiq, saldoFim: saldoFimReal },
        proj: { saldoIni: saldoIniProj, opIn: s.proj.opIn, opOut: s.proj.opOut, saldoOp: saldoOpProj, inv: invProjLiq, saldoFim: saldoFimProj },
      })
    }
    // Total ano = soma colunas de cada métrica (saldoIni e saldoFim são do últ mês)
    const total = {
      real: {
        opIn: meses.reduce((a, x) => a + x.real.opIn, 0),
        opOut: meses.reduce((a, x) => a + x.real.opOut, 0),
        inv: meses.reduce((a, x) => a + x.real.inv, 0),
        saldoOp: meses.reduce((a, x) => a + x.real.saldoOp, 0),
        saldoIni: 0,
        saldoFim: saldoRealAcum,
      },
      proj: {
        opIn: meses.reduce((a, x) => a + x.proj.opIn, 0),
        opOut: meses.reduce((a, x) => a + x.proj.opOut, 0),
        inv: meses.reduce((a, x) => a + x.proj.inv, 0),
        saldoOp: meses.reduce((a, x) => a + x.proj.saldoOp, 0),
        saldoIni: 0,
        saldoFim: saldoProjAcum,
      },
    }
    return { meses, total }
  }, [receivable, payable, plano, ano])

  const linhas = [
    { id: 'saldoIni', label: 'Saldo Inicial', kind: 'sub', get: c => c.saldoIni },
    { id: 'opIn', label: '(+) Entradas Operacionais', kind: 'pos', get: c => c.opIn },
    { id: 'opOut', label: '(−) Saídas Operacionais', kind: 'neg', get: c => c.opOut },
    { id: 'saldoOp', label: '= Saldo Operacional', kind: 'sub', get: c => c.saldoOp },
    { id: 'inv', label: '(+/−) Atividades de Investimento', kind: 'inv', get: c => c.inv },
    { id: 'saldoFim', label: '= Saldo Final', kind: 'tot', get: c => c.saldoFim },
  ]

  return (
    <div>
      <div style={topo}>
        <div style={{ fontSize: 12, color: 'var(--text-mid)', flex: 1 }}>
          Visão por atividade — Operacional + Investimento (CPC 03). Cada mês mostra <strong>Real</strong> (liquidado) e <strong>Projetado</strong> (a vencer) lado a lado.
        </div>
        <select value={ano} onChange={e => setAno(e.target.value)} style={selectStyle}>
          {anosDisponiveis.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      <div style={tableWrap}>
        <div style={{ overflowX: 'auto' }}>
          <table style={tbl}>
            <thead>
              <tr style={{ background: 'var(--navy)', color: '#fff' }}>
                <th rowSpan={2} style={{ ...thFirst, position: 'sticky', left: 0, background: 'var(--navy)', zIndex: 1 }}>Linha</th>
                {MES_LABEL.map(m => (
                  <th key={m} colSpan={2} style={thMonth}>{m}</th>
                ))}
                <th colSpan={2} style={{ ...thMonth, background: 'rgba(255,255,255,0.08)' }}>Total ano</th>
              </tr>
              <tr style={{ background: 'var(--navy-mid)', color: '#fff' }}>
                {MES_LABEL.map(m => (
                  <>
                    <th key={`r-${m}`} style={thSub}>Real</th>
                    <th key={`p-${m}`} style={thSub}>Proj.</th>
                  </>
                ))}
                <th style={{ ...thSub, background: 'rgba(255,255,255,0.06)' }}>Real</th>
                <th style={{ ...thSub, background: 'rgba(255,255,255,0.06)' }}>Proj.</th>
              </tr>
            </thead>
            <tbody>
              {!matriz ? (
                <tr><td colSpan={26} style={{ padding: 32, textAlign: 'center', color: 'var(--text-mid)' }}>Carregando dados…</td></tr>
              ) : linhas.map(l => (
                <tr key={l.id} style={{ borderBottom: '1px solid var(--cream-dark)', background: l.kind === 'tot' ? 'rgba(204,145,94,0.06)' : (l.kind === 'sub' ? 'var(--cream)' : 'transparent') }}>
                  <td style={{ ...tdFirst, position: 'sticky', left: 0, background: l.kind === 'tot' ? '#FAF5EE' : (l.kind === 'sub' ? 'var(--cream)' : 'var(--white)'), fontWeight: ['sub', 'tot'].includes(l.kind) ? 700 : 600 }}>
                    {l.label}
                  </td>
                  {matriz.meses.map(mes => (
                    <>
                      <td key={`r-${mes.m}-${l.id}`} style={{ ...tdNum, color: corLinha(l.kind, l.get(mes.real)) }}>{l.get(mes.real) === 0 ? '—' : fmtMoney(l.get(mes.real))}</td>
                      <td key={`p-${mes.m}-${l.id}`} style={{ ...tdNum, color: corLinha(l.kind, l.get(mes.proj)), opacity: 0.85, fontStyle: 'italic' }}>{l.get(mes.proj) === 0 ? '—' : fmtMoney(l.get(mes.proj))}</td>
                    </>
                  ))}
                  <td style={{ ...tdNum, fontWeight: 700, color: corLinha(l.kind, l.get(matriz.total.real)), background: 'rgba(0,0,0,0.025)' }}>{l.get(matriz.total.real) === 0 ? '—' : fmtMoney(l.get(matriz.total.real))}</td>
                  <td style={{ ...tdNum, fontWeight: 700, color: corLinha(l.kind, l.get(matriz.total.proj)), background: 'rgba(0,0,0,0.025)', opacity: 0.85, fontStyle: 'italic' }}>{l.get(matriz.total.proj) === 0 ? '—' : fmtMoney(l.get(matriz.total.proj))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function corLinha(kind, valor) {
  if (kind === 'pos') return valor > 0 ? 'var(--green)' : 'var(--text-mid)'
  if (kind === 'neg') return valor > 0 ? 'var(--red)' : 'var(--text-mid)'
  if (kind === 'inv') return valor === 0 ? 'var(--text-mid)' : (valor > 0 ? 'var(--green)' : 'var(--red)')
  if (kind === 'sub') return valor >= 0 ? 'var(--navy)' : 'var(--red)'
  if (kind === 'tot') return valor >= 0 ? 'var(--green)' : 'var(--red)'
  return 'var(--navy)'
}

const topo = { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }
const selectStyle = { fontFamily: 'var(--body)', fontSize: 12, padding: '8px 14px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, background: 'var(--white)', color: 'var(--navy)', cursor: 'pointer', outline: 'none' }
const tableWrap = { background: 'var(--white)', borderRadius: 12, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)', overflow: 'hidden' }
const tbl = { width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontFamily: 'var(--body)', fontSize: 11 }
const thFirst = { padding: '12px 14px', fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', textAlign: 'left', minWidth: 220, borderRight: '1px solid rgba(255,255,255,0.1)' }
const thMonth = { padding: '8px 6px', fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', textAlign: 'center', borderRight: '1px solid rgba(255,255,255,0.08)', borderBottom: '1px solid rgba(255,255,255,0.15)' }
const thSub = { padding: '5px 6px', fontSize: 9, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', textAlign: 'center', borderRight: '1px solid rgba(255,255,255,0.08)' }
const tdFirst = { padding: '10px 14px', fontSize: 12, color: 'var(--navy)', verticalAlign: 'middle', borderRight: '1px solid var(--cream-dark)' }
const tdNum = { padding: '8px 6px', textAlign: 'right', verticalAlign: 'middle', fontSize: 11, borderRight: '1px solid var(--cream-dark)', whiteSpace: 'nowrap' }
