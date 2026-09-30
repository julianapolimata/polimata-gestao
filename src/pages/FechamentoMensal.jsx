import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { invalidarFechamentos, mesLabel, traduzErroFechamento } from '../lib/fechamento'
import { montarChecklist, PONTAS } from '../lib/fechamentoChecklist'
import { showToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'
import AppLayout from '../components/AppLayout'
import EstadoErro from '../components/EstadoErro'

// =====================================================================
// FECHAMENTO MENSAL — o PORTÃO do mês.
// Checklist DERIVADO DOS DADOS (nada marcado à mão), fechamento em ordem
// cronológica, mês fechado = travado no banco (trigger), reabertura com
// justificativa e log, exceções (avisos aceitos) registradas.
// =====================================================================

const ym = s => (s || '').slice(0, 7)
const mesAtual = () => new Date().toISOString().slice(0, 7)
const fmtDataHora = iso => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function Pill({ tom, children, title }) {
  const cores = {
    ok: { bg: 'rgba(39,174,96,0.10)', cor: 'var(--green)' },
    alerta: { bg: 'rgba(204,145,94,0.14)', cor: 'var(--gold-dark)' },
    ruim: { bg: 'rgba(231,76,60,0.09)', cor: 'var(--red)' },
    navy: { bg: 'rgba(0,32,62,0.08)', cor: 'var(--navy)' },
    vazio: { bg: 'transparent', cor: 'var(--text-mid)' },
  }[tom] || {}
  return (
    <span title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: cores.bg, color: cores.cor, whiteSpace: 'nowrap' }}>
      {children}
    </span>
  )
}

