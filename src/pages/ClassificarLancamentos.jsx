import { useCallback, useEffect, useMemo, useState } from 'react'
import AppLayout from '../components/AppLayout'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { fmtMoney, flatten } from '../lib/finance'
import { fetchPlanoContas, categoriasDe, subcategoriasDe } from '../lib/planoContas'
import { proximoCodigoReceivable, proximoCodigoPayable } from '../lib/codigos'
import { showToast } from '../components/Toast'
import {
  construirRegras, regraPara, escriturarAuto,
  SITUACOES_FISCAIS, semDocumentoDe,
} from '../lib/escrituracao'
import SeletorNF from './components/SeletorNF'

// =====================================================================
// ESCRITURAÇÃO — 1ª camada da conciliação. Mostra tudo que está
// "A escriturar" (escriturado != true), agrupado por fornecedor. Você
// revisa categoria + situação fiscal (OBRIGATÓRIA) e clica "Escriturar".
// Só depois disso a nota fica disponível pra conciliação.
//
// Recorrente já aprovada antes (histórico manual unânime) sobe sozinha
// pela regra aprendida — botão "Escriturar automáticas".
// =====================================================================

// Chave de agrupamento visual: fornecedor sem o sufixo de parcela.
function chaveGrupo(it) {
  const base = it.data?.supplier || it.data?.client || it.desc || it.codigo || '—'
  return (String(base).replace(/\s*\d{1,2}\/\d{1,2}.*$/, '').trim()) || String(base)
}

// O lançamento JÁ tem a prova fiscal? (NFS-e própria/número, anexo, ou já vinculado)
function temNF(it) {
  return !!(it?.data?.numero_nf || it?.anexo_path || it?.data?.doc_status === 'vinculado')
}

// Data YYYY-MM-DD → DD/MM/YYYY.
const br = s => s ? String(s).split('T')[0].split('-').reverse().join('/') : '—'

