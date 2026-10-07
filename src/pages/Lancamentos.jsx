// =============================================================================
// LANÇAMENTOS — a relação do que aconteceu, dos dois lados.
//
// Pedido da Juliana, depois de tentar conferir como ficou classificado um
// "DÉB. SEGURO PRESTAMISTA": "a relação dos lançamentos realizados. ainda não
// tem né? eu quero confirmar como o seguro prestamista ficou, onde eu olho?".
//
// A resposta honesta era "meio-sim": Contas a Pagar e Contas a Receber já
// listam tudo e já têm busca. Mas para usar isso é preciso saber ANTES se o
// lançamento é entrada ou saída — que é justamente o que quem procura ainda
// não sabe —, e "contas a pagar" é nome de obrigação, não de registro.
//
// Esta tela não substitui aquelas: lá se OPERA (dar baixa, anexar documento,
// editar). Aqui se CONSULTA — o razão da operação, com o grupo da DRE junto,
// o placar acompanhando o filtro e a exportação para levar ao contador.
//
// A lógica e as provas estão em src/lib/lancamentos.js.
// =============================================================================
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import AppLayout from '../components/AppLayout'
import EstadoErro from '../components/EstadoErro'
import { showToast } from '../components/Toast'
import { msgErro } from '../lib/erros'
import { fmtMoney } from '../lib/finance'
import { fetchPlanoContas, CLASSIFICACOES } from '../lib/planoContas'
import {
  unificar, filtrar, totais, ordenar, paraCSV, contarSemData, resumoDoGrupo,
  ROTULO_SITUACAO, CAMPOS_DE_DATA,
} from '../lib/lancamentos'

const dataBR = d => (d ? String(d).split('-').reverse().join('/') : '—')

const CORES_SITUACAO = {
  realizado: { bg: 'rgba(39,174,96,0.10)', cor: 'var(--green)' },
  aberto: { bg: 'rgba(204,145,94,0.12)', cor: 'var(--gold-dark)' },
  previsto: { bg: 'rgba(29,59,92,0.08)', cor: 'var(--text-mid)' },
}

