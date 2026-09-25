import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import AppLayout from '../components/AppLayout'
import EstadoErro from '../components/EstadoErro'
import { showToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'
import { fmtMoney } from '../lib/finance'
import ModalEmprestimo from './components/ModalEmprestimo'

function fmtDataBR(s) {
  if (!s) return '—'
  const [y, m, d] = s.split('-')
  return `${d}/${m}/${y}`
}

const TIPO_LABEL = {
  emprestimo: 'Empréstimo',
  financiamento: 'Financiamento',
  parcelamento_fiscal: 'Parcelamento Fiscal',
}

// =============================================================================
// Saldo e parcelas VIVOS: a verdade das parcelas está em Contas a Pagar
// (payable.emprestimo_id). O que foi digitado no cadastro (saldo_atual,
// parcelas_pagas) é só o ponto de partida pra gerar as parcelas — depois
// disso congela. Aqui consolidamos as parcelas reais por empréstimo.
//
// Uma parcela pode virar 2 linhas em payable (amortização + juros) — por isso
// contagem é por número de parcela (parcela_atual), não por linha. Saldo e
// próximo vencimento somam/olham todas as linhas não pagas.
// =============================================================================
function consolidarParcelas(linhas) {
  const porEmp = new Map()
  for (const l of linhas || []) {
    if (!l.emprestimo_id) continue
    if (!porEmp.has(l.emprestimo_id)) porEmp.set(l.emprestimo_id, { linhas: 0, saldo: 0, proxima: null, nums: new Map() })
    const e = porEmp.get(l.emprestimo_id)
    const pago = l.st === 'Pago'
    const val = Number(l.val || 0)
    e.linhas += 1
    if (!pago) {
      e.saldo += val
      if (l.due && (!e.proxima || l.due < e.proxima)) e.proxima = l.due
    }
    // Número da parcela (fallback: a própria linha, quando não veio numerada)
    const num = l.num != null && l.num !== '' ? String(l.num) : `linha:${l.id}`
    const cur = e.nums.get(num) || { pago: true }
    cur.pago = cur.pago && pago
    e.nums.set(num, cur)
  }
  const out = {}
  for (const [id, e] of porEmp) {
    let pagas = 0
    for (const n of e.nums.values()) if (n.pago) pagas += 1
    out[id] = { total: e.nums.size, pagas, saldo: e.saldo, proxima: e.proxima, linhas: e.linhas }
  }
  return out
}

export default function Emprestimos() {
  const { user } = useAuth()
  const [rows, setRows] = useState([])
  const [reais, setReais] = useState({}) // emprestimo_id → { total, pagas, saldo, proxima }
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState(null)
  const [busca, setBusca] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [edicao, setEdicao] = useState(null)

  const recarregar = useCallback(() => {
    if (!user) return
    setLoading(true)
    Promise.all([
      supabase.from('emprestimos_financiamentos').select('*').order('created_at', { ascending: false }),
      // Parcelas reais em Contas a Pagar (só o que precisamos — nada de data inteiro).
      supabase.from('payable')
        .select('id, emprestimo_id, due:data->>due, st:data->>status, val:data->>value, num:data->>parcela_atual')
        .not('emprestimo_id', 'is', null),
    ])
      .then(([rE, rP]) => {
        if (rE.error) { setErro(rE.error); setRows([]) }
        // Os campos do empréstimo (nome, tipo, saldo_atual, parcelas…) vivem em
        // data — o flatten genérico não os expõe. Levantamos data pro topo aqui.
        else { setErro(null); setRows((rE.data || []).map(r => ({ ...r, ...r.data }))) }
        // Parcelas: erro aqui não derruba a tela — cai no valor digitado (com selo).
        if (rP.error) { console.warn('parcelas de empréstimo:', rP.error.message); setReais({}) }
        else setReais(consolidarParcelas(rP.data))
        setLoading(false)
      })
      .catch((e) => { setErro(e); setLoading(false) })
  }, [user])

  useEffect(() => { recarregar() }, [recarregar])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(r => {
      const blob = [r.codigo, r.nome, r.credor, r.numero_contrato].filter(Boolean).join(' ').toLowerCase()
      return blob.includes(q)
    })
  }, [rows, busca])

  // Números que a tela mostra: reais (Contas a Pagar) quando existem parcelas
  // geradas; senão o digitado no cadastro, marcado como "informado".
  const visao = useCallback((r) => {
    const real = reais[r.id]
    if (real && real.linhas > 0) {
      return { real: true, saldo: real.saldo, pagas: real.pagas, total: real.total, proxima: real.proxima }
    }
    const proxSnapshot = (r.parcelas || []).find(p => !p.pago)?.vencimento || null
    return { real: false, saldo: Number(r.saldo_atual || 0), pagas: Number(r.parcelas_pagas || 0), total: Number(r.parcelas_total || 0), proxima: proxSnapshot }
  }, [reais])

  const totais = useMemo(() => {
    const ativos = filtrados.filter(r => r.status !== 'quitada')
    let saldo = 0, parcelas = 0, informados = 0
    for (const r of ativos) {
      const v = visao(r)
      saldo += v.saldo
      parcelas += Math.max(0, v.total - v.pagas)
      if (!v.real) informados += 1
    }
    return { saldo, parcelas, count: ativos.length, informados }
  }, [filtrados, visao])

  function abrirNovo() { setEdicao(null); setModalOpen(true) }
  function abrirEdicao(row) { setEdicao(row); setModalOpen(true) }

  const [confirmar, dialogoConfirmacao] = useConfirm()

  async function excluir(row, e) {
    e.stopPropagation()
    const ok = await confirmar({
      titulo: `Excluir "${row.nome || row.credor}"?`,
      consequencias: [
        'As parcelas já lançadas em Contas a Pagar CONTINUAM lá — elas não são apagadas.',
        'O que se perde é o vínculo: o sistema deixa de saber que aquelas parcelas são deste empréstimo.',
        'O saldo devedor deixa de ser acompanhado.',
      ],
      confirmarLabel: 'Excluir',
      variante: 'perigo',
      width: 520,
    })
    if (!ok) return
    const { error } = await supabase.from('emprestimos_financiamentos').delete().eq('id', row.id)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast('Excluído.', 'info')
    recarregar()
  }

  const colgroup = (
    <colgroup>
      <col style={{ width: 100 }} />
      <col />
      <col style={{ width: 150 }} />
      <col style={{ width: 110, textAlign: 'center' }} />
      <col style={{ width: 100, textAlign: 'center' }} />
      <col style={{ width: 140, textAlign: 'right' }} />
      <col style={{ width: 100, textAlign: 'center' }} />
      <col style={{ width: 50 }} />
    </colgroup>
  )
  const temDados = !loading && filtrados.length > 0

  return (
    <AppLayout
      title="Empréstimos e Financiamentos"
      stickyTop={(
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: 1, maxWidth: 480 }}>
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
                style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-mid)' }}>
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar..." style={searchInput} />
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <div style={resumo} title="Saldo devedor e parcelas calculados pelas parcelas reais em Contas a Pagar">
                <span style={{ color: 'var(--text-mid)' }}>{totais.count} ativo(s) · {totais.parcelas} parc. em aberto</span>
                <span style={{ width: 1, height: 14, background: 'var(--cream-dark)' }} />
                <span style={{ fontWeight: 600, color: 'var(--red)' }}>{fmtMoney(totais.saldo)}</span>
                {totais.informados > 0 && (
                  <span style={seloInformado} title={`${totais.informados} sem parcelas geradas — valor digitado no cadastro`}>
                    {totais.informados} informado(s)
                  </span>
                )}
              </div>
              <button onClick={abrirNovo} style={btnNovo}>+ Novo</button>
            </div>
          </div>
          {temDados && (
            <div style={{ ...tableWrap, marginBottom: 0, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderBottom: 'none' }}>
              <table style={{ ...tbl, tableLayout: 'fixed' }}>
                {colgroup}
                <thead>
                  <tr>
                    <th style={th}>Cód.</th>
                    <th style={th}>Nome / Credor</th>
                    <th style={th}>Tipo</th>
                    <th style={{ ...th, textAlign: 'center' }}>Parcelas</th>
                    <th style={{ ...th, textAlign: 'center' }}>Próx. venc.</th>
                    <th style={{ ...th, textAlign: 'right' }}>Saldo</th>
                    <th style={{ ...th, textAlign: 'center' }}>Status</th>
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
            {rows.length === 0 ? 'Nenhum empréstimo ou financiamento cadastrado. Clique em "+ Novo" pra começar.' : 'Nenhum resultado.'}
          </div>
        ) : (
          <table style={{ ...tbl, tableLayout: 'fixed' }}>
            {colgroup}
            <tbody>
              {filtrados.map(r => {
                const status = r.status || 'ativa'
                // Reais (Contas a Pagar) ou digitados no cadastro (selo "informado").
                const v = visao(r)
                const selo = v.real ? null : <span style={seloInformado} title="sem parcelas geradas — valor digitado no cadastro">informado</span>
                return (
                  <tr key={r.id} onClick={() => abrirEdicao(r)} style={{ cursor: 'pointer' }} title="Clique para ver/editar">
                    <td style={tdMono}>{r.codigo || '—'}</td>
                    <td style={td}>
                      <div style={{ fontWeight: 600 }}>{r.nome || r.credor || '—'}</div>
                      {r.numero_contrato && <div style={{ fontSize: 10, color: 'var(--text-mid)', fontFamily: 'monospace' }}>{r.numero_contrato}</div>}
                    </td>
                    <td style={{ ...td, color: 'var(--text-mid)' }}>{TIPO_LABEL[r.tipo] || '—'}</td>
                    <td style={{ ...td, textAlign: 'center', color: 'var(--text-mid)' }} title={v.real ? 'Contagem real das parcelas em Contas a Pagar' : 'sem parcelas geradas — valor digitado no cadastro'}>
                      {v.pagas}/{v.total}{selo}
                    </td>
                    <td style={{ ...td, textAlign: 'center', color: 'var(--text-mid)' }} title={v.real ? 'Menor vencimento ainda não pago em Contas a Pagar' : 'cronograma digitado no cadastro'}>
                      {v.proxima ? fmtDataBR(v.proxima) : (status === 'quitada' ? '—' : (v.real ? 'tudo pago' : '—'))}
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: 'var(--red)' }} title={v.real ? 'Soma das parcelas não pagas em Contas a Pagar' : 'sem parcelas geradas — valor digitado no cadastro'}>
                      {fmtMoney(v.saldo)}{selo}
                    </td>
                    <td style={{ ...td, textAlign: 'center' }}>
                      {status === 'quitada'
                        ? <span style={{ background: 'rgba(39,174,96,0.10)', color: 'var(--green)', padding: '3px 9px', borderRadius: 999, fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Quitada</span>
                        : status === 'em_atraso'
                        ? <span style={{ background: 'rgba(231,76,60,0.10)', color: 'var(--red)', padding: '3px 9px', borderRadius: 999, fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Atraso</span>
                        : <span style={{ background: 'rgba(0,32,62,0.08)', color: 'var(--navy)', padding: '3px 9px', borderRadius: 999, fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>Ativa</span>}
                    </td>
                    <td style={{ ...td, textAlign: 'center' }}>
                      <button onClick={e => excluir(r, e)} title="Excluir" style={btnExcluir}>×</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <ModalEmprestimo open={modalOpen} onClose={() => setModalOpen(false)} registro={edicao} reais={edicao ? (reais[edicao.id] || null) : null} onSaved={recarregar} />
    {dialogoConfirmacao}
    </AppLayout>
  )
}

const searchInput = { width: '100%', padding: '9px 12px 9px 32px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 13, color: 'var(--navy)', background: 'var(--white)', outline: 'none' }
const resumo = { display: 'inline-flex', alignItems: 'center', gap: 10, padding: '7px 12px', background: 'var(--white)', border: '1px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 12 }
const btnNovo = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 6, border: 'none', background: 'var(--gold)', color: '#fff', fontFamily: 'var(--body)', fontSize: 12, fontWeight: 700, letterSpacing: 0.5, cursor: 'pointer', textTransform: 'uppercase' }
const btnExcluir = { background: 'none', border: 'none', color: 'var(--text-mid)', fontSize: 22, lineHeight: 1, cursor: 'pointer', padding: 0 }
const seloInformado = { display: 'inline-block', marginLeft: 6, fontSize: 8, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--gold-dark)', border: '1px solid var(--gold-dark)', borderRadius: 4, padding: '1px 5px', verticalAlign: 'middle', cursor: 'help' }
const tableWrap = { background: 'var(--white)', borderRadius: 10, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)' }
const tbl = { width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontFamily: 'var(--body)' }
const th = { textAlign: 'left', padding: '12px 14px', fontSize: 9, fontWeight: 700, letterSpacing: 1.5, color: '#fff', textTransform: 'uppercase', background: 'var(--navy)', borderBottom: '2px solid var(--gold)' }
const td = { padding: '12px 14px', fontSize: 12, color: 'var(--navy)', borderBottom: '1px solid var(--cream-dark)' }
const tdMono = { ...td, fontFamily: 'monospace', fontWeight: 600, color: 'var(--text-mid)', letterSpacing: 0.5 }
const emptyState = { padding: '60px 24px', textAlign: 'center', fontFamily: 'var(--body)', color: 'var(--text-mid)', fontSize: 13 }
