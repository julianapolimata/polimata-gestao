import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'
import { showToast } from '../../components/Toast'
import { fmtMoney, flatten } from '../../lib/finance'
import { periodoFatura, rotuloFatura } from '../../lib/fatura'

// ===========================================================================
// MODAL CONCILIAR FATURA DO CARTÃO
//
// Recebe o débito bancário (1 lançamento do extrato) e permite vinculá-lo
// aos N lançamentos da fatura do cartão. Default: marca todos os lançamentos
// do período + permite desmarcar/marcar individualmente + criar lançamento
// de encargos pra fechar diferença.
// ===========================================================================

function fmtDataBR(s) {
  if (!s) return '—'
  const [y, m, d] = s.split('-')
  return `${d}/${m}/${y}`
}

export default function ModalConciliarFatura({ open, onClose, extrato, onConciliado }) {
  const { user } = useAuth()
  const [cartoes, setCartoes] = useState([])
  const [payable, setPayable] = useState([])
  const [cartaoId, setCartaoId] = useState('')
  const [loading, setLoading] = useState(true)
  const [processando, setProcessando] = useState(false)

  // Default mês/ano = mês do débito bancário
  const dataExtrato = extrato?.data?.data || new Date().toISOString().slice(0, 10)
  const [year, month] = useMemo(() => {
    const [y, m] = dataExtrato.split('-')
    return [parseInt(y, 10), parseInt(m, 10) - 1]
  }, [dataExtrato])

  const [ano, setAno] = useState(year)
  const [mes, setMes] = useState(month)
  const [marcados, setMarcados] = useState(new Set())
  const [showEncargo, setShowEncargo] = useState(false)
  const [encargoDesc, setEncargoDesc] = useState('')
  const [encargoCat, setEncargoCat] = useState('Encargos cartão')

  const valorDebito = Math.abs(Number(extrato?.data?.valor || 0))

  const carregar = useCallback(() => {
    if (!user) return
    setLoading(true)
    Promise.all([
      supabase.from('cartoes').select('*').order('updated_at', { ascending: false }),
      supabase.from('payable').select('*'),
    ]).then(([rC, rP]) => {
      const ativos = (rC.data || []).filter(c => c.data?.ativo !== false)
      setCartoes(ativos)
      setPayable((rP.data || []).map(r => ({ ...flatten(r), cartao_id: r.cartao_id })))
      if (ativos.length > 0 && !cartaoId) setCartaoId(ativos[0].id)
      setLoading(false)
    })
  }, [user, cartaoId])

  useEffect(() => { if (open) carregar() }, [open, carregar])

  const cartao = useMemo(() => cartoes.find(c => c.id === cartaoId), [cartoes, cartaoId])
  const periodo = useMemo(() => cartao ? periodoFatura(cartao, ano, mes) : null, [cartao, ano, mes])

  const lancamentos = useMemo(() => {
    if (!cartao || !periodo) return []
    return payable
      .filter(p => p.cartao_id === cartaoId)
      .filter(p => {
        const dataCompra = p.data_competencia || p.due
        return dataCompra && dataCompra >= periodo.ini && dataCompra <= periodo.fim
      })
      .filter(p => p.status !== 'Pago')
      .sort((a, b) => (a.data_competencia || a.due).localeCompare(b.data_competencia || b.due))
  }, [payable, cartao, periodo, cartaoId])

  // Inicializa marcados quando lançamentos chegam
  useEffect(() => {
    setMarcados(new Set(lancamentos.map(l => l.id)))
  }, [lancamentos])

  const somaMarcados = useMemo(
    () => lancamentos.filter(l => marcados.has(l.id)).reduce((s, x) => s + Number(x.value || 0), 0),
    [lancamentos, marcados],
  )
  const diferenca = valorDebito - somaMarcados
  const podeConciliar = Math.abs(diferenca) < 0.02
  const anos = [year, year - 1, year - 2]

  function toggle(id) {
    setMarcados(m => {
      const next = new Set(m)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function lancarEncargo() {
    if (Math.abs(diferenca) < 0.02) { showToast('Diferença é zero, não precisa de encargo.', 'info'); return }
    if (!encargoDesc.trim()) { showToast('Descreva o encargo.', 'warning'); return }
    const payload = {
      user_id: user.id,
      cartao_id: cartaoId,
      data: {
        supplier: 'Cartão',
        desc: encargoDesc.trim(),
        value: Math.abs(diferenca),
        data_competencia: dataExtrato,
        due: periodo?.vencimento || dataExtrato,
        status: 'Pendente',
        cat: encargoCat,
        subcat: '',
        forma_pagamento: 'Cartão Crédito',
        criado_via_conciliacao_fatura: true,
        created: new Date().toISOString().slice(0, 10),
      },
    }
    const { error } = await supabase.from('payable').insert(payload)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast('Encargo lançado.', 'success')
    setShowEncargo(false)
    setEncargoDesc('')
    carregar()
  }

  async function conciliarTudo() {
    if (!podeConciliar) return
    setProcessando(true)
    try {
      const ids = Array.from(marcados)
      // 1) Atualizar cada payable: status=Pago, data_pagamento, conciliado_em
      const agora = new Date().toISOString()
      for (const id of ids) {
        const lanc = lancamentos.find(l => l.id === id)
        if (!lanc) continue
        const merged = {
          ...(lanc._raw?.data || {}),
          ...lanc,
          status: 'Pago',
          data_pagamento: dataExtrato,
        }
        // Remove campos que vieram do flatten e não devem ir pra data jsonb
        delete merged.id
        delete merged.codigo
        delete merged.cartao_id
        await supabase.from('payable').update({
          data: merged,
          conciliado_em: agora,
          extrato_id: extrato.id,
        }).eq('id', id)
      }
      // 2) Atualizar extrato: status=conciliado + guarda lista de ids
      await supabase.from('transacoes_extrato').update({
        status: 'conciliado',
        data: { ...(extrato.data || {}), lancamento_pares_ids: ids, conciliado_como: 'fatura_cartao' },
      }).eq('id', extrato.id)
      showToast(`${ids.length} lançamentos conciliados com o débito.`, 'success')
      onConciliado?.()
      onClose()
    } catch (e) {
      console.error(e)
      showToast('Erro ao conciliar: ' + e.message, 'error')
    } finally {
      setProcessando(false)
    }
  }

  if (!open) return null

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={e => e.stopPropagation()}>
        <div style={header}>
          <h2 style={titulo}>Conciliar com fatura do cartão</h2>
          <button onClick={onClose} style={btnClose}>×</button>
        </div>
        <div style={contexto}>
          <div><strong>Débito no banco:</strong> {fmtDataBR(dataExtrato)} · {fmtMoney(valorDebito)}</div>
          <div style={{ fontSize: 11, color: 'var(--text-mid)', marginTop: 4 }}>{extrato?.data?.descricao || '—'}</div>
        </div>

        {loading ? (
          <div style={emptyState}>Carregando…</div>
        ) : cartoes.length === 0 ? (
          <div style={emptyState}>Nenhum cartão cadastrado. <a href="/cartoes" style={{ color: 'var(--gold)' }}>Cadastrar</a></div>
        ) : (
          <>
            {/* Seletores cartão + mês */}
            <div style={selRow}>
              <Field label="Cartão">
                <select value={cartaoId} onChange={e => setCartaoId(e.target.value)} style={select}>
                  {cartoes.map(c => <option key={c.id} value={c.id}>{c.data?.nome} ({c.data?.bandeira})</option>)}
                </select>
              </Field>
              <Field label="Mês venc.">
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
              <div style={periodoInfo}>
                Fatura {rotuloFatura(ano, mes)} · Período: {fmtDataBR(periodo.ini)} → {fmtDataBR(periodo.fim)}
              </div>
            )}

            {/* Lista */}
            <div style={listaWrap}>
              {lancamentos.length === 0 ? (
                <div style={emptyState}>Nenhum lançamento pendente neste cartão no período.</div>
              ) : (
                <table style={tbl}>
                  <thead>
                    <tr>
                      <th style={{ ...th, width: 30 }}></th>
                      <th style={{ ...th, width: 90 }}>Data</th>
                      <th style={th}>Descrição</th>
                      <th style={th}>Categoria</th>
                      <th style={{ ...th, width: 110, textAlign: 'right' }}>Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lancamentos.map(l => {
                      const marcado = marcados.has(l.id)
                      return (
                        <tr key={l.id} onClick={() => toggle(l.id)} style={{ cursor: 'pointer', background: marcado ? 'var(--white)' : 'rgba(0,0,0,0.03)', opacity: marcado ? 1 : 0.55 }}>
                          <td style={td}>
                            <input type="checkbox" checked={marcado} onChange={() => toggle(l.id)} onClick={e => e.stopPropagation()} />
                          </td>
                          <td style={td}>{fmtDataBR(l.data_competencia || l.due)}</td>
                          <td style={td}>{l.desc || l.supplier || '—'}</td>
                          <td style={{ ...td, color: 'var(--text-mid)' }}>{l.cat || '—'}</td>
                          <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{fmtMoney(l.value)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Resumo */}
            <div style={resumo}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span>Marcados ({marcados.size})</span>
                <span style={{ fontWeight: 700 }}>{fmtMoney(somaMarcados)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span>Débito banco</span>
                <span style={{ fontWeight: 700 }}>{fmtMoney(valorDebito)}</span>
              </div>
              <hr style={{ border: 'none', borderTop: '1px solid var(--cream-dark)', margin: '6px 0' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 700, color: podeConciliar ? 'var(--green)' : 'var(--red)' }}>
                <span>Diferença</span>
                <span>{fmtMoney(diferenca)} {podeConciliar && '✓'}</span>
              </div>
            </div>

            {/* Lançar encargo */}
            {!podeConciliar && !showEncargo && (
              <button onClick={() => setShowEncargo(true)} style={btnSecondary}>+ Lançar encargo/IOF/anuidade pra cobrir diferença</button>
            )}
            {showEncargo && (
              <div style={encargoBox}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-mid)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Lançar encargo de {fmtMoney(Math.abs(diferenca))}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <input value={encargoDesc} onChange={e => setEncargoDesc(e.target.value)} placeholder="Descrição (ex: Juros rotativo)" style={{ ...select, flex: 2 }} />
                  <input value={encargoCat} onChange={e => setEncargoCat(e.target.value)} placeholder="Categoria" style={{ ...select, flex: 1 }} />
                  <button onClick={lancarEncargo} style={btnOk}>Criar</button>
                  <button onClick={() => setShowEncargo(false)} style={btnSecondary}>Cancelar</button>
                </div>
              </div>
            )}

            {/* Ações finais */}
            <div style={acoes}>
              <button onClick={onClose} style={btnSecondary}>Cancelar</button>
              <button onClick={conciliarTudo} disabled={!podeConciliar || processando || marcados.size === 0} style={{ ...btnPrimary, opacity: (podeConciliar && marcados.size > 0 && !processando) ? 1 : 0.5, cursor: (podeConciliar && marcados.size > 0 && !processando) ? 'pointer' : 'not-allowed' }}>
                {processando ? 'Conciliando…' : `✓ Conciliar ${marcados.size} lançamento(s)`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
      <label style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-mid)' }}>{label}</label>
      {children}
    </div>
  )
}

const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,32,62,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }
const modal = { background: 'var(--white)', borderRadius: 12, padding: 24, width: '100%', maxWidth: 800, maxHeight: '90vh', overflowY: 'auto', boxShadow: 'var(--shadow-lg)', fontFamily: 'var(--body)' }
const header = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, paddingBottom: 12, borderBottom: '1px solid var(--cream-dark)' }
const titulo = { margin: 0, fontSize: 18, fontWeight: 600, color: 'var(--navy)' }
const btnClose = { background: 'none', border: 'none', fontSize: 28, color: 'var(--text-mid)', cursor: 'pointer', padding: 0, lineHeight: 1 }
const contexto = { padding: '10px 14px', background: 'var(--cream)', borderRadius: 8, fontSize: 12, marginBottom: 14 }
const selRow = { display: 'flex', gap: 12, marginBottom: 8 }
const select = { padding: '8px 10px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 12, color: 'var(--navy)', background: 'var(--white)', outline: 'none' }
const periodoInfo = { fontSize: 11, color: 'var(--text-mid)', fontStyle: 'italic', marginBottom: 14 }
const listaWrap = { maxHeight: 280, overflowY: 'auto', border: '1px solid var(--cream-dark)', borderRadius: 6, marginBottom: 14 }
const tbl = { width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontFamily: 'var(--body)' }
const th = { textAlign: 'left', padding: '10px 12px', fontSize: 9, fontWeight: 700, letterSpacing: 1.5, color: '#fff', textTransform: 'uppercase', background: 'var(--navy)', borderBottom: '2px solid var(--gold)', position: 'sticky', top: 0, zIndex: 5 }
const td = { padding: '10px 12px', fontSize: 12, color: 'var(--navy)', borderBottom: '1px solid var(--cream-dark)' }
const resumo = { padding: 12, background: 'var(--cream)', borderRadius: 8, marginBottom: 14, fontFamily: 'var(--body)' }
const encargoBox = { padding: 12, background: 'rgba(204,145,94,0.08)', border: '1px dashed var(--gold)', borderRadius: 6, marginBottom: 14 }
const acoes = { display: 'flex', justifyContent: 'flex-end', gap: 8 }
const btnPrimary = { padding: '10px 18px', background: 'var(--gold)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', fontFamily: 'var(--body)' }
const btnSecondary = { padding: '10px 18px', background: 'var(--white)', color: 'var(--navy)', border: '1.5px solid var(--cream-dark)', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'var(--body)' }
const btnOk = { padding: '8px 14px', background: 'var(--green)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 11, fontWeight: 700, fontFamily: 'var(--body)' }
const emptyState = { padding: '40px 24px', textAlign: 'center', color: 'var(--text-mid)', fontSize: 13, background: 'var(--cream)', borderRadius: 8 }
