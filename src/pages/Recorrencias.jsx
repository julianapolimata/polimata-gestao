import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import AppLayout from '../components/AppLayout'
import EstadoErro from '../components/EstadoErro'
import { showToast } from '../components/Toast'
import ModalRecorrencia from './components/ModalRecorrencia'
import { fmtMoney, fmtDate } from '../lib/finance'
import { FREQUENCIAS, proximaOcorrencia, valorMensalEquivalente } from '../lib/recorrencias'
import { gerarProvisoesDoMes } from '../lib/gerarRecorrencias'

// =====================================================================
// RECORRÊNCIAS — mestre por série (não gera 12 linhas). Aqui é o cadastro
// e a projeção da próxima ocorrência. A materialização em Receber/Pagar é
// passo à parte (com confirmação), pra não criar lançamento sem OK.
// =====================================================================

const freqLabel = v => FREQUENCIAS.find(f => f.v === v)?.l || v

export default function Recorrencias() {
  const { user } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [edicao, setEdicao] = useState(null)
  const [gerando, setGerando] = useState(false)

  const carregar = useCallback(() => {
    if (!user) return
    setLoading(true)
    supabase.from('recurring_masters').select('*').order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) { setErro(error); setRows([]) }
        else { setErro(null); setRows(data || []) }
        setLoading(false)
      })
      .catch(e => { setErro(e); setLoading(false) })
  }, [user])

  useEffect(() => { carregar() }, [carregar])

  const resumo = useMemo(() => {
    let receita = 0, despesa = 0
    for (const r of rows) {
      if (r.data?.ativo === false) continue
      const mensal = valorMensalEquivalente(r)
      if (r.data?.tipo === 'despesa') despesa += mensal
      else receita += mensal
    }
    return { receita, despesa, saldo: receita - despesa }
  }, [rows])

  async function gerar() {
    if (!user) return
    setGerando(true)
    try {
      const { criadas } = await gerarProvisoesDoMes(user.id)
      if (criadas > 0) showToast(`${criadas} provisão(ões) do mês criada(s) — veja em Contas a Receber/Pagar.`, 'success')
      else showToast('Nenhuma provisão nova — as deste mês já estão criadas.', 'info')
      carregar()
    } catch (e) {
      showToast('Erro ao gerar provisões: ' + (e?.message || e), 'error')
    } finally {
      setGerando(false)
    }
  }

  function nova() { setEdicao(null); setModalOpen(true) }
  function editar(r) { setEdicao(r); setModalOpen(true) }
  async function excluir(r) {
    if (!confirm(`Excluir a recorrência "${r.data?.descricao || ''}"? A projeção dela some do Fluxo. Lançamentos já criados não são afetados.`)) return
    const { error } = await supabase.from('recurring_masters').delete().eq('id', r.id)
    if (error) { showToast('Erro ao excluir: ' + error.message, 'error'); return }
    showToast('Recorrência excluída.', 'info')
    carregar()
  }

  if (loading) return <AppLayout title="Recorrências"><div style={emptyState}>Carregando…</div></AppLayout>
  if (erro) return <AppLayout title="Recorrências"><EstadoErro onRetry={carregar} /></AppLayout>

  return (
    <AppLayout title="Recorrências">
      {/* Resumo mensal */}
      <div style={resumoGrid}>
        <ResumoCard label="Receita recorrente / mês" valor={resumo.receita} cor="var(--green)" />
        <ResumoCard label="Despesa recorrente / mês" valor={resumo.despesa} cor="var(--red)" />
        <ResumoCard label="Resultado recorrente / mês" valor={resumo.saldo} cor={resumo.saldo >= 0 ? 'var(--navy)' : 'var(--red)'} />
      </div>

      <div style={tableCard}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px 14px', borderBottom: '1px solid var(--cream-dark)' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--navy)' }}>Recorrências cadastradas</div>
            <div style={{ fontSize: 11, color: 'var(--text-mid)', marginTop: 2 }}>Cada uma projeta as próximas ocorrências no Fluxo — sem gerar 12 linhas soltas.</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            {rows.length > 0 && (
              <button type="button" onClick={gerar} disabled={gerando} style={btnGhost} title="Cria os lançamentos de Provisão deste mês a partir das recorrências ativas">
                {gerando ? 'Gerando…' : 'Gerar provisões do mês'}
              </button>
            )}
            <button type="button" onClick={nova} style={btnNovo}>+ Nova recorrência</button>
          </div>
        </div>

        {rows.length === 0 ? (
          <div style={emptyState}>Nenhuma recorrência cadastrada. Cadastre a mensalidade de um cliente ou uma despesa fixa pra começar.</div>
        ) : (
          <table style={tbl}>
            <thead>
              <tr>
                <th style={th}>Descrição</th>
                <th style={{ ...th, width: 90 }}>Tipo</th>
                <th style={{ ...th, width: 150, textAlign: 'right' }}>Valor</th>
                <th style={{ ...th, width: 110 }}>Frequência</th>
                <th style={{ ...th, width: 120 }}>Próxima</th>
                <th style={{ ...th, width: 80 }}>Status</th>
                <th style={{ ...th, width: 130 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const d = r.data || {}
                const isReceita = d.tipo !== 'despesa'
                const prox = proximaOcorrencia(r)
                const inativa = d.ativo === false
                return (
                  <tr key={r.id} style={inativa ? { opacity: 0.55 } : undefined}>
                    <td style={td}>
                      <div style={{ fontWeight: 600, color: 'var(--navy)' }}>{d.descricao || '—'}</div>
                      {d.parte && <div style={{ fontSize: 11, color: 'var(--text-mid)' }}>{d.parte}</div>}
                    </td>
                    <td style={td}>
                      <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: isReceita ? 'var(--green)' : 'var(--red)' }}>
                        {isReceita ? 'Receita' : 'Despesa'}
                      </span>
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: isReceita ? 'var(--green)' : 'var(--red)' }}>{fmtMoney(d.valor)}</td>
                    <td style={{ ...td, color: 'var(--text-mid)' }}>{freqLabel(d.frequencia)}</td>
                    <td style={{ ...td, color: 'var(--text-mid)' }}>{inativa ? '—' : fmtDate(prox)}</td>
                    <td style={td}>
                      {inativa
                        ? <span style={badgeInativo}>Pausada</span>
                        : <span style={badgeAtivo}>Ativa</span>}
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      <button type="button" onClick={() => editar(r)} style={btnMini}>Editar</button>
                      <button type="button" onClick={() => excluir(r)} style={{ ...btnMini, color: 'var(--red)', marginLeft: 6 }}>Excluir</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <div style={notaBox}>
        As recorrências <strong>ainda não geram lançamentos sozinhas</strong> — por enquanto elas servem de cadastro e projeção.
        A geração automática do lançamento de cada mês (pra você marcar pago/recebido e emitir NF) é o próximo passo, e a gente liga isso com o seu OK.
      </div>

      <ModalRecorrencia open={modalOpen} onClose={() => setModalOpen(false)} registro={edicao} onSaved={carregar} />
    </AppLayout>
  )
}

