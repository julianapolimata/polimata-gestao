import { useCallback, useEffect, useMemo, useState } from 'react'
import AppLayout from '../components/AppLayout'
import EstadoErro from '../components/EstadoErro'
import { showToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { msgErro } from '../lib/erros'
import { fmtMoney } from '../lib/finance'
import { funilPorEtapa, placarDoFunil, situacaoDe, SITUACOES } from '../lib/funil'
import ModalOportunidade from './components/ModalOportunidade'

// =============================================================================
// O FUNIL (B5.1 + F1).
//
// Duas visões da mesma coisa, e a ordem importa: primeiro o FUNIL, que é o que
// está em aberto e pede ação; depois a LISTA, que é o histórico inteiro.
//
// O que NÃO está no funil: as ganhas e as perdidas. Elas já foram decididas, e
// mantê-las nas colunas faria o total do funil prometer dinheiro que já tem
// destino. Elas aparecem na lista abaixo e no placar, onde pertencem.
//
// A taxa de ganho olha só o que foi decidido. Incluir as abertas no
// denominador faria a taxa cair toda vez que uma proposta nova entrasse — o
// que diria algo sobre o volume, e nada sobre a conversão.
// =============================================================================
export default function Oportunidades() {
  const { user } = useAuth()
  const [linhas, setLinhas] = useState([])
  const [pessoas, setPessoas] = useState([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [edicao, setEdicao] = useState(null)
  const [filtro, setFiltro] = useState('aberta')
  const [confirmar, dialogoConfirmacao] = useConfirm()

  const recarregar = useCallback(() => {
    if (!user) return
    setLoading(true)
    Promise.all([
      supabase.from('oportunidades').select('*').order('created_at', { ascending: false }),
      supabase.from('pessoas').select('id, codigo, data'),
    ]).then(([rO, rP]) => {
      if (rO.error) { setErro(rO.error); setLinhas([]) }
      else { setErro(null); setLinhas(rO.data || []) }
      if (!rP.error) setPessoas(rP.data || [])
      setLoading(false)
    }).catch(e => { setErro(e); setLoading(false) })
  }, [user])

  useEffect(() => { recarregar() }, [recarregar])

  const nomeDaPessoa = useCallback((id) => {
    const p = (pessoas || []).find(x => x.id === id)
    if (!p) return '(pessoa não encontrada)'
    return p.data?.fantasia || p.data?.nome || '(sem nome)'
  }, [pessoas])

  const colunas = useMemo(() => funilPorEtapa(linhas), [linhas])
  const placar = useMemo(() => placarDoFunil(linhas), [linhas])
  const lista = useMemo(
    () => (filtro === 'todas' ? linhas : linhas.filter(o => situacaoDe(o) === filtro)),
    [linhas, filtro],
  )

  function abrirNova() { setEdicao(null); setModalOpen(true) }
  function abrirEdicao(o) { setEdicao(o); setModalOpen(true) }

  async function excluir(o, e) {
    e.stopPropagation()
    const ok = await confirmar({
      titulo: `Excluir a oportunidade ${o.codigo || ''}?`.trim(),
      texto: nomeDaPessoa(o.data?.pessoa_id),
      consequencias: [
        'A pessoa continua no cadastro: a oportunidade aponta para ela, e não o contrário.',
        'O histórico desta negociação se perde, inclusive o motivo da perda, se houver.',
      ],
      confirmarLabel: 'Excluir',
      variante: 'perigo',
    })
    if (!ok) return
    const { error } = await supabase.from('oportunidades').delete().eq('id', o.id)
    if (error) { showToast(msgErro(error, 'Não foi possível excluir.'), 'error'); return }
    showToast('Oportunidade excluída.', 'success')
    recarregar()
  }

  if (erro) {
    return (
      <AppLayout title="Funil">
        <EstadoErro erro={erro} onTentarDeNovo={recarregar} />
      </AppLayout>
    )
  }

  return (
    <AppLayout
      title="Funil"
      stickyTop={(
        <div style={barra}>
          <div style={placarBox}>
            <Numero rotulo="Em aberto" valor={fmtMoney(placar.valorEmAberto)} nota={`${placar.emAberto} negociação(ões)`} />
            <Numero rotulo="Ganho" valor={fmtMoney(placar.valorGanho)} nota={`${placar.ganhas} fechada(s)`} cor="var(--green)" />
            <Numero rotulo="Perdido" valor={fmtMoney(placar.valorPerdido)} nota={`${placar.perdidas} perdida(s)`} cor="var(--text-mid)" />
            <Numero
              rotulo="Taxa de ganho"
              valor={placar.taxaGanho === null ? '—' : `${String(placar.taxaGanho).replace('.', ',')}%`}
              nota={placar.taxaGanho === null
                ? 'nada decidido ainda'
                : `de ${placar.ganhas + placar.perdidas} decidida(s)`}
            />
          </div>
          <button onClick={abrirNova} style={btnNovo}>+ Nova</button>
        </div>
      )}
    >
      {loading ? (
        <div style={vazio}>Carregando…</div>
      ) : !linhas.length ? (
        <div style={vazio}>
          <strong>Nenhuma oportunidade registrada.</strong>
          <p style={{ margin: '8px 0 0', lineHeight: 1.6 }}>
            A oportunidade registra uma negociação com uma pessoa do cadastro. Uma mesma pessoa
            pode ter várias, em situações diferentes — e o cadastro não depende delas.
          </p>
        </div>
      ) : (
        <>
          <div style={colunasBox}>
            {colunas.map(c => (
              <div key={c.etapa || 'sem-etapa'} style={coluna}>
                <div style={colunaTopo}>
                  <span style={colunaTitulo}>{c.etapa || 'Sem etapa registrada'}</span>
                  <span style={colunaTotal}>{fmtMoney(c.total)}</span>
                </div>
                <div style={colunaNota}>{c.itens.length} negociação(ões)</div>
                {c.itens.length === 0 ? (
                  <div style={colunaVazia}>sem negociação nesta etapa</div>
                ) : c.itens.map(o => (
                  <button key={o.id} type="button" onClick={() => abrirEdicao(o)} style={cartao}>
                    <div style={cartaoNome}>{nomeDaPessoa(o.data?.pessoa_id)}</div>
                    <div style={cartaoValor}>{fmtMoney(Number(o.data?.valor_estimado) || 0)}</div>
                    <div style={cartaoNota}>
                      {o.codigo || 'sem referência'}
                      {o.data?.descricao ? ` · ${o.data.descricao}` : ''}
                    </div>
                  </button>
                ))}
              </div>
            ))}
          </div>

          <div style={filtros}>
            {[...SITUACOES, { v: 'todas', label: 'Todas' }].map(s => (
              <button
                key={s.v}
                onClick={() => setFiltro(s.v)}
                style={{ ...chip, ...(filtro === s.v ? chipAtivo : null) }}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div style={quadro}>
            <div style={{ overflowX: 'auto' }}>
              <table style={tabela}>
                <thead>
                  <tr>
                    <th style={{ ...th, width: 110 }}>Referência</th>
                    <th style={th}>Com quem</th>
                    <th style={{ ...th, width: 120 }}>Etapa</th>
                    <th style={{ ...th, width: 110 }}>Situação</th>
                    <th style={{ ...th, width: 120, textAlign: 'right' }}>Valor</th>
                    <th style={{ ...th, width: 44 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map(o => {
                    const s = situacaoDe(o)
                    return (
                      <tr key={o.id} onClick={() => abrirEdicao(o)} style={{ cursor: 'pointer' }}>
                        <td style={{ ...td, fontFamily: 'monospace', fontSize: 11, color: 'var(--text-mid)' }}>
                          {o.codigo || '—'}
                        </td>
                        <td style={td}>
                          <div style={{ fontWeight: 600 }}>{nomeDaPessoa(o.data?.pessoa_id)}</div>
                          {o.data?.descricao && <div style={linhaSec}>{o.data.descricao}</div>}
                          {s === 'perdida' && o.data?.motivo_perda && (
                            <div style={{ ...linhaSec, color: 'var(--gold-dark)' }}>
                              perdida: {o.data.motivo_perda}
                            </div>
                          )}
                        </td>
                        <td style={{ ...td, color: 'var(--text-mid)' }}>{o.data?.etapa || '—'}</td>
                        <td style={td}><Situacao valor={s} /></td>
                        <td style={{ ...td, textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                          {fmtMoney(Number(o.data?.valor_estimado) || 0)}
                        </td>
                        <td style={{ ...td, textAlign: 'center' }}>
                          <button onClick={e => excluir(o, e)} title="Excluir" style={btnExcluir}>×</button>
                        </td>
                      </tr>
                    )
                  })}
                  {!lista.length && (
                    <tr><td colSpan={6} style={{ ...td, color: 'var(--text-mid)' }}>
                      Nenhuma oportunidade nesta situação.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <ModalOportunidade
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        registro={edicao}
        pessoas={pessoas}
        onSaved={recarregar}
      />
      {dialogoConfirmacao}
    </AppLayout>
  )
}

function Numero({ rotulo, valor, nota, cor }) {
  return (
    <div style={numeroBox}>
      <div style={numeroRotulo}>{rotulo}</div>
      <div style={{ ...numeroValor, color: cor || 'var(--navy)' }}>{valor}</div>
      <div style={numeroNota}>{nota}</div>
    </div>
  )
}

function Situacao({ valor }) {
  const estilo = valor === 'ganha' ? selaGanha : valor === 'perdida' ? selaPerdida : selaAberta
  const texto = (SITUACOES.find(s => s.v === valor) || {}).label || valor
  return <span style={{ ...selo, ...estilo }}>{texto}</span>
}

const barra = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  gap: 12, marginBottom: 14, flexWrap: 'wrap',
}
const placarBox = { display: 'flex', gap: 10, flexWrap: 'wrap', flex: '1 1 420px' }
const numeroBox = {
  flex: '1 1 130px', minWidth: 0, background: 'var(--white)',
  border: '1px solid var(--cream-dark)', borderRadius: 9, padding: '9px 12px',
}
const numeroRotulo = {
  fontSize: 8.5, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase',
  color: 'var(--text-mid)',
}
const numeroValor = { fontSize: 16, fontWeight: 700, marginTop: 2, fontVariantNumeric: 'tabular-nums' }
const numeroNota = { fontSize: 10, color: 'var(--text-mid)', marginTop: 1 }
const btnNovo = {
  padding: '9px 16px', borderRadius: 7, border: 'none', background: 'var(--gold-dark)',
  color: '#fff', fontFamily: 'var(--body)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
}
const colunasBox = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
  gap: 12, marginBottom: 20,
}
const coluna = {
  background: 'var(--white)', border: '1px solid var(--cream-dark)',
  borderRadius: 10, padding: 12, minWidth: 0,
}
const colunaTopo = { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }
const colunaTitulo = {
  fontSize: 9.5, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', color: 'var(--navy)',
}
const colunaTotal = { fontSize: 12.5, fontWeight: 700, color: 'var(--navy)', fontVariantNumeric: 'tabular-nums' }
const colunaNota = { fontSize: 10, color: 'var(--text-mid)', marginBottom: 9 }
const colunaVazia = { fontSize: 11, color: 'var(--text-mid)', padding: '10px 0', fontStyle: 'italic' }
const cartao = {
  display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
  background: 'var(--cream)', border: '1px solid var(--cream-dark)', borderRadius: 7,
  padding: '8px 10px', marginBottom: 7, fontFamily: 'var(--body)',
}
const cartaoNome = {
  fontSize: 12, fontWeight: 600, color: 'var(--navy)',
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
}
const cartaoValor = { fontSize: 13, fontWeight: 700, color: 'var(--navy)', fontVariantNumeric: 'tabular-nums' }
const cartaoNota = {
  fontSize: 10, color: 'var(--text-mid)', marginTop: 2,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
}
const filtros = { display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 10 }
const chip = {
  padding: '5px 12px', borderRadius: 999, border: '1px solid var(--cream-dark)',
  background: 'var(--white)', color: 'var(--text-mid)', fontFamily: 'var(--body)',
  fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
}
const chipAtivo = { borderColor: 'var(--navy)', color: 'var(--navy)', background: 'var(--cream)' }
const quadro = {
  background: 'var(--white)', border: '1px solid var(--cream-dark)',
  borderRadius: 10, overflow: 'hidden',
}
const tabela = { width: '100%', minWidth: 660, borderCollapse: 'separate', borderSpacing: 0 }
const th = {
  textAlign: 'left', padding: '11px 13px', fontSize: 8.5, fontWeight: 700,
  letterSpacing: 1.4, textTransform: 'uppercase', color: '#fff',
  background: 'var(--navy)', borderBottom: '2px solid var(--gold)', whiteSpace: 'nowrap',
}
const td = {
  padding: '11px 13px', fontSize: 12, color: 'var(--navy)',
  borderBottom: '1px solid var(--cream-dark)', verticalAlign: 'top',
}
const linhaSec = { fontSize: 10.5, color: 'var(--text-mid)', marginTop: 2 }
const selo = {
  display: 'inline-block', padding: '3px 9px', borderRadius: 999, fontSize: 9,
  fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap',
}
const selaAberta = { background: 'rgba(0,32,62,0.08)', color: 'var(--navy)' }
const selaGanha = { background: 'rgba(39,174,96,0.12)', color: 'var(--green)' }
const selaPerdida = { background: 'rgba(0,0,0,0.05)', color: 'var(--text-mid)' }
const btnExcluir = {
  background: 'none', border: 'none', color: 'var(--text-mid)',
  fontSize: 20, lineHeight: 1, cursor: 'pointer', padding: 0,
}
const vazio = {
  background: 'var(--white)', border: '1px solid var(--cream-dark)', borderRadius: 10,
  padding: '38px 24px', textAlign: 'center', fontSize: 13, color: 'var(--text-mid)',
  fontFamily: 'var(--body)',
}