export default function Lancamentos() {
  const { user } = useAuth()
  const [pagar, setPagar] = useState([])
  const [receber, setReceber] = useState([])
  const [plano, setPlano] = useState([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState(null)

  const [busca, setBusca] = useState('')
  const [tipo, setTipo] = useState('')
  const [situacao, setSituacao] = useState('')
  const [cat, setCat] = useState('')
  const [classificacao, setClassificacao] = useState('')
  const [campoData, setCampoData] = useState('data')
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')
  const [grupo, setGrupo] = useState('')
  const [coluna, setColuna] = useState('data')
  const [direcao, setDirecao] = useState('desc')

  const carregar = useCallback(() => {
    if (!user) return
    setLoading(true)
    // As views _lista não trazem o anexo: desenhar a lista não precisa do
    // arquivo da nota, e ele responde por quase todo o peso baixado.
    Promise.all([
      supabase.from('payable_lista').select('*'),
      supabase.from('receivable_lista').select('*'),
      fetchPlanoContas().catch(() => []),
    ])
      .then(([rP, rR, pl]) => {
        if (rP.error || rR.error) { setErro(rP.error || rR.error); setPagar([]); setReceber([]) }
        else { setErro(null); setPagar(rP.data || []); setReceber(rR.data || []) }
        setPlano(pl || [])
        setLoading(false)
      })
      .catch(e => { setErro(e); setLoading(false) })
  }, [user])

  useEffect(() => { carregar() }, [carregar])

  const todos = useMemo(() => unificar({ pagar, receber, plano }), [pagar, receber, plano])
  const filtrados = useMemo(
    () => ordenar(filtrar(todos, { busca, tipo, situacao, cat, classificacao, campoData, de, ate, grupo }), coluna, direcao),
    [todos, busca, tipo, situacao, cat, classificacao, campoData, de, ate, grupo, coluna, direcao],
  )
  const placar = useMemo(() => totais(filtrados), [filtrados])

  // Quantas linhas o período deixou de fora por NÃO TEREM a data escolhida.
  // Um lançamento em aberto não tem data de pagamento: é correto que ele fique
  // fora de "pagos em maio", e é igualmente correto que a tela diga isso em
  // vez de a pessoa achar que o lançamento sumiu.
  const semAData = useMemo(
    () => contarSemData(todos, { busca, tipo, situacao, cat, classificacao, campoData, de, ate }),
    [todos, busca, tipo, situacao, cat, classificacao, campoData, de, ate],
  )

  // Só as categorias que REALMENTE aparecem nos lançamentos: oferecer as 81 do
  // plano num filtro de consulta é devolver o problema que a tela veio resolver.
  const categorias = useMemo(() => {
    const s = new Set(todos.map(l => l.cat).filter(Boolean))
    return [...s].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [todos])

  const resumo = useMemo(() => (grupo ? resumoDoGrupo(todos, grupo) : null), [todos, grupo])

  const temFiltro = !!(busca || tipo || situacao || cat || classificacao || de || ate || grupo)
  function limpar() {
    setBusca(''); setTipo(''); setSituacao(''); setCat(''); setClassificacao(''); setDe(''); setAte(''); setGrupo('')
  }

  function ordenarPor(c) {
    if (c === coluna) setDirecao(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setColuna(c); setDirecao(c === 'valor' || c === 'data' ? 'desc' : 'asc') }
  }

  function exportar() {
    try {
      // BOM na frente: sem ele o Excel em português abre os acentos quebrados.
      const blob = new Blob(['﻿' + paraCSV(filtrados)], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `lancamentos-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
      showToast(`${filtrados.length} lançamento(s) exportado(s).`, 'success')
    } catch (e) {
      showToast(msgErro(e, 'Não consegui gerar o arquivo.'), 'error')
    }
  }

  if (erro) return <AppLayout title="Lançamentos"><EstadoErro erro={erro} onTentar={carregar} /></AppLayout>

  return (
    <AppLayout title="Lançamentos">
      <div style={{ padding: 28 }}>
        <div style={intro}>
          Tudo que foi lançado, <strong>entradas e saídas na mesma lista</strong>, com a categoria e o grupo da DRE.
          É aqui que se confere como um lançamento ficou classificado. Para dar baixa, anexar documento ou editar,
          use Contas a Receber e Contas a Pagar.
        </div>

        {/* ── FILTROS ─────────────────────────────────────────────── */}
        <div style={caixaFiltros}>
          <input
            value={busca} onChange={e => setBusca(e.target.value)}
            placeholder="Buscar por código, fornecedor, cliente, descrição, categoria…"
            style={{ ...campo, flex: '1 1 320px' }}
          />
          <select value={tipo} onChange={e => setTipo(e.target.value)} style={campo}>
            <option value="">Entradas e saídas</option>
            <option value="Entrada">Só entradas</option>
            <option value="Saída">Só saídas</option>
          </select>
          <select value={situacao} onChange={e => setSituacao(e.target.value)} style={campo}>
            <option value="">Todas as situações</option>
            {Object.entries(ROTULO_SITUACAO).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select value={cat} onChange={e => setCat(e.target.value)} style={campo}>
            <option value="">Todas as categorias</option>
            {categorias.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={classificacao} onChange={e => setClassificacao(e.target.value)} style={campo}>
            <option value="">Todos os grupos da DRE</option>
            {CLASSIFICACOES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <select value={campoData} onChange={e => setCampoData(e.target.value)} style={campo}>
              {Object.entries(CAMPOS_DE_DATA).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <input type="date" value={de} onChange={e => setDe(e.target.value)} style={campo} />
            <span style={{ fontSize: 12, color: 'var(--text-mid)' }}>até</span>
            <input type="date" value={ate} onChange={e => setAte(e.target.value)} style={campo} />
          </div>

          {temFiltro && <button onClick={limpar} style={botaoGhost}>Limpar filtros</button>}
          <button onClick={exportar} disabled={!filtrados.length} style={botao}>
            ⭳ Exportar ({filtrados.length})
          </button>
        </div>

        {resumo && (
          <div style={faixaGrupo}>
            <div>
              <strong>{resumo.nome}</strong>{' '}
              {resumo.tipo === 'contrato' ? 'parcelas do contrato' : 'compra parcelada'} —{' '}
              <strong>{fmtMoney(resumo.valor)}</strong> em {resumo.parcelasNoSistema} parcela(s),
              {' '}{resumo.pagas} paga(s).
              {resumo.parcelasNoSistema !== resumo.parcelasDoContrato && (
                <> O contrato tem <strong>{resumo.parcelasDoContrato}</strong>: {resumo.parcelasDoContrato - resumo.parcelasNoSistema} ainda
                {' '}não foram lançadas no sistema.</>
              )}
            </div>
            <button onClick={() => setGrupo('')} style={botaoGhost}>Ver todos de novo</button>
          </div>
        )}

        {/* ── PLACAR ──────────────────────────────────────────────────
            Soma o que está NA TELA, não o total geral: um placar que ignora
            o filtro mente para quem acabou de filtrar. */}
        <div style={caixaPlacar}>
          <div style={bloco}><span style={rotulo}>Lançamentos</span><strong style={numero}>{placar.quantidade}</strong></div>
          <div style={bloco}><span style={rotulo}>Entradas</span><strong style={{ ...numero, color: 'var(--green)' }}>{fmtMoney(placar.entradas)}</strong></div>
          <div style={bloco}><span style={rotulo}>Saídas</span><strong style={{ ...numero, color: 'var(--red)' }}>{fmtMoney(placar.saidas)}</strong></div>
          <div style={bloco}>
            <span style={rotulo}>Resultado</span>
            <strong style={{ ...numero, color: placar.resultado >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtMoney(placar.resultado)}</strong>
          </div>
        </div>

        {semAData > 0 && (
          <div style={avisoSemData}>
            <strong>{semAData} lançamento(s)</strong> ficaram de fora do período porque não têm
            {' '}<strong>{(CAMPOS_DE_DATA[campoData] || '').toLowerCase()}</strong> preenchida.
            {campoData === 'pagamento' && ' É o esperado para o que ainda está em aberto ou previsto.'}
            {' '}Para vê-los, troque a data do filtro ou limpe o período.
          </div>
        )}

        {/* ── LISTA ───────────────────────────────────────────────── */}
        {loading ? (
          <div style={vazio}>Carregando…</div>
        ) : !filtrados.length ? (
          <div style={vazio}>
            {todos.length ? 'Nenhum lançamento com esses filtros.' : 'Nenhum lançamento ainda.'}
          </div>
        ) : (
          <div style={caixaTabela}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {[
                    ['codigo', 'Código'], ['data', 'Data'], ['tipo', 'Tipo'], ['parte', 'Quem'],
                    ['cat', 'Categoria'], ['classificacao', 'Grupo da DRE'],
                    ['situacao', 'Situação'], ['valor', 'Valor'],
                  ].map(([c, l]) => (
                    <th key={c} onClick={() => ordenarPor(c)}
                        style={{ ...th, textAlign: c === 'valor' ? 'right' : 'left' }}>
                      {l}{coluna === c ? (direcao === 'asc' ? ' ▲' : ' ▼') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtrados.map(l => {
                  const cs = CORES_SITUACAO[l.situacao] || CORES_SITUACAO.aberto
                  return (
                    <tr key={l.tabela + l.id} style={{ borderTop: '1px solid var(--cream-dark)' }}>
                      <td style={{ ...td, fontWeight: 700, whiteSpace: 'nowrap' }}>{l.codigo || '—'}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{dataBR(l.data)}</td>
                      <td style={td}>
                        <span style={{ color: l.tipo === 'Entrada' ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>
                          {l.tipo === 'Entrada' ? '↓' : '↑'}
                        </span>{' '}{l.tipo}
                      </td>
                      <td style={{ ...td, maxWidth: 230 }}>
                        <div style={corta} title={l.parte}>
                          {l.parte}
                          {l.parcela && (
                            <button
                              onClick={() => setGrupo(l.grupoId)}
                              disabled={!l.grupoId}
                              title={l.grupoId ? 'Ver todas as parcelas' : 'Parcela sem vínculo gravado'}
                              style={{ ...etiquetaParcela, cursor: l.grupoId ? 'pointer' : 'default' }}
                            >{l.parcela}</button>
                          )}
                        </div>
                        {l.descricao && l.descricao !== l.parte &&
                          <div style={{ ...corta, fontSize: 11, color: 'var(--text-mid)' }} title={l.descricao}>{l.descricao}</div>}
                      </td>
                      <td style={{ ...td, maxWidth: 220 }}>
                        <div style={corta} title={l.cat}>{l.cat || <span style={{ color: 'var(--red)' }}>sem categoria</span>}</div>
                        {l.subcat && <div style={{ ...corta, fontSize: 11, color: 'var(--text-mid)' }} title={l.subcat}>{l.subcat}</div>}
                      </td>
                      <td style={{ ...td, fontSize: 11.5, color: 'var(--text-mid)' }}>{l.classificacao || '—'}</td>
                      <td style={td}>
                        <span style={{ ...etiqueta, background: cs.bg, color: cs.cor }}>{ROTULO_SITUACAO[l.situacao]}</span>
                      </td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap', color: l.tipo === 'Entrada' ? 'var(--green)' : 'var(--navy)' }}>
                        {fmtMoney(l.valor)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppLayout>
  )
}

const intro = { fontSize: 12.5, color: 'var(--text-mid)', lineHeight: 1.6, marginBottom: 14, maxWidth: 860 }
const caixaFiltros = { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', background: 'var(--white)', border: '1px solid var(--cream-dark)', borderRadius: 10, padding: 12, marginBottom: 12, boxShadow: 'var(--shadow)' }
const campo = { padding: '7px 9px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 12, color: 'var(--navy)', background: 'var(--white)', outline: 'none' }
const botao = { padding: '8px 14px', borderRadius: 6, border: 'none', background: 'var(--navy)', color: '#fff', fontFamily: 'var(--body)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }
const botaoGhost = { padding: '7px 12px', borderRadius: 6, border: '1.5px solid var(--cream-dark)', background: 'var(--white)', color: 'var(--text-mid)', fontFamily: 'var(--body)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }
const caixaPlacar = { display: 'flex', gap: 28, flexWrap: 'wrap', background: 'var(--white)', border: '1px solid var(--cream-dark)', borderRadius: 10, padding: '12px 16px', marginBottom: 12, boxShadow: 'var(--shadow)' }
const bloco = { display: 'flex', flexDirection: 'column', gap: 2 }
const rotulo = { fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-mid)' }
const numero = { fontSize: 16, color: 'var(--navy)' }
const caixaTabela = { background: 'var(--white)', border: '1px solid var(--cream-dark)', borderRadius: 10, overflow: 'hidden', boxShadow: 'var(--shadow)' }
const th = { padding: '10px 12px', fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: '#fff', background: 'var(--navy)', cursor: 'pointer', whiteSpace: 'nowrap', userSelect: 'none' }
const td = { padding: '8px 12px', fontSize: 12.5, color: 'var(--navy)', verticalAlign: 'top' }
const corta = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const etiqueta = { display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap' }
const faixaGrupo = { display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', fontSize: 12.5, color: 'var(--navy)', background: 'rgba(204,145,94,0.10)', border: '1px solid rgba(204,145,94,0.35)', borderRadius: 8, padding: '10px 14px', marginBottom: 12, lineHeight: 1.5 }
const etiquetaParcela = { marginLeft: 6, padding: '1px 6px', borderRadius: 999, border: '1px solid var(--cream-dark)', background: 'var(--cream)', color: 'var(--text-mid)', fontFamily: 'var(--body)', fontSize: 10.5, fontWeight: 700, verticalAlign: 'middle' }
const avisoSemData = { fontSize: 11.5, color: 'var(--navy)', background: 'rgba(204,145,94,0.10)', border: '1px solid rgba(204,145,94,0.35)', borderRadius: 8, padding: '8px 12px', marginBottom: 12, lineHeight: 1.5 }
const vazio = { background: 'var(--white)', border: '1px solid var(--cream-dark)', borderRadius: 10, padding: 28, textAlign: 'center', fontSize: 13, color: 'var(--text-mid)' }