export default function ClassificarLancamentos() {
  const { user } = useAuth()
  const [payable, setPayable] = useState([])       // A escriturar (despesas)
  const [receivable, setReceivable] = useState([]) // A escriturar (receitas)
  const [regras, setRegras] = useState(new Map())  // regras aprendidas (manual unânime)
  const [plano, setPlano] = useState([])
  const [loading, setLoading] = useState(true)
  const [aba, setAba] = useState('Saída') // Saída = despesas · Entrada = receitas
  const [sel, setSel] = useState({})       // chave -> { cat, subcat, situacao_fiscal, motivo }
  const [salvando, setSalvando] = useState(null)
  const [autoRodando, setAutoRodando] = useState(false)
  const [expandido, setExpandido] = useState(new Set())   // grupos abertos p/ ver os itens
  const [desmarcados, setDesmarcados] = useState(new Set()) // itens DESmarcados dentro de um grupo aberto
  const [seletorNF, setSeletorNF] = useState(null)          // { compra, tabela, classificacao } p/ vincular NF

  const carregar = useCallback(() => {
    if (!user) return
    setLoading(true)
    Promise.all([
      supabase.from('payable').select('id,codigo,data,anexo_path,conciliado_em'),
      supabase.from('receivable').select('id,codigo,data,anexo_path,conciliado_em'),
      fetchPlanoContas(),
    ]).then(([rP, rR, pl]) => {
      // Fila = A escriturar (escriturado != true) E ainda não conciliada E não é provisão.
      const pendentes = arr => (arr || [])
        .filter(r => !r.conciliado_em && r.data?.escriturado !== true && r.data?.status !== 'Provisão')
        .map(flatten)
      setPayable(pendentes(rP.data))
      setReceivable(pendentes(rR.data))
      // Regras: das notas escrituradas MANUALMENTE (as duas tabelas).
      const manuais = [
        ...(rP.data || []).map(r => ({ ...r, tabela: 'payable' })),
        ...(rR.data || []).map(r => ({ ...r, tabela: 'receivable' })),
      ]
      setRegras(construirRegras(manuais))
      setPlano(pl || [])
      setLoading(false)
    })
  }, [user])
  useEffect(() => { carregar() }, [carregar])

  const grupos = useMemo(() => {
    const src = aba === 'Saída' ? payable : receivable
    const map = new Map()
    for (const it of src) {
      const key = chaveGrupo(it)
      if (!map.has(key)) map.set(key, { key, nome: key, itens: [], total: 0, rep: it })
      const g = map.get(key)
      g.itens.push(it)
      g.total += it.value
    }
    // Anexa a regra aprendida (se houver) a cada grupo.
    for (const g of map.values()) g.regra = regraPara(g.rep.data, regras)
    return [...map.values()].sort((a, b) => b.total - a.total)
  }, [aba, payable, receivable, regras])

  const categorias = useMemo(() => categoriasDe(plano, aba), [plano, aba])
  const totalPend = payable.length + receivable.length
  const gruposComRegra = useMemo(() => grupos.filter(g => g.regra), [grupos])

  function setCampo(key, campo, valor) {
    setSel(s => ({ ...s, [key]: { ...s[key], [campo]: valor, ...(campo === 'cat' ? { subcat: '' } : {}) } }))
  }

  // Validação: categoria + situação fiscal obrigatórias; motivo obrigatório quando não é "com NF".
  function validar(s) {
    if (!s?.cat) return 'Escolha uma categoria.'
    if (!s?.situacao_fiscal) return 'Informe a situação fiscal.'
    if (s.situacao_fiscal !== 'vinculado' && !String(s.motivo || '').trim()) return 'Descreva o motivo (sem NF / NF pendente).'
    return null
  }

  // Alterna abrir/fechar um grupo (drill-down nos itens).
  function toggleExpandir(key) {
    setExpandido(s => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n })
  }
  // Marca/desmarca um item dentro de um grupo aberto (pra escriturar só um subconjunto).
  function toggleItem(id) {
    setDesmarcados(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  async function escriturar(grupo) {
    const s = sel[grupo.key]
    const erro = validar(s)
    if (erro) { showToast(erro, 'warning'); return }
    // Só escritura os itens MARCADOS (permite dividir um grupo heterogêneo tipo Sicoob).
    const itensAlvo = grupo.itens.filter(it => !desmarcados.has(it.id))
    if (!itensAlvo.length) { showToast('Nenhum item marcado neste grupo.', 'warning'); return }
    const table = aba === 'Saída' ? 'payable' : 'receivable'
    const agora = new Date().toISOString()

    // "Com NF": escritura DIRETO os que já têm a nota (NFS-e própria / número / anexo).
    // Só os que ainda NÃO têm nota precisam do "Vincular NF" (prova).
    if (s.situacao_fiscal === 'vinculado') {
      const comNota = itensAlvo.filter(temNF)
      const semNota = itensAlvo.filter(it => !temNF(it))
      if (!comNota.length) {
        showToast('Nenhum destes tem nota ainda. Clique "Vincular NF" para anexar, ou use "NF pendente"/"Sem NF".', 'warning')
        setExpandido(prev => new Set(prev).add(grupo.key))
        return
      }
      setSalvando(grupo.key)
      try {
        await Promise.all(comNota.map(it =>
          supabase.from(table).update({ data: {
            ...it.data,
            cat: s.cat, subcat: s.subcat || '',
            doc_status: 'vinculado', doc_motivo_dispensa: '', sem_documento: false,
            escriturado: true, escriturado_em: agora, escriturado_por: 'manual',
          } }).eq('id', it.id),
        ))
        let msg = `${comNota.length} escriturado(s) com NF.`
        if (semNota.length) msg += ` ${semNota.length} sem nota — vincule ou mude a situação fiscal.`
        showToast(msg, 'success')
        carregar()
      } catch (e) { showToast('Erro ao escriturar: ' + e.message, 'error') }
      finally { setSalvando(null) }
      return
    }

    // Sem NF / NF pendente: escritura em lote com o motivo.
    setSalvando(grupo.key)
    try {
      await Promise.all(itensAlvo.map(it =>
        supabase.from(table).update({ data: {
          ...it.data,
          cat: s.cat, subcat: s.subcat || '',
          doc_status: s.situacao_fiscal,
          doc_motivo_dispensa: s.motivo.trim(),
          sem_documento: semDocumentoDe(s.situacao_fiscal),
          escriturado: true, escriturado_em: agora, escriturado_por: 'manual',
        } }).eq('id', it.id),
      ))
      showToast(`${itensAlvo.length} lançamento(s) escriturado(s) — já disponível(is) pra conciliação.`, 'success')
      carregar()
    } catch (e) {
      showToast('Erro ao escriturar: ' + e.message, 'error')
    } finally {
      setSalvando(null)
    }
  }

  // Escritura em lote todos os grupos que têm regra aprendida (recorrentes).
  async function escriturarAutomaticas() {
    const alvo = gruposComRegra
    if (!alvo.length) { showToast('Nenhuma recorrente reconhecida agora.', 'info'); return }
    if (!window.confirm(
      `${alvo.length} grupo(s) recorrente(s) reconhecido(s) pelo histórico.\n\n` +
      'Escriturar automaticamente, copiando fielmente a classificação já aprovada por você? ' +
      'Fica tudo marcado como automático e você pode reverter.'
    )) return
    setAutoRodando(true)
    const table = aba === 'Saída' ? 'payable' : 'receivable'
    const agora = new Date().toISOString()
    try {
      let n = 0
      for (const g of alvo) {
        await Promise.all(g.itens.map(it =>
          supabase.from(table).update({ data: escriturarAuto(it.data, g.regra, agora) }).eq('id', it.id),
        ))
        n += g.itens.length
      }
      showToast(`${n} lançamento(s) escriturado(s) automaticamente por regra recorrente.`, 'success')
      carregar()
    } catch (e) {
      showToast('Erro na escrituração automática: ' + e.message, 'error')
    } finally {
      setAutoRodando(false)
    }
  }

  // Muda a NATUREZA do grupo: move receita⇄despesa (tabela).
  async function moverGrupo(grupo) {
    const destino = aba === 'Saída' ? 'receivable' : 'payable'
    const origem = aba === 'Saída' ? 'payable' : 'receivable'
    const nomeDest = aba === 'Saída' ? 'Receitas' : 'Despesas'
    if (!window.confirm(`"${grupo.nome}" (${grupo.itens.length} lançamento(s)) é ${aba === 'Saída' ? 'receita' : 'despesa'}?\n\nMover para ${nomeDest}. Valores e anexos preservados; a escrituração continua pendente lá.`)) return
    setSalvando(grupo.key)
    try {
      const base = destino === 'payable' ? await proximoCodigoPayable() : await proximoCodigoReceivable()
      const prefixo = base[0]
      let num = parseInt(base.slice(1), 10)
      const rows = grupo.itens.map((it, i) => {
        const d = { ...it.data }
        if (destino === 'receivable') { d.client = d.supplier || d.client; delete d.supplier }
        else { d.supplier = d.client || d.supplier; delete d.client }
        if (d.status === (origem === 'receivable' ? 'Recebido' : 'Pago')) d.status = destino === 'receivable' ? 'Recebido' : 'Pago'
        d.cat = ''; d.subcat = ''; d.movido_de = origem
        d.escriturado = false // muda de natureza → re-escritura na nova direção
        return { user_id: user.id, codigo: `${prefixo}${String(num + i).padStart(5, '0')}`, anexo_path: it.anexo_path || null, data: d }
      })
      const { error: e1 } = await supabase.from(destino).insert(rows)
      if (e1) throw e1
      const { error: e2 } = await supabase.from(origem).delete().in('id', grupo.itens.map(x => x.id))
      if (e2) { showToast('Copiado, mas falhou remover o original — apague manualmente.', 'warning') }
      else showToast(`${grupo.itens.length} movido(s) para ${nomeDest}.`, 'success')
      carregar()
    } catch (e) {
      showToast('Erro ao mover: ' + e.message, 'error')
    } finally {
      setSalvando(null)
    }
  }

  if (loading) return <AppLayout title="Escrituração"><div style={emptyState}>Carregando…</div></AppLayout>

  return (
    <AppLayout title="Escrituração">
      <div style={{ fontSize: 12, color: 'var(--text-mid)', marginBottom: 16, lineHeight: 1.6 }}>
        Estes lançamentos estão <strong>aguardando escrituração</strong> — não sobem pra conciliação até você revisar
        categoria e <strong>situação fiscal</strong> e clicar <strong>Escriturar</strong>.
        {totalPend === 0 && <span style={{ color: 'var(--green)' }}> Tudo escriturado! 🎉</span>}
      </div>

      {gruposComRegra.length > 0 && (
        <div style={autoBox}>
          <div style={{ fontSize: 12, color: 'var(--navy)' }}>
            <strong>{gruposComRegra.length}</strong> grupo(s) recorrente(s) reconhecido(s) pelo histórico — a classificação já aprovada por você pode ser aplicada fielmente.
          </div>
          <button onClick={escriturarAutomaticas} disabled={autoRodando} style={btnAuto}>
            {autoRodando ? 'Escriturando…' : `↻ Escriturar automáticas (${gruposComRegra.length})`}
          </button>
        </div>
      )}

      <div style={tabsBar}>
        <button onClick={() => setAba('Saída')} style={aba === 'Saída' ? tabActive : tabInactive}>Despesas ({payable.length})</button>
        <button onClick={() => setAba('Entrada')} style={aba === 'Entrada' ? tabActive : tabInactive}>Receitas ({receivable.length})</button>
      </div>

      {grupos.length === 0 ? (
        <div style={card}><div style={emptyState}>Nada a escriturar aqui. ✓</div></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {grupos.map(g => {
            const s = sel[g.key] || {}
            const subs = subcategoriasDe(plano, aba, s.cat)
            const precisaMotivo = s.situacao_fiscal && s.situacao_fiscal !== 'vinculado'
            const comNF = s.situacao_fiscal === 'vinculado'
            const aberto = expandido.has(g.key) || comNF // Com NF abre pra vincular por item
            const itensMarcados = g.itens.filter(it => !desmarcados.has(it.id))
            const parcial = g.itens.length > 1 && itensMarcados.length !== g.itens.length
            return (
              <div key={g.key} style={card}>
                <div style={grpRow}>
                  <div style={{ minWidth: 0, flex: '1 1 240px', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    {g.itens.length > 1 && (
                      <button onClick={() => toggleExpandir(g.key)} style={btnExpandir} title={aberto ? 'Fechar' : 'Ver os lançamentos'}>
                        {aberto ? '▾' : '▸'}
                      </button>
                    )}
                    <div style={{ minWidth: 0 }}>
                      <div style={grpNome} title={g.nome}>
                        {g.nome}
                        {g.regra && <span style={badgeRegra} title={`Recorrente reconhecida: ${g.regra.cat}`}>recorrente</span>}
                      </div>
                      <div style={grpMeta}>
                        {parcial
                          ? <><strong style={{ color: 'var(--gold-dark)' }}>{itensMarcados.length}</strong> de {g.itens.length} marcado(s)</>
                          : <>{g.itens.length} lançamento(s)</>} · <strong style={{ color: aba === 'Saída' ? 'var(--red)' : 'var(--green)' }}>{fmtMoney(itensMarcados.reduce((a, x) => a + x.value, 0))}</strong>
                      </div>
                    </div>
                  </div>
                  <select value={s.cat || ''} onChange={e => setCampo(g.key, 'cat', e.target.value)} style={selectStyle}>
                    <option value="">— categoria —</option>
                    {categorias.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <select value={s.subcat || ''} onChange={e => setCampo(g.key, 'subcat', e.target.value)} style={{ ...selectStyle, opacity: subs.length ? 1 : 0.5 }} disabled={!subs.length}>
                    <option value="">{subs.length ? '— subcategoria —' : 'sem subcategoria'}</option>
                    {subs.map(sc => <option key={sc} value={sc}>{sc}</option>)}
                  </select>
                  <select value={s.situacao_fiscal || ''} onChange={e => setCampo(g.key, 'situacao_fiscal', e.target.value)} style={{ ...selectStyle, flex: '1 1 150px', borderColor: s.situacao_fiscal ? 'var(--cream-dark)' : 'var(--gold)' }}>
                    <option value="">— situação fiscal * —</option>
                    {SITUACOES_FISCAIS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                {precisaMotivo && (
                  <input
                    value={s.motivo || ''}
                    onChange={e => setCampo(g.key, 'motivo', e.target.value)}
                    placeholder="Motivo (por que não tem NF / o que está pendente)…"
                    style={motivoInput}
                  />
                )}
                {aberto && (
                  <div style={itensBox}>
                    <div style={{ fontSize: 10, color: 'var(--text-mid)', marginBottom: 6 }}>
                      {comNF
                        ? <>Os que <strong>já têm nota</strong> (✓) são escriturados direto no botão <strong>Escriturar</strong>. Só clique <strong>Vincular NF</strong> nos que ainda não têm.</>
                        : <>Desmarque os que <strong>não</strong> são desta classificação (ex.: no Sicoob, separe tarifa de IOF). Só os marcados serão escriturados.</>}
                    </div>
                    {g.itens.map(it => {
                      const marcado = !desmarcados.has(it.id)
                      const jaTem = temNF(it)
                      const receb = it.data?.data_pagamento || it.due
                      const labelReceb = aba === 'Entrada' ? 'receb.' : 'venc.'
                      return (
                        <div key={it.id} style={{ ...itemRow, opacity: (comNF || marcado) ? 1 : 0.5 }}>
                          {!comNF && <input type="checkbox" checked={marcado} onChange={() => toggleItem(it.id)} />}
                          <span style={{ color: 'var(--text-mid)', width: 130, flexShrink: 0, fontSize: 10 }}>
                            comp {br(it.data?.data_competencia || it.due)}<br />
                            <span style={{ color: it.data?.data_pagamento ? 'var(--green)' : 'var(--text-mid)' }}>{labelReceb} {br(receb)}{it.data?.data_pagamento ? ' ✓' : ''}</span>
                          </span>
                          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.desc || it.data?.supplier || it.data?.client || '—'}</span>
                          <span style={{ fontWeight: 600, width: 96, textAlign: 'right', flexShrink: 0 }}>{fmtMoney(it.value)}</span>
                          {comNF
                            ? (jaTem
                                ? <span style={{ width: 110, textAlign: 'right', color: 'var(--green)', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>✓ NF {it.data?.numero_nf || ''}</span>
                                : <button
                                    onClick={() => { if (!s.cat) { showToast('Escolha a categoria antes de vincular.', 'warning'); return } setSeletorNF({ compra: it, tabela: aba === 'Saída' ? 'payable' : 'receivable', classificacao: { cat: s.cat, subcat: s.subcat || '' } }) }}
                                    style={btnVincularItem}
                                  >🔗 Vincular NF</button>)
                            : <span style={{ width: 62, textAlign: 'right', color: 'var(--text-mid)', fontSize: 10, flexShrink: 0 }}>{it.codigo || ''}</span>}
                        </div>
                      )
                    })}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
                  <button
                    onClick={() => moverGrupo(g)}
                    disabled={salvando === g.key}
                    style={{ ...btnNatureza, opacity: salvando === g.key ? 0.5 : 1 }}
                    title={`É ${aba === 'Saída' ? 'receita' : 'despesa'}? Mover para ${aba === 'Saída' ? 'Receitas' : 'Despesas'}`}
                  >
                    ⇄ {aba === 'Saída' ? 'é receita' : 'é despesa'}
                  </button>
                  <button
                    onClick={() => escriturar(g)}
                    disabled={!!validar(s) || salvando === g.key || itensMarcados.length === 0}
                    style={{ ...btnAplicar, opacity: (validar(s) || salvando === g.key || itensMarcados.length === 0) ? 0.5 : 1, cursor: (validar(s) || salvando === g.key || itensMarcados.length === 0) ? 'default' : 'pointer' }}
                  >
                    {salvando === g.key ? 'Escriturando…' : (parcial ? `Escriturar ${itensMarcados.length}` : 'Escriturar')}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <SeletorNF
        open={!!seletorNF}
        compra={seletorNF?.compra}
        compraTabela={seletorNF?.tabela}
        classificacao={seletorNF?.classificacao}
        user={user}
        onClose={() => setSeletorNF(null)}
        onVinculado={() => { setSeletorNF(null); carregar() }}
      />
    </AppLayout>
  )
}

const emptyState = { padding: '60px 24px', textAlign: 'center', fontFamily: 'var(--body)', color: 'var(--text-mid)', fontSize: 13 }
const card = { background: 'var(--white)', borderRadius: 10, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)', padding: 14 }
const autoBox = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', background: 'var(--cream)', border: '1px solid var(--gold)', borderRadius: 10, padding: '12px 14px', marginBottom: 14 }
const grpRow = { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }
const grpNome = { fontSize: 13, fontWeight: 600, color: 'var(--navy)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 8 }
const grpMeta = { fontSize: 11, color: 'var(--text-mid)', marginTop: 2 }
const badgeRegra = { fontSize: 9, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--gold)', border: '1px solid var(--gold)', borderRadius: 4, padding: '1px 5px' }
const btnExpandir = { border: 'none', background: 'none', color: 'var(--navy)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '2px 4px', flexShrink: 0 }
const itensBox = { marginTop: 10, padding: '10px 12px', background: 'var(--cream)', borderRadius: 8, border: '1px solid var(--cream-dark)' }
const itemRow = { display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', fontSize: 11, color: 'var(--navy)', borderBottom: '1px solid rgba(0,0,0,0.04)' }
const btnVincularItem = { border: '1.5px solid var(--navy)', background: 'var(--white)', color: 'var(--navy)', borderRadius: 6, padding: '4px 10px', fontSize: 10, fontWeight: 700, fontFamily: 'var(--body)', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }
const tabsBar = { display: 'flex', gap: 4, marginBottom: 16, background: 'var(--cream)', padding: 4, borderRadius: 8, width: 'fit-content' }
const tabBase = { border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 11, fontWeight: 700, letterSpacing: 0.5, cursor: 'pointer', fontFamily: 'var(--body)', textTransform: 'uppercase' }
const tabActive = { ...tabBase, background: 'var(--navy)', color: '#fff' }
const tabInactive = { ...tabBase, background: 'transparent', color: 'var(--text-mid)' }
const selectStyle = { fontFamily: 'var(--body)', fontSize: 12, padding: '8px 10px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, background: 'var(--white)', color: 'var(--navy)', cursor: 'pointer', outline: 'none', flex: '1 1 160px', minWidth: 140 }
const motivoInput = { width: '100%', boxSizing: 'border-box', fontFamily: 'var(--body)', fontSize: 12, padding: '8px 10px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, background: 'var(--white)', color: 'var(--navy)', outline: 'none', marginTop: 8 }
const btnAplicar = { border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 12, fontWeight: 700, background: 'var(--navy)', color: '#fff', fontFamily: 'var(--body)' }
const btnAuto = { border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 12, fontWeight: 700, background: 'var(--gold)', color: '#fff', fontFamily: 'var(--body)', cursor: 'pointer', whiteSpace: 'nowrap' }
const btnNatureza = { border: '1.5px solid var(--cream-dark)', borderRadius: 6, padding: '8px 12px', fontSize: 11, fontWeight: 600, background: 'var(--white)', color: 'var(--text-mid)', fontFamily: 'var(--body)', cursor: 'pointer', whiteSpace: 'nowrap' }
