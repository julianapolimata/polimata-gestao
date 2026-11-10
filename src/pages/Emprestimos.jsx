import { useCallback, useEffect, useMemo, useState } from 'react'
import { msgErro } from '../lib/erros'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import AppLayout from '../components/AppLayout'
import EstadoErro from '../components/EstadoErro'
import { showToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'
import { fmtMoney } from '../lib/finance'
import ModalEmprestimo from './components/ModalEmprestimo'
import ModalParcelas from './components/ModalParcelas'
import { linhasDeParcelas } from '../lib/parcelasEmprestimo'
import { consolidarContratos } from '../lib/contratoVisao'

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
// A consolidação das parcelas mora em lib/contratoVisao.js, com prova própria
// (provas/contrato-visao.mjs). O que ela devolve por contrato: PRINCIPAL e
// JUROS, cada um com previsto e realizado.
//
// A verdade das parcelas está em Contas a Pagar (payable.emprestimo_id). O
// que foi digitado no cadastro é só o ponto de partida para gerar as parcelas
// — depois disso, congela.
// =============================================================================

export default function Emprestimos() {
  const { user } = useAuth()
  const [rows, setRows] = useState([])
  const [reais, setReais] = useState({}) // emprestimo_id → { total, pagas, saldo, proxima }
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState(null)
  const [busca, setBusca] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [edicao, setEdicao] = useState(null)
  const [gerando, setGerando] = useState(null)
  // O contrato cujas parcelas estão abertas no pop-up. A contagem "5/36" é um
  // resumo, e resumo sem detalhe obriga a confiar: aqui ela vê quais cinco.
  const [vendoParcelas, setVendoParcelas] = useState(null)

  const recarregar = useCallback(() => {
    if (!user) return
    setLoading(true)
    Promise.all([
      supabase.from('emprestimos_financiamentos').select('*').order('created_at', { ascending: false }),
      // Parcelas reais em Contas a Pagar (só o que precisamos — nada de data inteiro).
      supabase.from('payable')
        // `subcat` separa amortização de juros; `ajuste_tipo` reconhece o
        // juro que nasceu na conciliação, e que nenhum cronograma previu.
        .select('id, emprestimo_id, due:data->>due, st:data->>status, val:data->>value, num:data->>parcela_atual, subcat:data->>subcat, ajuste_tipo:data->>ajuste_tipo')
        .not('emprestimo_id', 'is', null),
    ])
      .then(([rE, rP]) => {
        if (rE.error) { setErro(rE.error); setRows([]) }
        // Os campos do empréstimo (nome, tipo, saldo_atual, parcelas…) vivem em
        // data — o flatten genérico não os expõe. Levantamos data pro topo aqui.
        else { setErro(null); setRows((rE.data || []).map(r => ({ ...r, ...r.data }))) }
        // Parcelas: erro aqui não derruba a tela — cai no valor digitado (com selo).
        if (rP.error) { console.warn('parcelas de empréstimo:', rP.error.message); setReais({}) }
        else setReais(consolidarContratos(rP.data))
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
      return {
        real: true,
        // O SALDO DEVEDOR é o principal em aberto, e só ele. Juros a apropriar
        // são o custo de carregar a dívida: viram despesa conforme o tempo
        // passa, e não são dívida hoje.
        saldo: real.principal.emAberto,
        principal: real.principal, juros: real.juros,
        pagas: real.pagas, total: real.total, proxima: real.proxima,
      }
    }
    // ── SEM PARCELAS LANÇADAS NÃO HÁ SALDO APURADO ────────────────────
    //
    // O que existe é o número que alguém digitou no cadastro, e ele não se
    // corrige sozinho: o Parcelamento do Simples Nacional mostrava ZERO de 36
    // parcelas pagas, com os pagamentos no extrato. Os três contratos juntos
    // carregavam R$ 38.345,11 assim.
    //
    // Então o número digitado para de se chamar saldo. Ele vira "declarado",
    // fica em outro campo, e a tela diz que o saldo não foi apurado — que é
    // uma informação diferente de um valor errado com um selo ao lado.
    const proxSnapshot = (r.parcelas || []).find(p => !p.pago)?.vencimento || null
    return {
      real: false, saldo: null,
      declarado: Number(r.saldo_atual || 0),
      pagas: Number(r.parcelas_pagas || 0), total: Number(r.parcelas_total || 0),
      proxima: proxSnapshot,
      // Dá para gerar as parcelas? Só quando o cronograma está lá.
      cronograma: (r.parcelas || []).length,
    }
  }, [reais])

  const totais = useMemo(() => {
    const ativos = filtrados.filter(r => r.status !== 'quitada')
    // Somar o apurado com o declarado daria um total que não é nenhum dos
    // dois. Eles ficam separados, e o segundo diz de onde veio.
    let saldo = 0, declarado = 0, parcelas = 0, informados = 0
    for (const r of ativos) {
      const v = visao(r)
      if (v.real) saldo += v.saldo
      else { declarado += v.declarado || 0; informados += 1 }
      parcelas += Math.max(0, v.total - v.pagas)
    }
    return { saldo, declarado, parcelas, count: ativos.length, informados }
  }, [filtrados, visao])

  function abrirNovo() { setEdicao(null); setModalOpen(true) }
  function abrirEdicao(row) { setEdicao(row); setModalOpen(true) }

  const [confirmar, dialogoConfirmacao] = useConfirm()

  // ── GERAR AS PARCELAS DE UM CONTRATO QUE JÁ EXISTE ────────────────────
  //
  // Na criação, as parcelas nascem junto. O contrato que já está cadastrado e
  // ficou sem elas não tinha caminho nenhum — e é esse contrato que mostra
  // saldo declarado, porque não há parcela para conciliar.
  //
  // A mesma montagem da criação, vinda de lib/parcelasEmprestimo.js.
  async function gerarParcelas(row, e) {
    e.stopPropagation()
    const linhas = linhasDeParcelas(row.data ? row : { data: row })
    if (!linhas.length) { showToast('Este contrato não tem cronograma para lançar.', 'error'); return }
    const ok = await confirmar({
      titulo: `Lançar ${linhas.length} linha(s) em Contas a Pagar?`,
      texto: `${row.nome || row.credor || ''} — ${row.parcelas_total || linhas.length} parcela(s)`,
      consequencias: [
        'Cada parcela gera um lançamento: amortização e juros em linhas separadas, quando o cronograma separa.',
        'As parcelas que o cronograma marca como pagas entram como pagas — é história anterior ao sistema.',
        'As demais ficam pendentes, e são baixadas pela conciliação do extrato.',
        'A partir daí o saldo deste contrato sai da conciliação, e não mais do número digitado.',
      ],
      confirmarLabel: `Lançar ${linhas.length}`,
    })
    if (!ok) return
    setGerando(row.id)
    try {
      // Confere de novo antes de inserir: entre abrir a tela e clicar, as
      // parcelas podem ter sido lançadas de outro jeito. Duplicar o
      // cronograma inteiro seria pior que não lançar.
      const { count } = await supabase.from('payable')
        .select('id', { count: 'exact', head: true }).eq('emprestimo_id', row.id)
      if (count) { showToast('Este contrato já tem parcelas em Contas a Pagar.', 'error'); return }

      // O código é sequencial e único por usuária: tomamos o maior que existe
      // e seguimos a partir dele, como faz a rotina de criação no banco.
      const { data: ultimos } = await supabase.from('payable')
        .select('codigo').like('codigo', '2%').order('codigo', { ascending: false }).limit(1)
      let proximo = Number(String(ultimos?.[0]?.codigo || '200000').slice(1)) || 0
      const comCodigo = linhas.map(l => {
        proximo += 1
        return {
          user_id: user.id,
          emprestimo_id: row.id,
          codigo: '2' + String(proximo).padStart(5, '0'),
          data: l,
        }
      })
      const { error } = await supabase.from('payable').insert(comCodigo)
      if (error) throw error
      showToast(`${comCodigo.length} linha(s) lançada(s). O saldo deste contrato passa a sair da conciliação.`, 'success')
      recarregar()
    } catch (err) {
      showToast(msgErro(err, 'Não foi possível lançar as parcelas.'), 'error')
    } finally {
      setGerando(null)
    }
  }

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
    if (error) { showToast(msgErro(error, 'Não foi possível excluir este contrato.'), 'error'); return }
    showToast('Excluído.', 'info')
    recarregar()
  }

  const colgroup = (
    <colgroup>
      <col style={{ width: 100 }} />
      <col />
      <col style={{ width: 130 }} />
      <col style={{ width: 100, textAlign: 'center' }} />
      <col style={{ width: 95, textAlign: 'center' }} />
      <col style={{ width: 260, textAlign: 'right' }} />
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
                  <span style={seloInformado} title={`${totais.informados} contrato(s) sem parcelas em Contas a Pagar: o saldo deles não foi apurado. O que está declarado no cadastro soma ${fmtMoney(totais.declarado)}, e esse número não entra no total ao lado.`}>
                    + {fmtMoney(totais.declarado)} declarado, sem apuração
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
                    <th style={{ ...th, textAlign: 'right' }} title="Em aberto: principal (o saldo devedor) e juros, cada um com o previsto no contrato e o realizado na conciliação.">Em aberto</th>
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
            {rows.length === 0 ? 'Nenhum empréstimo ou financiamento cadastrado. Clique em "+ Novo" para começar.' : 'Nenhum resultado.'}
          </div>
        ) : (
          <table style={{ ...tbl, tableLayout: 'fixed' }}>
            {colgroup}
            <tbody>
              {filtrados.map(r => {
                const status = r.status || 'ativa'
                // Reais (Contas a Pagar) ou digitados no cadastro (selo "informado").
                const v = visao(r)
                const selo = v.real ? null : <span style={seloInformado} title="sem parcelas em Contas a Pagar — número digitado no cadastro">declarado</span>
                return (
                  <tr key={r.id} onClick={() => abrirEdicao(r)} style={{ cursor: 'pointer' }} title="Clique para ver/editar">
                    <td style={tdMono}>{r.codigo || '—'}</td>
                    <td style={td}>
                      <div style={{ fontWeight: 600 }}>{r.nome || r.credor || '—'}</div>
                      {r.numero_contrato && <div style={{ fontSize: 10, color: 'var(--text-mid)', fontFamily: 'monospace' }}>{r.numero_contrato}</div>}
                    </td>
                    <td style={{ ...td, color: 'var(--text-mid)' }}>{TIPO_LABEL[r.tipo] || '—'}</td>
                    <td style={{ ...td, textAlign: 'center', color: 'var(--text-mid)' }}>
                      {v.real ? (
                        <button
                          type="button"
                          onClick={e => { e.stopPropagation(); setVendoParcelas(r) }}
                          title="Ver as parcelas uma a uma: vencimento, valor e como cada uma foi paga"
                          style={btnContagem}
                        >
                          {v.pagas}/{v.total}
                        </button>
                      ) : <span title="sem parcelas em Contas a Pagar — número digitado no cadastro">{v.pagas}/{v.total}{selo}</span>}
                    </td>
                    <td style={{ ...td, textAlign: 'center', color: 'var(--text-mid)' }} title={v.real ? 'Menor vencimento ainda não pago em Contas a Pagar' : 'cronograma digitado no cadastro'}>
                      {v.proxima ? fmtDataBR(v.proxima) : (status === 'quitada' ? '—' : (v.real ? 'tudo pago' : '—'))}
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: v.real ? 'var(--red)' : 'var(--text-mid)' }} title={v.real
                      ? 'Soma das parcelas ainda não conciliadas em Contas a Pagar'
                      : 'As parcelas deste contrato não estão em Contas a Pagar, então não há o que conciliar e o saldo não é apurado. O número abaixo é o que foi declarado no cadastro.'}>
                      {v.real ? (
                        <div style={caixas}>
                          <div style={caixa} title="Principal: a dívida em si. Previsto é o que o contrato prevê amortizar; realizado é o que já foi conciliado contra o extrato. Não é despesa — sai do caixa e abate o passivo.">
                            <div style={caixaTitulo}>Principal</div>
                            <div style={caixaValor}>{fmtMoney(v.principal.emAberto)}</div>
                            <div style={caixaLinha}>
                              previsto {fmtMoney(v.principal.previsto)} · realizado {fmtMoney(v.principal.realizado)}
                            </div>
                          </div>
                          <div style={caixa} title={v.juros.previsto === null
                            ? 'Juros: o cronograma deste contrato não separa juros do principal. O valor realizado é o apurado na conciliação, pagamento a pagamento.'
                            : 'Juros: despesa financeira. Previsto é o que o contrato prevê; realizado é o que foi efetivamente pago, incluindo mora e multa medidas na conciliação.'}>
                            <div style={caixaTitulo}>Juros</div>
                            <div style={{ ...caixaValor, color: 'var(--navy-mid)' }}>
                              {v.juros.previsto === null ? fmtMoney(v.juros.realizado) : fmtMoney(v.juros.emAberto)}
                            </div>
                            <div style={caixaLinha}>
                              {v.juros.previsto === null
                                ? <>previsto <em>não consta</em> · realizado {fmtMoney(v.juros.realizado)}</>
                                : <>previsto {fmtMoney(v.juros.previsto)} · realizado {fmtMoney(v.juros.realizado)}</>}
                            </div>
                            {v.juros.medidoNaConciliacao > 0 && v.juros.previsto !== null && (
                              <div style={caixaNota}>inclui {fmtMoney(v.juros.medidoNaConciliacao)} medido na conciliação</div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <>
                          <div style={{ fontWeight: 400, fontSize: 10.5 }}>não apurado</div>
                          <div style={{ fontWeight: 400, fontSize: 11 }}>{fmtMoney(v.declarado)}{selo}</div>
                          {/* O botão fica na célula do saldo, e não na coluna
                              de ações: ele é a saída deste estado, e aqui
                              está ao lado do que ele resolve. Na coluna de
                              ações ele sobrava da tabela, e deixaria uma
                              coluna larga e vazia nos contratos já apurados. */}
                          {v.cronograma > 0 && (
                            <button
                              onClick={e => gerarParcelas(r, e)}
                              disabled={gerando === r.id}
                              title={`Lançar as ${v.cronograma} parcelas do cronograma em Contas a Pagar. A partir daí o saldo passa a sair da conciliação, e deixa de depender do que foi digitado.`}
                              style={btnGerar}
                            >
                              {gerando === r.id ? 'lançando…' : 'Gerar parcelas'}
                            </button>
                          )}
                        </>
                      )}
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

      <ModalParcelas
        open={!!vendoParcelas}
        onClose={() => setVendoParcelas(null)}
        contrato={vendoParcelas}
      />

      <ModalEmprestimo open={modalOpen} onClose={() => setModalOpen(false)} registro={edicao} reais={edicao ? (reais[edicao.id] || null) : null} onSaved={recarregar} />
    {dialogoConfirmacao}
    </AppLayout>
  )
}

const searchInput = { width: '100%', padding: '9px 12px 9px 32px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 13, color: 'var(--navy)', background: 'var(--white)', outline: 'none' }
const resumo = { display: 'inline-flex', alignItems: 'center', gap: 10, padding: '7px 12px', background: 'var(--white)', border: '1px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 12 }
const caixas = { display: 'flex', gap: 6, justifyContent: 'flex-end' }
const caixa = {
  flex: '1 1 0', minWidth: 0, textAlign: 'left', cursor: 'help',
  border: '1px solid var(--cream-dark)', borderRadius: 6, padding: '6px 8px',
  background: 'var(--cream-light, #FBF8F2)',
}
const caixaTitulo = {
  fontSize: 8, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase',
  color: 'var(--text-mid)', marginBottom: 2,
}
const caixaValor = { fontSize: 13, fontWeight: 700, color: 'var(--red)', lineHeight: 1.2 }
const caixaLinha = { fontSize: 9.5, fontWeight: 400, color: 'var(--text-mid)', marginTop: 2, lineHeight: 1.35 }
const caixaNota = { fontSize: 9, fontWeight: 400, color: 'var(--gold-dark)', marginTop: 2, lineHeight: 1.3 }
// A contagem é um botão, e precisa parecer um: sublinhado tracejado, como o
// resto do sistema marca o que se pode abrir.
const btnContagem = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
  fontFamily: 'var(--body)', fontSize: 12, fontWeight: 600, color: 'var(--navy)',
  borderBottom: '1px dashed var(--gold-dark)', lineHeight: 1.4,
}
const btnGerar = {
  display: 'inline-block', marginTop: 5, padding: '3px 8px', borderRadius: 5,
  border: '1px solid var(--navy)', background: 'var(--white)', color: 'var(--navy)',
  fontFamily: 'var(--body)', fontSize: 10.5, fontWeight: 700, cursor: 'pointer',
  whiteSpace: 'nowrap', maxWidth: '100%',
}
const btnNovo = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 6, border: 'none', background: 'var(--gold)', color: '#fff', fontFamily: 'var(--body)', fontSize: 12, fontWeight: 700, letterSpacing: 0.5, cursor: 'pointer', textTransform: 'uppercase' }
const btnExcluir = { background: 'none', border: 'none', color: 'var(--text-mid)', fontSize: 22, lineHeight: 1, cursor: 'pointer', padding: 0 }
const seloInformado = { display: 'inline-block', marginLeft: 6, fontSize: 8, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--gold-dark)', border: '1px solid var(--gold-dark)', borderRadius: 4, padding: '1px 5px', verticalAlign: 'middle', cursor: 'help' }
const tableWrap = { background: 'var(--white)', borderRadius: 10, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)' }
const tbl = { width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontFamily: 'var(--body)' }
const th = { textAlign: 'left', padding: '12px 14px', fontSize: 9, fontWeight: 700, letterSpacing: 1.5, color: '#fff', textTransform: 'uppercase', background: 'var(--navy)', borderBottom: '2px solid var(--gold)' }
const td = { padding: '12px 14px', fontSize: 12, color: 'var(--navy)', borderBottom: '1px solid var(--cream-dark)' }
const tdMono = { ...td, fontFamily: 'monospace', fontWeight: 600, color: 'var(--text-mid)', letterSpacing: 0.5 }
const emptyState = { padding: '60px 24px', textAlign: 'center', fontFamily: 'var(--body)', color: 'var(--text-mid)', fontSize: 13 }
