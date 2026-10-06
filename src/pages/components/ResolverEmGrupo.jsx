// =============================================================================
// LANÇAR DO EXTRATO, EM GRUPO — e por que isto NÃO é conciliar.
//
// Medido no extrato dela: 393 linhas pendentes em 88 descrições distintas.
// "DÉB.IOF" aparece 22 vezes e soma R$ 18,12 no período INTEIRO. A tela pedia
// uma decisão por linha, e ninguém atravessa 393 decisões: desiste na quinta,
// e aí o mês não fecha por causa de dezoito reais de IOF.
//
// ── O NOME IMPORTA, E O PRIMEIRO ESTAVA ERRADO ──────────────────────────────
//
// Isto se chamava "Resolver em grupo", dentro de uma tela chamada Conciliação.
// A Juliana leu e perguntou: "essa conciliação está cruzando o que com o quê?
// Se é para gerar lançamento, não deveria estar na Escrituração?". A pergunta
// estava certa e expôs o nome errado.
//
// CONCILIAR é cruzar duas fontes independentes: a linha do banco e um
// lançamento que já existia. Das 393 pendentes dela, só 38 têm contrapartida —
// para essas, a tela ao lado serve. As outras 355 nunca tiveram documento
// (Pix, tarifa, imposto), então não há o que cruzar: há o que REGISTRAR.
//
// E isto não cabe na Escrituração: aquela tela trabalha sobre lançamentos que
// já existem (lista o que está `escriturado != true`) e nunca vê linha de
// extrato. Não dá para escriturar o que ainda não foi lançado.
//
// Então o painel faz as duas coisas de uma vez, e diz isso: cria o lançamento
// a partir da linha E o escritura com a categoria que ela escolhe aqui. Por
// isso nasce `escriturado: true` — a escrituração aconteceu, foi neste clique.
// Eles não reaparecem na tela de Escrituração, e isso é correto, não um
// atalho.
//
// A regra de agrupamento (e o que ela se RECUSA a juntar) está em
// src/lib/agruparExtrato.js, com prova.
// =============================================================================
import { useMemo, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'
import { fmtMoney } from '../../lib/finance'
import { categoriasDe, subcategoriasDe } from '../../lib/planoContas'
import { showToast } from '../../components/Toast'
import { agruparPendentes, resumoDoAgrupamento, lancamentosDoGrupo, grupoSem } from '../../lib/agruparExtrato'
import { detectarRecorrencia, frasesDaOferta } from '../../lib/recorrenciaDoGrupo'
import { msgErro } from '../../lib/erros'

const fmtData = d => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—')

export default function ResolverEmGrupo({ linhas, plano, onPronto }) {
  const { user } = useAuth()
  const [aberto, setAberto] = useState(null)   // chave do grupo expandido
  const [cat, setCat] = useState('')
  const [subcat, setSubcat] = useState('')
  const [parte, setParte] = useState('')
  const [salvando, setSalvando] = useState(false)
  // A oferta de recorrência que aparece DEPOIS de o grupo ser resolvido — o
  // grupo já saiu da lista, então ela precisa viver fora dele.
  const [oferta, setOferta] = useState(null)   // {deteccao, frases}
  const [criandoRec, setCriandoRec] = useState(false)
  const [verLinhas, setVerLinhas] = useState(false)      // lista aberta dentro do grupo
  const [fora, setFora] = useState(new Set())            // linhas tiradas do lote

  const grupos = useMemo(() => agruparPendentes(linhas), [linhas])
  const resumo = useMemo(() => resumoDoAgrupamento(grupos), [grupos])
  // Só os repetidos: uma linha avulsa não ganha nada em virar "grupo de um", e
  // enchê-la de caixinhas esconde os grupos que realmente economizam tempo.
  const repetidos = grupos.filter(g => g.quantas > 1)

  function abrir(g) {
    setAberto(a => (a === g.chave ? null : g.chave))
    setCat(''); setSubcat(''); setParte('')
    // As exclusões são do grupo que estava aberto; mudar de grupo zera, senão
    // ela tiraria uma linha de um e perderia outra em outro, sem ver.
    setFora(new Set()); setVerLinhas(false)
  }

  function alternarLinha(id) {
    setFora(s => {
      const novo = new Set(s)
      if (novo.has(id)) novo.delete(id); else novo.add(id)
      return novo
    })
  }

  async function criarGrupo(grupoCheio) {
    if (!cat) { showToast('Escolha a categoria do grupo.', 'warning'); return }
    // O que vai para o banco é o grupo JÁ SEM as linhas que ela tirou — e
    // recalculado, porque o total e o valor fixo mudam com elas (o valor fixo
    // é o que decide se a recorrência é oferecida).
    const g = grupoSem(grupoCheio, fora)
    if (!g) { showToast('Nenhuma linha selecionada.', 'warning'); return }
    const itens = lancamentosDoGrupo(g, { cat, subcat, parte })
    if (!itens.length) return
    setSalvando(true)
    try {
      // Tudo ou nada: meio grupo conciliado some da tela e deixa um resto sem
      // explicação. A função do banco desfaz tudo se uma linha já tiver sido
      // conciliada por outro caminho.
      const { error } = await supabase.rpc('conciliar_criar_lancamentos_em_lote', { p_itens: itens })
      if (error) throw error
      showToast(`${itens.length} lançamento(s) criado(s) e conciliado(s).`, 'success')

      // O grupo acabou de provar que se repete. Em vez de ela ir cadastrar
      // isso à mão na tela de Recorrências — que existe e está vazia, porque
      // pede nove campos por linha — o sistema oferece, já preenchido.
      //
      // Oferece, não cria: recorrência errada gera despesa que não existe, mês
      // após mês, e ninguém percebe porque o número aparece sozinho.
      const d = detectarRecorrencia(g, { cat, subcat, parte })
      setOferta(d ? { deteccao: d, frases: frasesDaOferta(d) } : null)

      setAberto(null); setCat(''); setSubcat(''); setParte('')
      setFora(new Set()); setVerLinhas(false)
      onPronto?.()
    } catch (e) {
      showToast(msgErro(e), 'error')
    } finally {
      setSalvando(false)
    }
  }

  async function criarRecorrencia() {
    if (!oferta || !user) return
    setCriandoRec(true)
    try {
      // user_id explícito, como todo insert deste sistema faz — a coluna é
      // NOT NULL e sem ele a gravação falha no clique, não no build.
      const { error } = await supabase
        .from('recurring_masters')
        .insert({ user_id: user.id, data: oferta.deteccao.mestre })
      if (error) throw error
      showToast('Recorrência criada — as próximas já nascem prontas.', 'success')
      setOferta(null)
    } catch (e) {
      showToast(msgErro(e), 'error')
    } finally {
      setCriandoRec(false)
    }
  }

  // A oferta sobrevive ao grupo que a gerou: ele já saiu da lista quando ela
  // aparece. Fica no topo, porque é a única coisa esperando resposta.
  const painelOferta = oferta && (
    <div style={caixaOferta}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--navy)' }}>{oferta.frases.titulo}</div>
      <div style={{ fontSize: 12, color: 'var(--text-mid)', marginTop: 3, lineHeight: 1.5 }}>
        {oferta.frases.detalhe} {oferta.frases.acao}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <button onClick={criarRecorrencia} disabled={criandoRec} style={botao} type="button">
          {criandoRec ? 'Criando…' : `Sim, deixar as próximas prontas`}
        </button>
        <button onClick={() => setOferta(null)} style={botaoGhost} type="button">Agora não</button>
      </div>
      <div style={aviso}>
        Começa só depois da última que já aconteceu, então não duplica o que acabou de ser lançado.
        Dá para pausar ou apagar em Recorrências.
      </div>
    </div>
  )

  if (!repetidos.length) {
    return (
      <div style={caixa}>
        <div style={titulo}>Lançar do extrato, em grupo</div>
        {painelOferta}
        {!oferta && (
          <div style={vazio}>
            Nenhuma linha pendente se repete neste período — cada uma precisa de uma decisão própria.
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={caixa}>
      <div style={titulo}>Lançar do extrato, em grupo</div>
      {painelOferta}
      {/* O número vem ANTES do trabalho: "345 linhas em 40 decisões" é o que
          faz alguém começar; "345 linhas" é o que faz desistir. */}
      <div style={chamada}>
        <strong>{resumo.linhasEmGrupo} linhas</strong> se repetem e cabem em{' '}
        <strong>{repetidos.length} decisões</strong>.
        {resumo.avulsas > 0 && ` As outras ${resumo.avulsas} são avulsas e continuam na lista ao lado.`}
      </div>
      {/* Dizer o que é, porque o lugar sugere outra coisa. Quem lê
          "Conciliação" espera conferência de duas fontes; aqui não há segunda
          fonte, e esconder isso faria o número da DRE parecer mais apurado do
          que é. */}
      <div style={explicacao}>
        Estas linhas <strong>não têm lançamento correspondente</strong> no sistema — são Pix, tarifa,
        imposto: coisas que nunca tiveram nota. Aqui você <strong>cria e escritura</strong> o lançamento
        a partir da linha do banco, que passa a ser a evidência dele. Não é conferência de duas fontes;
        é registro. Conferência é o que a lista abaixo faz, com as linhas que já têm contrapartida.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {repetidos.map(g => {
          const expandido = aberto === g.chave
          const tipoPlano = g.tipo === 'entrada' ? 'Entrada' : 'Saída'
          const subs = subcategoriasDe(plano, tipoPlano, cat)
          return (
            <div key={g.chave} style={{ ...linhaGrupo, borderColor: expandido ? 'var(--gold-dark)' : 'var(--cream-dark)' }}>
              <button onClick={() => abrir(g)} style={cabecalho} type="button">
                <span style={contador}>{g.quantas}×</span>
                <span style={descricao} title={g.descricao}>{g.descricao}</span>
                <span style={{ ...valor, color: g.tipo === 'entrada' ? 'var(--green)' : 'var(--red)' }}>
                  {g.tipo === 'entrada' ? '+' : '−'} {fmtMoney(g.total)}
                </span>
                <span style={seta}>{expandido ? '▾' : '▸'}</span>
              </button>

              <div style={detalhe}>
                {/* Valor sempre igual é sinal de cobrança fixa — dizer "22× R$ 0,82"
                    deixa óbvio que são 22 cliques por dezoito reais. */}
                {g.valorUnico != null
                  ? `${g.quantas}× ${fmtMoney(g.valorUnico)}`
                  : `${g.quantas} lançamentos de valores diferentes`}
                {' · '}{fmtData(g.periodo.de)} a {fmtData(g.periodo.ate)}
              </div>

              {expandido && (() => {
                // O que de fato vai ser criado, já sem as linhas tiradas.
                const efetivo = grupoSem(g, fora)
                const quantasVao = efetivo?.quantas || 0
                return (
                <div style={formulario}>
                  {/* Ver as linhas antes de decidir. Num grupo de valores
                      diferentes — "12 lançamentos de valores diferentes" —
                      classificar sem olhar é assinar em branco. */}
                  <button onClick={() => setVerLinhas(v => !v)} style={linkVer} type="button">
                    {verLinhas ? '▾' : '▸'} {verLinhas ? 'ocultar' : 'ver'} as {g.quantas} linhas
                    {fora.size > 0 && ` · ${fora.size} fora do lote`}
                  </button>

                  {verLinhas && (
                    <div style={listaLinhas}>
                      {[...g.linhas]
                        .sort((a, b) => String(a.data?.data || '').localeCompare(String(b.data?.data || '')))
                        .map(l => {
                          const dentro = !fora.has(l.id)
                          return (
                            <label key={l.id} style={{ ...itemLinha, opacity: dentro ? 1 : 0.45 }}>
                              <input type="checkbox" checked={dentro} onChange={() => alternarLinha(l.id)} />
                              <span style={{ color: 'var(--text-mid)', minWidth: 78 }}>{fmtData(l.data?.data)}</span>
                              <span style={{ flex: 1, textAlign: 'right', fontWeight: 600, color: g.tipo === 'entrada' ? 'var(--green)' : 'var(--red)' }}>
                                {fmtMoney(Math.abs(Number(l.data?.valor) || 0))}
                              </span>
                            </label>
                          )
                        })}
                      {fora.size > 0 && (
                        <div style={notaFora}>
                          As desmarcadas continuam na lista do extrato, para você decidir uma a uma.
                        </div>
                      )}
                    </div>
                  )}

                  <div style={rotulo}>
                    Classifique o grupo — vão nascer {quantasVao} lançamento(s), um por linha, cada um na data da sua.
                    {efetivo && efetivo.total !== g.total && ` Somam ${fmtMoney(efetivo.total)}.`}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <select value={cat} onChange={e => { setCat(e.target.value); setSubcat('') }} style={campo}>
                      <option value="">Categoria…</option>
                      {categoriasDe(plano, tipoPlano).map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    {subs.length > 0 && (
                      <select value={subcat} onChange={e => setSubcat(e.target.value)} style={campo}>
                        <option value="">Subcategoria (opcional)…</option>
                        {subs.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    )}
                    <input
                      value={parte}
                      onChange={e => setParte(e.target.value)}
                      placeholder={g.tipo === 'entrada' ? 'Cliente (opcional)' : 'Fornecedor (opcional)'}
                      style={{ ...campo, minWidth: 190 }}
                    />
                    <button onClick={() => criarGrupo(g)} disabled={!cat || salvando || !quantasVao} style={botao} type="button">
                      {salvando ? 'Criando…' : `Criar ${quantasVao} e conciliar`}
                    </button>
                  </div>
                  <div style={aviso}>
                    Cada lançamento nasce <strong>já escriturado</strong> com esta categoria — não volta
                    a aparecer na Escrituração — e <strong>sem documento fiscal</strong>: a linha do banco
                    é a evidência dele. Se a nota chegar depois, anexe a este lançamento.
                  </div>
                </div>
                )
              })()}
            </div>
          )
        })}
      </div>
    </div>
  )
}

const caixa = { background: 'var(--white)', border: '1px solid var(--cream-dark)', borderRadius: 10, padding: '14px 16px', marginBottom: 14, boxShadow: 'var(--shadow)' }
const titulo = { fontSize: 10, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--text-mid)', marginBottom: 8 }
const chamada = { fontSize: 13, color: 'var(--navy)', marginBottom: 6, lineHeight: 1.5 }
const explicacao = { fontSize: 11.5, color: 'var(--text-mid)', marginBottom: 12, lineHeight: 1.55, paddingLeft: 10, borderLeft: '2px solid var(--cream-dark)' }
const vazio = { fontSize: 12.5, color: 'var(--text-mid)' }
const linhaGrupo = { border: '1px solid var(--cream-dark)', borderRadius: 8, padding: '8px 10px', background: 'var(--cream)' }
const cabecalho = { display: 'flex', alignItems: 'center', gap: 10, width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--body)' }
const contador = { fontSize: 12, fontWeight: 700, color: 'var(--gold-dark)', minWidth: 34 }
const descricao = { flex: 1, fontSize: 12.5, fontWeight: 600, color: 'var(--navy)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const valor = { fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap' }
const seta = { fontSize: 11, color: 'var(--text-mid)' }
const detalhe = { fontSize: 11, color: 'var(--text-mid)', marginTop: 2, marginLeft: 44 }
const formulario = { marginTop: 10, marginLeft: 44, paddingTop: 10, borderTop: '1px dashed var(--cream-dark)' }
const rotulo = { fontSize: 11.5, color: 'var(--navy)', marginBottom: 8 }
const campo = { padding: '7px 9px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 12, color: 'var(--navy)', background: 'var(--white)', outline: 'none' }
const botao = { padding: '8px 16px', borderRadius: 6, border: 'none', background: 'var(--navy)', color: '#fff', fontFamily: 'var(--body)', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }
const aviso = { fontSize: 10.5, color: 'var(--text-mid)', marginTop: 7 }
const linkVer = { background: 'none', border: 'none', padding: 0, marginBottom: 8, color: 'var(--gold-dark)', fontFamily: 'var(--body)', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }
// Altura limitada e rolagem: um grupo de 43 linhas não pode empurrar o botão
// de criar para fora da tela — ela precisa ver a lista E a ação ao mesmo tempo.
const listaLinhas = { maxHeight: 190, overflowY: 'auto', border: '1px solid var(--cream-dark)', borderRadius: 6, background: 'var(--white)', padding: '4px 0', marginBottom: 10 }
const itemLinha = { display: 'flex', alignItems: 'center', gap: 9, padding: '4px 10px', fontSize: 11.5, cursor: 'pointer' }
const notaFora = { fontSize: 10.5, color: 'var(--text-mid)', padding: '6px 10px 2px', borderTop: '1px dashed var(--cream-dark)', marginTop: 4 }
const caixaOferta = { background: 'rgba(204,145,94,0.10)', border: '1px solid rgba(204,145,94,0.40)', borderRadius: 8, padding: '12px 14px', marginBottom: 12 }
const botaoGhost = { padding: '8px 14px', borderRadius: 6, border: '1.5px solid var(--cream-dark)', background: 'var(--white)', color: 'var(--text-mid)', fontFamily: 'var(--body)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }
