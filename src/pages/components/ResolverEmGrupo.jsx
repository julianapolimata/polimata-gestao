// =============================================================================
// RESOLVER EM GRUPO — as linhas do extrato que são a mesma coisa, de uma vez.
//
// Medido no extrato dela: 393 linhas pendentes em 88 descrições distintas.
// "DÉB.IOF" aparece 22 vezes e soma R$ 18,12 no período INTEIRO. A tela pedia
// uma decisão por linha, e ninguém atravessa 393 decisões: desiste na quinta,
// e aí o mês não fecha por causa de dezoito reais de IOF.
//
// Aqui ela classifica o GRUPO. A decisão continua humana — o que muda é o
// sistema parar de perguntar 22 vezes a mesma coisa.
//
// A regra de agrupamento (e o que ela se RECUSA a juntar) está em
// src/lib/agruparExtrato.js, com prova.
// =============================================================================
import { useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { fmtMoney } from '../../lib/finance'
import { categoriasDe, subcategoriasDe } from '../../lib/planoContas'
import { showToast } from '../../components/Toast'
import { agruparPendentes, resumoDoAgrupamento, lancamentosDoGrupo } from '../../lib/agruparExtrato'
import { msgErro } from '../../lib/erros'

const fmtData = d => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—')

export default function ResolverEmGrupo({ linhas, plano, onPronto }) {
  const [aberto, setAberto] = useState(null)   // chave do grupo expandido
  const [cat, setCat] = useState('')
  const [subcat, setSubcat] = useState('')
  const [parte, setParte] = useState('')
  const [salvando, setSalvando] = useState(false)

  const grupos = useMemo(() => agruparPendentes(linhas), [linhas])
  const resumo = useMemo(() => resumoDoAgrupamento(grupos), [grupos])
  // Só os repetidos: uma linha avulsa não ganha nada em virar "grupo de um", e
  // enchê-la de caixinhas esconde os grupos que realmente economizam tempo.
  const repetidos = grupos.filter(g => g.quantas > 1)

  function abrir(g) {
    setAberto(a => (a === g.chave ? null : g.chave))
    setCat(''); setSubcat(''); setParte('')
  }

  async function criarGrupo(g) {
    if (!cat) { showToast('Escolha a categoria do grupo.', 'warning'); return }
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
      setAberto(null); setCat(''); setSubcat(''); setParte('')
      onPronto?.()
    } catch (e) {
      showToast(msgErro(e), 'error')
    } finally {
      setSalvando(false)
    }
  }

  if (!repetidos.length) {
    return (
      <div style={caixa}>
        <div style={titulo}>Resolver em grupo</div>
        <div style={vazio}>
          Nenhuma linha pendente se repete neste período — cada uma precisa de uma decisão própria.
        </div>
      </div>
    )
  }

  return (
    <div style={caixa}>
      <div style={titulo}>Resolver em grupo</div>
      {/* O número vem ANTES do trabalho: "345 linhas em 40 decisões" é o que
          faz alguém começar; "345 linhas" é o que faz desistir. */}
      <div style={chamada}>
        <strong>{resumo.linhasEmGrupo} linhas</strong> se repetem e cabem em{' '}
        <strong>{repetidos.length} decisões</strong>.
        {resumo.avulsas > 0 && ` As outras ${resumo.avulsas} são avulsas e continuam na lista ao lado.`}
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

              {expandido && (
                <div style={formulario}>
                  <div style={rotulo}>Classifique o grupo — vão nascer {g.quantas} lançamentos, um por linha, cada um na data da sua.</div>
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
                    <button onClick={() => criarGrupo(g)} disabled={!cat || salvando} style={botao} type="button">
                      {salvando ? 'Criando…' : `Criar ${g.quantas} e conciliar`}
                    </button>
                  </div>
                  <div style={aviso}>
                    Cada lançamento nasce sem documento fiscal — a linha do banco é a evidência dele.
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

const caixa = { background: 'var(--white)', border: '1px solid var(--cream-dark)', borderRadius: 10, padding: '14px 16px', marginBottom: 14, boxShadow: 'var(--shadow)' }
const titulo = { fontSize: 10, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--text-mid)', marginBottom: 8 }
const chamada = { fontSize: 13, color: 'var(--navy)', marginBottom: 12, lineHeight: 1.5 }
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
