import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import AppLayout from '../components/AppLayout'
import EstadoErro from '../components/EstadoErro'
import { showToast } from '../components/Toast'
import { fmtMoney, flatten } from '../lib/finance'
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

export default function Emprestimos() {
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
    supabase.from('emprestimos_financiamentos').select('*').order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) { setErro(error); setRows([]) }
        else { setErro(null); setRows((data || []).map(flatten)) }
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

  const totais = useMemo(() => {
    const ativos = filtrados.filter(r => r.status !== 'quitada')
    return {
      saldo: ativos.reduce((s, r) => s + Number(r.saldo_atual || 0), 0),
      parcelas: ativos.reduce((s, r) => s + Number(r.parcelas_total || 0) - Number(r.parcelas_pagas || 0), 0),
      count: ativos.length,
    }
  }, [filtrados])

  function abrirNovo() { setEdicao(null); setModalOpen(true) }
  function abrirEdicao(row) { setEdicao(row); setModalOpen(true) }

  async function excluir(row, e) {
    e.stopPropagation()
    if (!confirm(`Excluir "${row.nome || row.credor}"? As parcelas em Contas a Pagar NÃO serão excluídas.`)) return
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
              <div style={resumo}>
                <span style={{ color: 'var(--text-mid)' }}>{totais.count} ativo(s) · {totais.parcelas} parc. em aberto</span>
                <span style={{ width: 1, height: 14, background: 'var(--cream-dark)' }} />
                <span style={{ fontWeight: 600, color: 'var(--red)' }}>{fmtMoney(totais.saldo)}</span>
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
                const proxParcela = r.proxima_parcela_vencimento || '—'
                return (
                  <tr key={r.id} onClick={() => abrirEdicao(r)} style={{ cursor: 'pointer' }} title="Clique para ver/editar">
                    <td style={tdMono}>{r.codigo || '—'}</td>
                    <td style={td}>
                      <div style={{ fontWeight: 600 }}>{r.nome || r.credor || '—'}</div>
                      {r.numero_contrato && <div style={{ fontSize: 10, color: 'var(--text-mid)', fontFamily: 'monospace' }}>{r.numero_contrato}</div>}
                    </td>
                    <td style={{ ...td, color: 'var(--text-mid)' }}>{TIPO_LABEL[r.tipo] || '—'}</td>
                    <td style={{ ...td, textAlign: 'center', color: 'var(--text-mid)' }}>
                      {Number(r.parcelas_pagas || 0)}/{Number(r.parcelas_total || 0)}
                    </td>
                    <td style={{ ...td, textAlign: 'center', color: 'var(--text-mid)' }}>{fmtDataBR(proxParcela)}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: 'var(--red)' }}>{fmtMoney(r.saldo_atual)}</td>
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

      <ModalEmprestimo open={modalOpen} onClose={() => setModalOpen(false)} registro={edicao} onSaved={recarregar} />
    </AppLayout>
  )
}

const searchInput = { width: '100%', padding: '9px 12px 9px 32px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 13, color: 'var(--navy)', background: 'var(--white)', outline: 'none' }
const resumo = { display: 'inline-flex', alignItems: 'center', gap: 10, padding: '7px 12px', background: 'var(--white)', border: '1px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 12 }
const btnNovo = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 6, border: 'none', background: 'var(--gold)', color: '#fff', fontFamily: 'var(--body)', fontSize: 12, fontWeight: 700, letterSpacing: 0.5, cursor: 'pointer', textTransform: 'uppercase' }
const btnExcluir = { background: 'none', border: 'none', color: 'var(--text-mid)', fontSize: 22, lineHeight: 1, cursor: 'pointer', padding: 0 }
const tableWrap = { background: 'var(--white)', borderRadius: 10, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)' }
const tbl = { width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontFamily: 'var(--body)' }
const th = { textAlign: 'left', padding: '12px 14px', fontSize: 9, fontWeight: 700, letterSpacing: 1.5, color: '#fff', textTransform: 'uppercase', background: 'var(--navy)', borderBottom: '2px solid var(--gold)' }
const td = { padding: '12px 14px', fontSize: 12, color: 'var(--navy)', borderBottom: '1px solid var(--cream-dark)' }
const tdMono = { ...td, fontFamily: 'monospace', fontWeight: 600, color: 'var(--text-mid)', letterSpacing: 0.5 }
const emptyState = { padding: '60px 24px', textAlign: 'center', fontFamily: 'var(--body)', color: 'var(--text-mid)', fontSize: 13 }
