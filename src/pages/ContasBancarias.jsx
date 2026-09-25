import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import AppLayout from '../components/AppLayout'
import EstadoErro from '../components/EstadoErro'
import ModalContaBancaria from './components/ModalContaBancaria'
import { showToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'
import { fmtMoney } from '../lib/finance'

// Cartão de crédito é uma conta própria (data.tipo === 'cartao', saldo negativo)
// na mesma tabela contas_bancarias — a tabela antiga `cartoes` é legado.
const LABEL_TIPO = {
  corrente: 'Corrente', poupanca: 'Poupança',
  pagamento: 'Pagamento', investimento: 'Investimento',
  cartao: 'Cartão de crédito',
}
const isCartao = (row) => row?.data?.tipo === 'cartao'

export default function ContasBancarias() {
  const { user } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState(null)
  const [busca, setBusca] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [edicao, setEdicao] = useState(null)
  const [tipoInicial, setTipoInicial] = useState('corrente')

  const recarregar = useCallback(() => {
    if (!user) return
    setLoading(true)
    supabase.from('contas_bancarias').select('*').order('updated_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) { setErro(error); setRows([]) }
        else {
          setErro(null)
          // Contas primeiro, cartões depois; dentro de cada grupo mantém a ordem por updated_at
          const lista = data || []
          setRows([...lista.filter(r => !isCartao(r)), ...lista.filter(isCartao)])
        }
        setLoading(false)
      })
      .catch((e) => { setErro(e); setLoading(false) })
  }, [user])

  useEffect(() => { recarregar() }, [recarregar])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(item => {
      const d = item.data || {}
      return [d.nome, d.banco, d.agencia, d.conta, d.bandeira, d.observacoes].filter(Boolean).join(' ').toLowerCase().includes(q)
    })
  }, [rows, busca])

  function abrirNovo(tipo = 'corrente') { setEdicao(null); setTipoInicial(tipo); setModalOpen(true) }
  function abrirEdicao(row) { setEdicao(row); setModalOpen(true) }

  const [confirmar, dialogoConfirmacao] = useConfirm()

  async function excluir(row, e) {
    e?.stopPropagation()
    const nome = row.data?.nome || ''
    const ok = await confirmar({
      titulo: isCartao(row) ? `Excluir o cartão "${nome}"?` : `Excluir a conta "${nome}"?`,
      consequencias: isCartao(row)
        ? [
          'As compras já lançadas continuam registradas.',
          'Elas perdem o vínculo com o cartão: a fatura deixa de se formar.',
          'O saldo do cartão some do Início.',
        ]
        : [
          'Os lançamentos ligados a esta conta continuam existindo.',
          'O extrato importado e as conciliações dela deixam de ter conta.',
          'O saldo dela some do Início.',
        ],
      confirmarLabel: 'Excluir',
      variante: 'perigo',
      width: 520,
    })
    if (!ok) return
    const { error } = await supabase.from('contas_bancarias').delete().eq('id', row.id)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast(isCartao(row) ? 'Cartão excluído.' : 'Conta excluída.', 'info'); recarregar()
  }

  const colgroup = (
    <colgroup>
      <col />
      <col style={{ width: 130 }} />
      <col style={{ width: 110 }} />
      <col style={{ width: 110 }} />
      <col style={{ width: 130 }} />
      <col style={{ width: 130 }} />
      <col style={{ width: 90 }} />
      <col style={{ width: 50 }} />
    </colgroup>
  )
  const temDados = !loading && filtrados.length > 0

  return (
    <AppLayout
      title="Contas e Cartões"
      stickyTop={(
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: 1, maxWidth: 480 }}>
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
                style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-mid)' }}>
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar conta ou cartão..." style={searchInput} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => abrirNovo('corrente')} style={btnNovo}>+ Nova conta</button>
              <button onClick={() => abrirNovo('cartao')} style={btnNovo}>+ Novo cartão</button>
            </div>
          </div>
          {temDados && (
            <div style={{ ...tableWrap, marginBottom: 0, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderBottom: 'none' }}>
              <table style={{ ...tbl, tableLayout: 'fixed' }}>
                {colgroup}
                <thead>
                  <tr>
                    <th style={th}>Nome</th>
                    <th style={th}>Banco</th>
                    <th style={{ ...th, textAlign: 'center' }}>Tipo</th>
                    <th style={th}>Agência</th>
                    <th style={th}>Conta</th>
                    <th style={{ ...th, textAlign: 'right' }}>Saldo Inicial</th>
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
          <div style={emptyState}>{rows.length === 0 ? 'Nenhuma conta ou cartão cadastrado. Clique em "+ Nova conta" ou "+ Novo cartão" pra começar.' : 'Nenhum resultado.'}</div>
        ) : (
          <table style={{ ...tbl, tableLayout: 'fixed' }}>
            {colgroup}
            <tbody>
              {filtrados.map(c => {
                const d = c.data || {}
                const cartao = isCartao(c)
                return (
                  <tr key={c.id} onClick={() => abrirEdicao(c)} style={{ cursor: 'pointer' }} title="Clique para editar">
                    <td style={{ ...td, fontWeight: 600 }}>{d.nome || '—'}</td>
                    <td style={{ ...td, color: 'var(--text-mid)' }}>{d.banco || '—'}</td>
                    <td style={{ ...td, textAlign: 'center', color: 'var(--text-mid)' }}>{LABEL_TIPO[d.tipo] || '—'}</td>
                    <td style={{ ...td, color: 'var(--text-mid)' }}>{cartao ? (d.dia_fechamento ? `Fecha dia ${d.dia_fechamento}` : '—') : (d.agencia || '—')}</td>
                    <td style={{ ...td, color: 'var(--text-mid)' }}>{cartao ? (d.dia_vencimento ? `Vence dia ${d.dia_vencimento}` : '—') : (d.conta || '—')}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: (d.saldo_inicial || 0) >= 0 ? 'var(--navy)' : 'var(--red)' }}>
                      {d.saldo_inicial != null ? fmtMoney(d.saldo_inicial) : '—'}
                    </td>
                    <td style={{ ...td, textAlign: 'center' }}>
                      {d.ativo !== false
                        ? <span style={{ background: 'rgba(39,174,96,0.10)', color: 'var(--green)', padding: '3px 10px', borderRadius: 999, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Ativa</span>
                        : <span style={{ background: 'rgba(0,0,0,0.05)', color: 'var(--text-mid)', padding: '3px 10px', borderRadius: 999, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Inativa</span>}
                    </td>
                    <td style={{ ...td, textAlign: 'center' }}>
                      <button onClick={e => excluir(c, e)} title="Excluir" aria-label={cartao ? 'Excluir cartão' : 'Excluir conta'} style={btnExcluir}>×</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <ModalContaBancaria open={modalOpen} onClose={() => setModalOpen(false)} registro={edicao} onSaved={recarregar} tipoInicial={tipoInicial} />
    {dialogoConfirmacao}
    </AppLayout>
  )
}

const btnNovo = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 6, border: 'none', background: 'var(--gold)', color: '#fff', fontFamily: 'var(--body)', fontSize: 12, fontWeight: 700, letterSpacing: 0.5, cursor: 'pointer', textTransform: 'uppercase' }
const btnExcluir = { background: 'none', border: '1px solid transparent', borderRadius: 4, color: 'var(--text-mid)', fontSize: 18, lineHeight: 1, cursor: 'pointer', width: 26, height: 26, padding: 0 }
const searchInput = { width: '100%', padding: '10px 13px 10px 32px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 12, color: 'var(--navy)', background: 'var(--white)', outline: 'none' }
const tableWrap = { background: 'var(--white)', borderRadius: 12, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)', overflow: 'clip' }
const tbl = { width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--body)' }
const th = { textAlign: 'left', padding: '12px 14px', fontSize: 9, fontWeight: 700, letterSpacing: 1.5, color: '#fff', textTransform: 'uppercase', background: 'var(--navy)', borderBottom: '2px solid var(--gold)' }
const td = { padding: '12px 14px', fontSize: 12, color: 'var(--navy)', borderBottom: '1px solid var(--cream-dark)', verticalAlign: 'middle' }
const emptyState = { padding: '60px 24px', textAlign: 'center', fontFamily: 'var(--body)', color: 'var(--text-mid)', fontSize: 13 }
