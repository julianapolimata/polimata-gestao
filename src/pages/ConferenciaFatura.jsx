import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import AppLayout from '../components/AppLayout'
import { fmtMoney, flatten } from '../lib/finance'
import { periodoFatura, rotuloFatura } from '../lib/fatura'

// =====================================================================
// FATURA DO CARTÃO — tela de LEITURA (visão, não ação).
// Modelo "cartão como conta própria" (bloco 4):
//  • o cartão é uma linha de contas_bancarias com data.tipo === 'cartao';
//  • as compras são payable com cartao_id = id da conta-cartão
//    (data.due = vencimento da fatura em que a compra cai);
//  • pagar a fatura = uma transferência (tabela transferencias) da conta
//    corrente para a conta-cartão.
// Importar o OFX da fatura e conciliar o pagamento acontecem na
// Conciliação (/conciliacao), escolhendo a conta-cartão no seletor.
// Decisão UX 30/05: período = (dia_fechamento+1 mês ant.) → (dia_fech).
// =====================================================================

function fmtDataBR(s) {
  if (!s) return '—'
  const [y, m, d] = s.split('-')
  return `${d}/${m}/${y}`
}

// Data local em YYYY-MM-DD (sem o deslocamento de fuso do toISOString).
function hojeISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function ConferenciaFatura() {
  const { user } = useAuth()
  const [cartoes, setCartoes] = useState([])
  const [cartaoId, setCartaoId] = useState('')
  const [compras, setCompras] = useState([])
  const [transferencias, setTransferencias] = useState([])
  const [loading, setLoading] = useState(true)

  const hoje = new Date()
  const [ano, setAno] = useState(hoje.getFullYear())
  const [mes, setMes] = useState(hoje.getMonth())

  const carregar = useCallback(() => {
    if (!user) return
    setLoading(true)
    Promise.all([
      supabase.from('contas_bancarias').select('*'),
      supabase.from('payable').select('*'),
      supabase.from('transferencias').select('*'),
    ]).then(([rC, rP, rT]) => {
      const ativos = (rC.data || [])
        .filter(c => c.data?.tipo === 'cartao' && c.data?.ativo !== false)
        .sort((a, b) => (a.data?.nome || '').localeCompare(b.data?.nome || ''))
      setCartoes(ativos)
      setCompras((rP.data || [])
        .filter(r => r.cartao_id)
        .map(r => ({ ...flatten(r), cartao_id: r.cartao_id, parent_id: r.parent_id })))
      setTransferencias(rT.data || [])
      if (ativos.length > 0 && !cartaoId) setCartaoId(ativos[0].id)
      setLoading(false)
    })
  }, [user, cartaoId])

  useEffect(() => { carregar() }, [carregar])

  const cartao = useMemo(() => cartoes.find(c => c.id === cartaoId), [cartoes, cartaoId])

  const periodo = useMemo(() => cartao ? periodoFatura(cartao, ano, mes) : null, [cartao, ano, mes])

  // Mês-calendário de vencimento selecionado (parcela = mês da fatura)
  const venceMesIni = useMemo(() => `${ano}-${String(mes + 1).padStart(2, '0')}-01`, [ano, mes])
  const venceMesFim = useMemo(() => {
    const ultimoDia = new Date(ano, mes + 1, 0).getDate()
    return `${ano}-${String(mes + 1).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`
  }, [ano, mes])

  // Todas as compras deste cartão (qualquer fatura)
  const comprasCartao = useMemo(
    () => compras.filter(p => p.cartao_id === cartaoId),
    [compras, cartaoId],
  )

  // ── Fatura selecionada ───────────────────────────────────────────────
  const lancamentos = useMemo(() => {
    if (!cartao || !periodo) return []
    return comprasCartao
      .filter(p => p.due && p.due >= venceMesIni && p.due <= venceMesFim)
      .sort((a, b) => (a.data?.data_competencia || a.due).localeCompare(b.data?.data_competencia || b.due))
  }, [comprasCartao, cartao, periodo, venceMesIni, venceMesFim])

  const totalFatura = useMemo(
    () => lancamentos.reduce((s, x) => s + Number(x.value || 0), 0),
    [lancamentos],
  )

  // Pagamentos recebidos = transferências PARA o cartão dentro do mês de vencimento
  const pagamentos = useMemo(() => {
    if (!cartaoId) return []
    return transferencias
      .filter(t => t.para_conta_id === cartaoId && t.data && t.data >= venceMesIni && t.data <= venceMesFim)
      .sort((a, b) => (a.data || '').localeCompare(b.data || ''))
  }, [transferencias, cartaoId, venceMesIni, venceMesFim])

  const totalPagamentos = useMemo(
    () => pagamentos.reduce((s, t) => s + Number(t.valor || 0), 0),
    [pagamentos],
  )

  const emAberto = totalFatura - totalPagamentos
  const quitada = Math.abs(emAberto) < 0.01
  const pagoAMais = !quitada && emAberto < 0

  // ── Saldo atual da conta-cartão (dívida acumulada) ───────────────────
  // saldo_inicial − Σ compras já cobradas (status Pago) + Σ transferências
  // recebidas (qualquer data) − Σ transferências enviadas pelo cartão.
  const saldoAtual = useMemo(() => {
    if (!cartao) return 0
    const inicial = Number(cartao.data?.saldo_inicial || 0)
    const cobradas = comprasCartao
      .filter(p => p.status === 'Pago')
      .reduce((s, p) => s + Number(p.value || 0), 0)
    const recebidas = transferencias
      .filter(t => t.para_conta_id === cartaoId)
      .reduce((s, t) => s + Number(t.valor || 0), 0)
    const enviadas = transferencias
      .filter(t => t.de_conta_id === cartaoId)
      .reduce((s, t) => s + Number(t.valor || 0), 0)
    return inicial - cobradas + recebidas - enviadas
  }, [cartao, cartaoId, comprasCartao, transferencias])

  // Parcelas futuras = compras ainda não cobradas com vencimento após hoje
  const parcelasFuturas = useMemo(() => {
    const h = hojeISO()
    return comprasCartao
      .filter(p => p.status !== 'Pago' && p.due && p.due > h)
      .reduce((s, p) => s + Number(p.value || 0), 0)
  }, [comprasCartao])

  // Anos disponíveis pro select — corrente e os 2 últimos
  const anos = [hoje.getFullYear(), hoje.getFullYear() - 1, hoje.getFullYear() - 2]

  const colgroup = (
    <colgroup>
      <col style={{ width: 90 }} />
      <col />
      <col />
      <col style={{ width: 90 }} />
      <col style={{ width: 120 }} />
      <col style={{ width: 130 }} />
      <col style={{ width: 90 }} />
    </colgroup>
  )
  const temDados = !loading && cartoes.length > 0 && lancamentos.length > 0

  if (cartoes.length === 0 && !loading) {
    return (
      <AppLayout title="Fatura do Cartão">
        <div style={emptyState}>
          Nenhum cartão ativo cadastrado. <a href="/contas-bancarias" style={linkStyle}>Cadastrar cartão</a>.
        </div>
      </AppLayout>
    )
  }

  const corEmAberto = quitada ? 'var(--green)' : pagoAMais ? 'var(--orange)' : 'var(--red)'
  const nomeCartao = cartao?.data?.nome || 'cartão'

  return (
    <AppLayout
      title="Fatura do Cartão"
      stickyTop={(
        <>
          {/* Seletor */}
          <div style={topo}>
            <Field label="Cartão">
              <select value={cartaoId} onChange={e => setCartaoId(e.target.value)} style={select}>
                {cartoes.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.data?.nome}{c.data?.bandeira ? ` (${c.data.bandeira})` : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Mês de Vencimento">
              <select value={mes} onChange={e => setMes(Number(e.target.value))} style={select}>
                {['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'].map((m, i) =>
                  <option key={i} value={i}>{m}</option>
                )}
              </select>
            </Field>
            <Field label="Ano">
              <select value={ano} onChange={e => setAno(Number(e.target.value))} style={select}>
                {anos.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </Field>
          </div>

          {periodo && (
            <div style={periodoBox}>
              <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 12, color: 'var(--navy)' }}>
                <div><strong>Fatura:</strong> {rotuloFatura(ano, mes)}</div>
                <div><strong>Período coberto:</strong> {fmtDataBR(periodo.ini)} → {fmtDataBR(periodo.fim)}</div>
                <div><strong>Vencimento:</strong> {fmtDataBR(periodo.vencimento)}</div>
              </div>
            </div>
          )}

          {/* Números da fatura selecionada */}
          <div style={cardsRow}>
            <div style={totalBox}>
              <div>
                <div style={cardLabel}>Total da fatura</div>
                <div style={cardValor}>{fmtMoney(totalFatura)}</div>
                <div style={cardLegenda}>({lancamentos.length} lançamento{lancamentos.length === 1 ? '' : 's'})</div>
              </div>
            </div>

            <div style={totalBox}>
              <div style={{ minWidth: 0 }}>
                <div style={cardLabel}>Pagamentos recebidos</div>
                <div style={cardValor}>{fmtMoney(totalPagamentos)}</div>
                {pagamentos.length === 0 ? (
                  <div style={cardLegenda}>nenhuma transferência para este cartão no mês</div>
                ) : (
                  <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {pagamentos.map(t => (
                      <div key={t.id} style={cardLinhaPagto}>
                        <span style={{ fontWeight: 600 }}>{t.codigo || '—'}</span>
                        <span> · {fmtDataBR(t.data)}</span>
                        <span> · {fmtMoney(Number(t.valor || 0))}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div style={totalBox}>
              <div>
                <div style={cardLabel}>Em aberto</div>
                <div style={{ ...cardValor, color: corEmAberto }}>
                  {quitada ? '✓ ' : ''}{fmtMoney(pagoAMais ? -emAberto : emAberto)}
                </div>
                <div style={{ ...cardLegenda, color: corEmAberto }}>
                  {quitada ? 'fatura quitada' : pagoAMais ? 'pago a mais' : 'falta pagar'}
                </div>
              </div>
            </div>
          </div>

          <div style={ajudaStyle}>
            Para registrar o pagamento da fatura: em <a href="/conciliacao" style={linkStyle}>Conciliação</a>, selecione o débito na conta corrente e use ↔ Transferência para este cartão.
            {' '}Para importar a fatura: <a href="/conciliacao" style={linkStyle}>Conciliação</a> → conta <strong>{nomeCartao}</strong> → Importar OFX.
          </div>

          {/* Saldo atual da conta-cartão (dívida acumulada) */}
          <div style={totalBox}>
            <div>
              <div style={cardLabel}>Saldo atual da conta-cartão</div>
              <div style={{ ...cardValor, color: saldoAtual < -0.005 ? 'var(--red)' : 'var(--navy)' }}>{fmtMoney(saldoAtual)}</div>
              <div style={cardLegenda}>
                {saldoAtual < -0.005
                  ? 'o que o cartão ainda vai cobrar da conta'
                  : saldoAtual > 0.005 ? 'crédito a favor (pago além do cobrado)' : 'nada pendente de cobrança'}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={cardLabel}>Parcelas futuras</div>
              <div style={{ ...cardValor, fontSize: 22 }}>{fmtMoney(parcelasFuturas)}</div>
              <div style={cardLegenda}>ainda não cobradas</div>
            </div>
          </div>

          {/* Header de colunas (sticky) */}
          {temDados && (
            <div style={{ ...tableWrap, marginTop: 14, marginBottom: 0, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderBottom: 'none' }}>
              <table style={{ ...tbl, tableLayout: 'fixed' }}>
                {colgroup}
                <thead>
                  <tr>
                    <th style={th}>Cód.</th>
                    <th style={th}>Fornecedor</th>
                    <th style={th}>Descrição</th>
                    <th style={{ ...th, textAlign: 'center' }}>Parcela</th>
                    <th style={th}>Data da compra</th>
                    <th style={{ ...th, textAlign: 'right' }}>Valor</th>
                    <th style={{ ...th, textAlign: 'center' }}>Status</th>
                  </tr>
                </thead>
              </table>
            </div>
          )}
        </>
      )}
    >
      {/* Lista de lançamentos (body só) */}
      <div style={{ ...tableWrap, borderTopLeftRadius: temDados ? 0 : 10, borderTopRightRadius: temDados ? 0 : 10, borderTop: temDados ? 'none' : '1px solid var(--cream-dark)' }}>
        {loading ? (
          <div style={emptyState}>Carregando…</div>
        ) : lancamentos.length === 0 ? (
          <div style={emptyState}>Nenhum lançamento neste cartão na fatura {rotuloFatura(ano, mes)} (período {fmtDataBR(periodo?.ini)} → {fmtDataBR(periodo?.fim)}).</div>
        ) : (
          <table style={{ ...tbl, tableLayout: 'fixed' }}>
            {colgroup}
            <tbody>
              {lancamentos.map(p => {
                const parc = (p.data?.parcela_atual && p.data?.parcela_total) ? `${p.data.parcela_atual}/${p.data.parcela_total}` : '—'
                const isPago = p.status === 'Pago'
                const credito = Number(p.value || 0) < 0
                return (
                  <tr key={p.id}>
                    <td style={{ ...td, fontWeight: 600, color: 'var(--text-mid)' }}>{p.codigo || '—'}</td>
                    <td style={td}>
                      {p.supplier || '—'}
                      {p.data?.escriturado !== true && <span style={badgeAEscriturar} title="Não escriturada — escriture antes de conciliar">a escriturar</span>}
                    </td>
                    <td style={{ ...td, color: 'var(--text-mid)' }}>{p.desc || '—'}</td>
                    <td style={{ ...td, textAlign: 'center', color: 'var(--text-mid)' }}>{parc}</td>
                    <td style={td}>{fmtDataBR(p.data?.data_competencia || p.due)}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: credito ? 'var(--green)' : 'var(--navy)' }}>{fmtMoney(p.value)}</td>
                    <td style={{ ...td, textAlign: 'center' }}>
                      <span style={{ background: isPago ? 'rgba(39,174,96,0.10)' : 'rgba(230,126,34,0.10)', color: isPago ? 'var(--green)' : 'var(--orange)', padding: '3px 9px', borderRadius: 999, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        {p.status || 'Pendente'}
                      </span>
                    </td>
                  </tr>
                )
              })}
              <tr style={{ background: 'var(--cream)' }}>
                <td style={{ ...td, fontWeight: 700 }} colSpan={5}>Total</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: 'var(--navy)' }}>{fmtMoney(totalFatura)}</td>
                <td style={td}></td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </AppLayout>
  )
}

function Field({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  )
}


const topo = { display: 'flex', gap: 14, marginBottom: 14, flexWrap: 'wrap' }
const badgeAEscriturar = { marginLeft: 8, fontSize: 9, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--gold)', border: '1px solid var(--gold)', borderRadius: 4, padding: '1px 5px', whiteSpace: 'nowrap' }
const totalBox = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 22px', background: 'var(--white)', borderRadius: 10, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)', marginBottom: 14, flexWrap: 'wrap', gap: 14 }
const cardsRow = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }
const cardLabel = { fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-mid)' }
const cardValor = { fontSize: 30, fontWeight: 700, color: 'var(--navy)', marginTop: 4, fontFamily: 'var(--body)' }
const cardLegenda = { fontSize: 11, color: 'var(--text-mid)', marginTop: 2, fontFamily: 'var(--body)' }
const cardLinhaPagto = { fontSize: 11, color: 'var(--navy)', fontFamily: 'var(--body)', whiteSpace: 'nowrap' }
const ajudaStyle = { fontSize: 12, color: 'var(--text-mid)', fontFamily: 'var(--body)', margin: '0 0 14px 2px', lineHeight: 1.5 }
const linkStyle = { color: 'var(--gold)', textDecoration: 'underline', fontWeight: 600 }
const select = { padding: '9px 12px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 13, color: 'var(--navy)', background: 'var(--white)', outline: 'none', minWidth: 180 }
const periodoBox = { background: 'rgba(0,32,62,0.04)', borderLeft: '3px solid var(--navy)', padding: 14, borderRadius: 6, marginBottom: 18 }
const labelStyle = { fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-mid)', marginBottom: 6, fontFamily: 'var(--body)' }
const tableWrap = { background: 'var(--white)', borderRadius: 12, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)', overflow: 'clip' }
const tbl = { width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--body)' }
const th = { textAlign: 'left', padding: '12px 14px', fontSize: 9, fontWeight: 700, letterSpacing: 1.5, color: '#fff', textTransform: 'uppercase', background: 'var(--navy)', borderBottom: '2px solid var(--gold)' }
const td = { padding: '12px 14px', fontSize: 12, color: 'var(--navy)', borderBottom: '1px solid var(--cream-dark)', verticalAlign: 'middle' }
const emptyState = { padding: '60px 24px', textAlign: 'center', fontFamily: 'var(--body)', color: 'var(--text-mid)', fontSize: 13, background: 'var(--white)', borderRadius: 12, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)' }