function ResumoCard({ label, valor, cor }) {
  return (
    <div style={resumoCard}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-mid)' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: cor, marginTop: 6, fontFamily: 'var(--body)' }}>{fmtMoney(valor)}</div>
    </div>
  )
}

const resumoGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 18 }
const resumoCard = { background: 'var(--white)', borderRadius: 12, padding: 18, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)' }
const tableCard = { background: 'var(--white)', borderRadius: 12, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)', overflow: 'clip', marginBottom: 18 }
const tbl = { width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--body)' }
const th = { textAlign: 'left', padding: '12px 14px', fontSize: 9, fontWeight: 700, letterSpacing: 1.5, color: '#fff', textTransform: 'uppercase', background: 'var(--navy)', borderBottom: '2px solid var(--gold)' }
const td = { padding: '12px 14px', fontSize: 12, color: 'var(--navy)', borderBottom: '1px solid var(--cream-dark)', verticalAlign: 'middle' }
const btnNovo = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 6, border: 'none', background: 'var(--gold)', color: '#fff', fontFamily: 'var(--body)', fontSize: 12, fontWeight: 700, letterSpacing: 0.5, cursor: 'pointer', textTransform: 'uppercase', flexShrink: 0 }
const btnGhost = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 6, border: '1.5px solid var(--cream-dark)', background: 'var(--white)', color: 'var(--navy)', fontFamily: 'var(--body)', fontSize: 12, fontWeight: 600, letterSpacing: 0.5, cursor: 'pointer', flexShrink: 0 }
const btnMini = { padding: '6px 12px', borderRadius: 5, border: '1px solid var(--cream-dark)', background: 'var(--white)', color: 'var(--navy)', fontFamily: 'var(--body)', fontSize: 11, fontWeight: 600, cursor: 'pointer' }
const badgeAtivo = { fontSize: 9, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', background: 'rgba(204,145,94,0.14)', color: 'var(--gold-dark)', padding: '3px 9px', borderRadius: 999 }
const badgeInativo = { fontSize: 9, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', background: 'rgba(0,0,0,0.05)', color: 'var(--text-mid)', padding: '3px 9px', borderRadius: 999 }
const notaBox = { fontSize: 12, color: 'var(--navy)', background: 'rgba(204,145,94,0.08)', borderLeft: '3px solid var(--gold)', borderRadius: 6, padding: '12px 16px', lineHeight: 1.5 }
const emptyState = { padding: '48px 24px', textAlign: 'center', fontFamily: 'var(--body)', color: 'var(--text-mid)', fontSize: 13 }