export default function FechamentoMensal() {
  const { user } = useAuth()
  const [extratos, setExtratos] = useState([])
  const [receivable, setReceivable] = useState([])
  const [payable, setPayable] = useState([])
  const [contas, setContas] = useState([])
  const [transferencias, setTransferencias] = useState([])
  const [fechamentos, setFechamentos] = useState([])
  const [nfPend, setNfPend] = useState([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState(null)
  const [aberto, setAberto] = useState(null)   // competência expandida
  const [agindo, setAgindo] = useState(null)   // competência com RPC em andamento

  const carregar = useCallback(() => {
    if (!user) return
    setLoading(true)
    // Selects leves (nada de anexos base64). status do extrato é COLUNA.
    Promise.all([
      supabase.from('transacoes_extrato').select('id, conta_id, status, dt:data->>data, tipo:data->>tipo, valor:data->>valor, rev:data->>revisar, fv:data->>fatura_vencimento'),
      supabase.from('receivable').select('id, codigo, conciliado_em, due:data->>due, comp:data->>data_competencia, st:data->>status, esc:data->>escriturado, doc:data->>doc_status, sus:data->>suspense, val:data->>value'),
      supabase.from('payable').select('id, codigo, conciliado_em, due:data->>due, comp:data->>data_competencia, st:data->>status, esc:data->>escriturado, doc:data->>doc_status, sus:data->>suspense, val:data->>value, cat:data->>cat, cartao_id, fat:data->>criado_via_import_fatura'),
      supabase.from('contas_bancarias').select('id,data'),
      supabase.from('transferencias').select('*'),
      supabase.from('fechamentos').select('*'),
      supabase.from('nf_pending').select('id,status,created_at').eq('status', 'pendente'),
    ]).then(([e, r, p, c, t, f, nf]) => {
      const err = e.error || r.error || p.error || c.error || t.error || f.error || nf.error
      if (err) { setErro(err); setLoading(false); return }
      setErro(null)
      setExtratos(e.data || [])
      setReceivable(r.data || [])
      setPayable(p.data || [])
      setContas(c.data || [])
      setTransferencias(t.data || [])
      setFechamentos(f.data || [])
      setNfPend(nf.data || [])
      setLoading(false)
    }).catch(err => { setErro(err); setLoading(false) })
  }, [user])
  useEffect(() => { carregar() }, [carregar])

  // Meses: do primeiro movimento até o mês corrente, ordem CRESCENTE.
  const meses = useMemo(() => {
    const movs = new Set()
    for (const e of extratos) { const k = ym(e.dt); if (k) movs.add(k) }
    for (const l of [...receivable, ...payable]) { const k = ym(l.comp || l.due); if (k) movs.add(k) }
    for (const f of fechamentos) if (f.competencia) movs.add(f.competencia)
    const hoje = mesAtual()
    const lista = []
    if (movs.size) {
      let cur = [...movs].sort()[0]
      let guard = 0
      while (cur <= hoje && guard++ < 600) {
        lista.push(cur)
        const [y, m] = cur.split('-').map(Number)
        const d = new Date(y, m, 1)
        cur = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      }
    }
    const temFechamento = fechamentos.length > 0
    const ctx = { extratos, receivable, payable, contas, transferencias, fechamentos, nfPend, temFechamento, mesesComMovimento: movs }
    return lista.map(comp => {
      const items = montarChecklist(comp, ctx)
      const reg = fechamentos.find(f => f.competencia === comp)
      const obrigFalta = items.filter(i => i.obrigatorio && !i.ok)
      const avisosFalta = items.filter(i => !i.obrigatorio && !i.ok)
      let estado
      if (reg?.status === 'fechado') estado = 'fechado'
      else if (reg?.status === 'reaberto') estado = 'reaberto'
      else if (comp >= hoje) estado = 'corrente'
      else if (obrigFalta.length === 0) estado = 'pronto'
      else estado = 'pendente'
      // mês reaberto que já está pronto de novo pode ser fechado
      const podeFechar = (estado === 'pronto' || (estado === 'reaberto' && obrigFalta.length === 0)) && comp < hoje
      return { comp, items, reg, obrigFalta, avisosFalta, estado, podeFechar }
    })
  }, [extratos, receivable, payable, contas, transferencias, fechamentos, nfPend])

  // O ano de relance + qual é o PRÓXIMO mês a fechar.
  const anoAtual = String(new Date().getFullYear())
  const resumoAno = useMemo(() => {
    const doAno = meses.filter(m => m.comp.startsWith(anoAtual))
    const fechados = doAno.filter(m => m.estado === 'fechado')
    // Cronológico: o próximo é o mais antigo que ainda não fechou e já terminou.
    const proximo = meses.find(m => m.estado !== 'fechado' && m.estado !== 'corrente')
    const trava = proximo ? proximo.obrigFalta : []
    const porPonta = ponta => trava.filter(i => i.ponta === ponta)
    return { doAno, fechados, proximo, trava, porPonta }
  }, [meses, anoAtual])

  const revisarCount = useMemo(() => (extratos || []).filter(e => e.rev === 'true' || e.rev === true).length, [extratos])

  // ── Ações ────────────────────────────────────────────────────────────
  const [confirmar, dialogoConfirmacao] = useConfirm()

  async function fechar(m) {
    const excecoes = m.avisosFalta.map(i => ({ key: i.key, label: i.label, detalhe: i.detalhe }))
    const ok = await confirmar({
      titulo: `Fechar ${mesLabel(m.comp)}?`,
      texto: excecoes.length
        ? `Há ${excecoes.length} pendência(s) que ficarão registradas como exceção do fechamento.`
        : 'O mês está sem pendências.',
      consequencias: [
        ...excecoes.map(x => `Exceção registrada: ${x.label} — ${x.detalhe}`),
        'Depois de fechado, o mês é travado no banco: nem o sistema consegue alterar lançamento dele.',
        'Só continuam liberadas a baixa de pagamento ou recebimento e a prova fiscal.',
        'Reabrir depois é possível, mas exige justificativa e fica no registro.',
      ],
      confirmarLabel: `Fechar ${mesLabel(m.comp)}`,
      width: 560,
    })
    if (!ok) return
    setAgindo(m.comp)
    try {
      const { error } = await supabase.rpc('fechar_mes', {
        p_competencia: m.comp,
        p_checklist: { items: m.items.map(({ key, label, ok, obrigatorio, detalhe }) => ({ key, label, ok, obrigatorio, detalhe })) },
        p_excecoes: excecoes,
      })
      if (error) throw error
      invalidarFechamentos()
      showToast(`${mesLabel(m.comp)} fechado. 🔒`, 'success')
      carregar()
    } catch (e) {
      showToast(traduzErroFechamento(e) || e.message || 'Erro ao fechar.', 'error')
    } finally { setAgindo(null) }
  }

  async function reabrir(m) {
    const just = await confirmar({
      titulo: `Reabrir ${mesLabel(m.comp)}?`,
      texto: 'O mês volta a aceitar alterações.',
      consequencias: [
        'A trava do banco sai: lançamentos daquele mês voltam a poder mudar.',
        'Números já apurados a partir dele (DRE, impostos) podem mudar junto.',
        'A justificativa abaixo fica registrada com a data e quem reabriu.',
      ],
      exigeTexto: {
        label: 'Por que precisa reabrir?',
        minimo: 10,
        placeholder: 'Ex.: nota de setembro chegou depois do fechamento e precisa entrar na competência certa',
      },
      confirmarLabel: 'Reabrir o mês',
      variante: 'perigo',
      width: 560,
    })
    if (!just) return
    setAgindo(m.comp)
    try {
      const { error } = await supabase.rpc('reabrir_mes', { p_competencia: m.comp, p_justificativa: just.trim() })
      if (error) throw error
      invalidarFechamentos()
      showToast(`${mesLabel(m.comp)} reaberto. 🔓`, 'warning')
      carregar()
    } catch (e) {
      showToast(traduzErroFechamento(e) || e.message || 'Erro ao reabrir.', 'error')
    } finally { setAgindo(null) }
  }

  // ── Render ───────────────────────────────────────────────────────────
  if (loading) return <AppLayout title="Fechamento Mensal"><div style={emptyState}>Carregando…</div></AppLayout>
  if (erro) return <AppLayout title="Fechamento Mensal"><EstadoErro onRetry={carregar} /></AppLayout>

  const estadoPill = m => {
    switch (m.estado) {
      case 'fechado': return <Pill tom="navy" title={m.reg?.fechado_por || ''}>🔒 Fechado {m.reg?.fechado_em ? fmtDataHora(m.reg.fechado_em).slice(0, 5) : ''}{m.reg?.fechado_por ? ` por ${m.reg.fechado_por}` : ''}</Pill>
      case 'reaberto': return <Pill tom="alerta">🔓 Reaberto</Pill>
      case 'pronto': return <Pill tom="ok">✅ Pronto pra fechar</Pill>
      case 'corrente': return <Pill tom="vazio">⏳ Mês corrente</Pill>
      default: return <Pill tom="ruim">⚠️ {m.obrigFalta.length} pendência(s)</Pill>
    }
  }

  return (
    <AppLayout title="Fechamento Mensal">
      <div style={{ fontSize: 12, color: 'var(--text-mid)', marginBottom: 16, lineHeight: 1.6 }}>
        O fechamento é o <strong>portão do mês</strong>: o checklist é <strong>detectado dos dados</strong> (nada marcado à mão) e o mês
        só fecha em <strong>ordem cronológica</strong> — o mais antigo primeiro. Mês fechado fica <strong>travado</strong>: não entra, não sai
        e não muda lançamento, extrato nem transferência daquela competência. O que ainda pode mudar num mês fechado: <em>baixa de
        pagamento/recebimento</em> (status e data) e <em>prova fiscal</em> (NF, anexo, situação do documento). Pra mexer em outra coisa,
        reabra com justificativa — fica no log.
        <span style={{ marginLeft: 6 }}><span style={{ color: 'var(--red)' }}>vermelho = obrigatório faltando</span> · <span style={{ color: 'var(--gold-dark)' }}>dourado = aviso (vira exceção registrada)</span> · <span style={{ color: 'var(--green)' }}>verde = ok</span></span>
      </div>

      {meses.length > 0 && (
        <div style={painelAno}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <div style={painelTitulo}>Seu {anoAtual}</div>
            <div style={{ fontSize: 12, color: 'var(--text-mid)' }}>
              <strong style={{ color: 'var(--navy)' }}>{resumoAno.fechados.length}</strong> de {resumoAno.doAno.length} mês(es) fechado(s)
            </div>
          </div>

          {!resumoAno.proximo ? (
            <div style={{ marginTop: 8, fontSize: 13, color: 'var(--green)', fontWeight: 600 }}>
              ✅ Nenhum mês em aberto. O ano está fechado até aqui.
            </div>
          ) : resumoAno.trava.length === 0 ? (
            <div style={{ marginTop: 8, fontSize: 13, color: 'var(--green)', fontWeight: 600 }}>
              ✅ <strong>{mesLabel(resumoAno.proximo.comp)}</strong> está pronto pra fechar — é o próximo da fila.
            </div>
          ) : (
            <>
              <div style={{ marginTop: 8, fontSize: 13, color: 'var(--navy)' }}>
                O próximo da fila é <strong>{mesLabel(resumoAno.proximo.comp)}</strong>. Enquanto ele não fechar, nenhum mês
                depois dele fecha — o fechamento anda em ordem. Falta:
              </div>
              <div style={pontasGrid}>
                {PONTAS.filter(pt => resumoAno.porPonta(pt.id).length > 0).map(pt => (
                  <div key={pt.id} style={pontaCard}>
                    <div style={pontaLabel}>{pt.label}</div>
                    <div style={pontaSub}>{pt.sub}</div>
                    {resumoAno.porPonta(pt.id).map(i => (
                      <div key={i.key} style={{ marginTop: 7, fontSize: 12 }}>
                        <span style={{ color: 'var(--red)', fontWeight: 600 }}>{i.label}</span>
                        <span style={{ color: 'var(--text-mid)' }}> — {i.detalhe}</span>
                        {i.link && i.link !== '/fechamento-mensal' && (
                          <> <Link to={i.link} style={linkResolver}>resolver →</Link></>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {revisarCount > 0 && (
        <div style={{ marginBottom: 16, padding: 12, borderRadius: 8, background: 'rgba(204,145,94,0.12)', borderLeft: '3px solid var(--gold-dark)', color: 'var(--gold-dark)', fontSize: 13, fontWeight: 600 }}>
          ⚠️ Ação pendente: {revisarCount} linha(s) do extrato marcada(s) para revisar (ex.: possível Pix duplicado). Resolva na tela de <strong>Conciliação</strong> — procure o selo <strong>⚠️ REVISAR</strong>.
        </div>
      )}

      <div style={tableCard}>
        {meses.length === 0 ? (
          <div style={emptyState}>Nenhum movimento ainda. Importe um extrato ou lance contas pra ver o fechamento por mês.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={tbl}>
              <thead>
                <tr>
                  <th style={{ ...th, width: 90 }}>Mês</th>
                  <th style={{ ...th, width: 260 }}>Estado</th>
                  <th style={th}>Checklist</th>
                  <th style={{ ...th, width: 200, textAlign: 'right' }}></th>
                </tr>
              </thead>
              <tbody>
                {meses.map(m => {
                  const exp = aberto === m.comp
                  return (
                    <Fragment key={m.comp}>
                      <tr onClick={() => setAberto(exp ? null : m.comp)} style={{ cursor: 'pointer', background: exp ? 'rgba(0,32,62,0.025)' : undefined }} title={exp ? 'Recolher' : 'Ver o checklist completo'}>
                        <td style={{ ...td, fontWeight: 700, color: 'var(--navy)', whiteSpace: 'nowrap' }}>
                          <span style={{ display: 'inline-block', width: 14, color: 'var(--text-mid)', fontSize: 11 }}>{exp ? '▾' : '▸'}</span>{mesLabel(m.comp)}
                        </td>
                        <td style={td}>{estadoPill(m)}</td>
                        <td style={td}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                            {m.items.map(i => (
                              <Pill key={i.key} tom={i.ok ? 'ok' : i.obrigatorio ? 'ruim' : 'alerta'} title={i.detalhe}>
                                {i.ok ? '✓' : i.obrigatorio ? '✕' : '!'} {i.label}
                              </Pill>
                            ))}
                          </div>
                        </td>
                        <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                          {m.podeFechar && (
                            <button onClick={() => fechar(m)} disabled={agindo === m.comp} style={btnFechar}>
                              {agindo === m.comp ? 'Fechando…' : `🔒 Fechar ${mesLabel(m.comp)}`}
                            </button>
                          )}
                          {m.estado === 'fechado' && (
                            <button onClick={() => reabrir(m)} disabled={agindo === m.comp} style={btnReabrir}>
                              {agindo === m.comp ? 'Reabrindo…' : '↻ Reabrir com justificativa'}
                            </button>
                          )}
                        </td>
                      </tr>
                      {exp && (
                        <tr>
                          <td colSpan={4} style={{ ...td, background: 'var(--cream)', padding: '14px 18px 16px 40px' }}>
                            {m.estado === 'reaberto' && m.reg?.justificativa && (
                              <div style={{ ...caixaAviso, marginBottom: 12 }}>
                                🔓 <strong>Reaberto</strong>{m.reg.reaberto_em ? ` em ${fmtDataHora(m.reg.reaberto_em)}` : ''} — motivo: <em>{m.reg.justificativa}</em>. Quando terminar, feche de novo.
                              </div>
                            )}
                            {m.estado === 'corrente' && (
                              <div style={{ fontSize: 11, color: 'var(--text-mid)', marginBottom: 10 }}>⏳ O mês ainda não terminou — o checklist vai se atualizando; o botão de fechar aparece no mês seguinte.</div>
                            )}
                            {PONTAS.filter(pt => m.items.some(i => i.ponta === pt.id)).map(pt => (
                              <div key={pt.id} style={{ marginBottom: 10 }}>
                                <div style={tituloPonta}>
                                  {pt.label}
                                  <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--text-mid)' }}> — {pt.sub}</span>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 220px) 1fr auto', gap: '6px 14px', alignItems: 'center', fontSize: 12 }}>
                                  {m.items.filter(i => i.ponta === pt.id).map(i => (
                                    <Fragment key={i.key}>
                                      <div style={{ fontWeight: 600, color: i.ok ? 'var(--green)' : i.obrigatorio ? 'var(--red)' : 'var(--gold-dark)' }}>
                                        {i.ok ? '✅' : i.obrigatorio ? '🔴' : '⚠️'} {i.label}
                                        {!i.obrigatorio && <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--text-mid)', marginLeft: 6 }}>aviso</span>}
                                      </div>
                                      <div style={{ color: 'var(--navy)' }}>{i.detalhe}</div>
                                      <div style={{ textAlign: 'right' }}>
                                        {!i.ok && i.link && i.link !== '/fechamento-mensal' && <Link to={i.link} style={linkResolver}>resolver →</Link>}
                                      </div>
                                    </Fragment>
                                  ))}
                                </div>
                              </div>
                            ))}

                            {m.estado === 'pendente' && (
                              <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text-mid)' }}>
                                Falta resolver <strong style={{ color: 'var(--red)' }}>{m.obrigFalta.map(i => i.label).join(', ')}</strong> pra liberar o fechamento.
                                {m.avisosFalta.length > 0 && <> Os avisos não travam — ficam registrados como exceção.</>}
                              </div>
                            )}
                            {m.podeFechar && m.avisosFalta.length > 0 && (
                              <div style={{ marginTop: 12, fontSize: 11, color: 'var(--gold-dark)' }}>
                                Ao fechar, {m.avisosFalta.length} aviso(s) ficam registrados como <strong>exceção aceita</strong>: {m.avisosFalta.map(i => i.label).join(', ')}.
                              </div>
                            )}

                            {(m.estado === 'fechado' || m.estado === 'reaberto') && m.reg && (
                              <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                                <div>
                                  <div style={subTitulo}>Exceções aceitas no fechamento</div>
                                  {Array.isArray(m.reg.excecoes) && m.reg.excecoes.length ? (
                                    <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11, color: 'var(--navy)', lineHeight: 1.6 }}>
                                      {m.reg.excecoes.map((x, i) => <li key={i}><strong>{x.label || x.key}</strong>{x.detalhe ? ` — ${x.detalhe}` : ''}</li>)}
                                    </ul>
                                  ) : <div style={{ fontSize: 11, color: 'var(--text-mid)' }}>nenhuma — fechou com tudo ok</div>}
                                </div>
                                <div>
                                  <div style={subTitulo}>Log</div>
                                  {Array.isArray(m.reg.log) && m.reg.log.length ? (
                                    <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11, color: 'var(--navy)', lineHeight: 1.6 }}>
                                      {[...m.reg.log].reverse().map((l, i) => (
                                        <li key={i}>
                                          {l.acao === 'reabrir' ? '🔓 Reaberto' : '🔒 Fechado'} {fmtDataHora(l.em)}{l.por ? ` · ${l.por}` : ''}
                                          {l.justificativa ? <> — <em>{l.justificativa}</em></> : null}
                                          {Array.isArray(l.excecoes) && l.excecoes.length ? ` · ${l.excecoes.length} exceção(ões)` : ''}
                                        </li>
                                      ))}
                                    </ul>
                                  ) : <div style={{ fontSize: 11, color: 'var(--text-mid)' }}>{m.reg.fechado_em ? `🔒 Fechado ${fmtDataHora(m.reg.fechado_em)}${m.reg.fechado_por ? ` · ${m.reg.fechado_por}` : ''}` : '—'}</div>}
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={notaBox}>
        <strong>Como o sistema decide:</strong> competência do lançamento = data de emissão (competência) ou, sem ela, o vencimento ·
        <em> Extrato importado</em> = cada conta bancária ativa tem linhas no mês · <em>Conciliação completa</em> = nenhuma linha do extrato pendente (cartão incluído) ·
        <em> Escrituração completa</em> = nenhum lançamento do mês a escriturar · <em>Nenhuma nota a chegar / Sem suspense</em> = nenhum lançamento nesses estados ·
        <em> Contas do mês liquidadas</em> = tudo com vencimento no mês já pago/recebido · <em>Fatura do cartão paga</em> = compras com vencimento no mês ≤ transferências pro cartão no mês ·
        <em> DAS / impostos</em> = guias que a empresa recolhe (DAS, INSS/FGTS, taxas) já pagas · <em>Caixa de entrada</em> = NFs lidas do e-mail até o fim do mês já revisadas ·
        <em> Mês anterior fechado</em> = ordem cronológica. Provisões não contam. Obrigatórios travam o botão; avisos viram exceção registrada.
      </div>
    {dialogoConfirmacao}
    </AppLayout>
  )
}

const painelAno = { background: 'var(--white)', border: '1px solid var(--cream-dark)', borderLeft: '3px solid var(--navy)', borderRadius: 10, padding: '14px 16px', marginBottom: 16, boxShadow: 'var(--shadow)' }
const painelTitulo = { fontSize: 15, fontWeight: 700, color: 'var(--navy)', fontFamily: 'var(--heading, var(--body))' }
const pontasGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, marginTop: 12 }
const pontaCard = { background: 'var(--cream)', borderRadius: 8, padding: '10px 12px' }
const pontaLabel = { fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--navy)' }
const pontaSub = { fontSize: 10.5, color: 'var(--text-mid)', marginTop: 1 }
const tituloPonta = { fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--navy)', marginBottom: 6 }
const tableCard = { background: 'var(--white)', borderRadius: 12, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)', overflow: 'hidden' }
const tbl = { width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--body)' }
const th = { textAlign: 'left', fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--text-mid)', padding: '14px 18px', borderBottom: '1px solid var(--cream-dark)', background: 'var(--cream)' }
const td = { padding: '13px 18px', fontSize: 13, color: 'var(--navy)', borderBottom: '1px solid var(--cream-dark)', verticalAlign: 'middle' }
const emptyState = { padding: '60px 24px', textAlign: 'center', fontFamily: 'var(--body)', color: 'var(--text-mid)', fontSize: 13 }
const notaBox = { marginTop: 16, padding: 14, borderRadius: 8, background: 'rgba(0,32,62,0.03)', border: '1px solid var(--cream-dark)', fontSize: 11, color: 'var(--text-mid)', lineHeight: 1.7 }
const caixaAviso = { padding: 10, borderRadius: 8, background: 'rgba(204,145,94,0.12)', borderLeft: '3px solid var(--gold-dark)', color: 'var(--navy)', fontSize: 12 }
const subTitulo = { fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--text-mid)', marginBottom: 6 }
const linkResolver = { color: 'var(--gold-dark)', fontWeight: 700, fontSize: 11, textDecoration: 'none', whiteSpace: 'nowrap' }
const btnFechar = { padding: '8px 14px', border: 'none', borderRadius: 6, background: 'var(--navy)', color: '#fff', fontFamily: 'var(--body)', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }
const btnReabrir = { padding: '8px 14px', border: '1.5px solid var(--gold)', borderRadius: 6, background: 'var(--white)', color: 'var(--gold-dark)', fontFamily: 'var(--body)', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }
