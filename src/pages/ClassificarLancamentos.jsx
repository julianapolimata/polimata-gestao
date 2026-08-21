import { useCallback, useEffect, useMemo, useState } from 'react'
import AppLayout from '../components/AppLayout'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { fmtMoney, flatten } from '../lib/finance'
import { fetchPlanoContas, categoriasDe, subcategoriasDe } from '../lib/planoContas'
import { showToast } from '../components/Toast'

// =====================================================================
// CLASSIFICAR EM MASSA — mostra tudo que está SEM categoria e deixa
// classificar rápido, em lote, agrupado por fornecedor (as parcelas de
// uma mesma série entram juntas). Destrava a DRE, que só conta o que
// tem classificação no plano de contas.
// =====================================================================

// Chave de agrupamento: fornecedor/descrição sem o sufixo de parcela (NN/MM…).
function chaveGrupo(it) {
  const base = it.data?.supplier || it.desc || it.codigo || '—'
  return (String(base).replace(/\s*\d{1,2}\/\d{1,2}.*$/, '').trim()) || String(base)
}

export default function ClassificarLancamentos() {
  const { user } = useAuth()
  const [payable, setPayable] = useState([])
  const [receivable, setReceivable] = useState([])
  const [plano, setPlano] = useState([])
  const [loading, setLoading] = useState(true)
  const [aba, setAba] = useState('Saída') // Saída = despesas · Entrada = receitas
  const [sel, setSel] = useState({})       // chave -> { cat, subcat }
  const [salvando, setSalvando] = useState(null)

  const carregar = useCallback(() => {
    if (!user) return
    setLoading(true)
    Promise.all([
      supabase.from('payable').select('id,codigo,data'),
      supabase.from('receivable').select('id,codigo,data'),
      fetchPlanoContas(),
    ]).then(([rP, rR, pl]) => {
      const semCat = arr => (arr || []).map(flatten).filter(x => !String(x.data?.cat || '').trim() && x.data?.status !== 'Provisão')
      setPayable(semCat(rP.data))
      setReceivable(semCat(rR.data))
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
      if (!map.has(key)) map.set(key, { key, nome: key, itens: [], total: 0 })
      const g = map.get(key)
      g.itens.push(it)
      g.total += it.value
    }
    return [...map.values()].sort((a, b) => b.total - a.total)
  }, [aba, payable, receivable])

  const categorias = useMemo(() => categoriasDe(plano, aba), [plano, aba])
  const totalPend = payable.length + receivable.length

  function setCampo(key, campo, valor) {
    setSel(s => ({ ...s, [key]: { ...s[key], [campo]: valor, ...(campo === 'cat' ? { subcat: '' } : {}) } }))
  }

  async function aplicar(grupo) {
    const s = sel[grupo.key]
    if (!s?.cat) { showToast('Escolha uma categoria antes.', 'warning'); return }
    setSalvando(grupo.key)
    const table = aba === 'Saída' ? 'payable' : 'receivable'
    try {
      await Promise.all(grupo.itens.map(it =>
        supabase.from(table).update({ data: { ...it.data, cat: s.cat, subcat: s.subcat || '' } }).eq('id', it.id),
      ))
      showToast(`${grupo.itens.length} lançamento(s) classificados como "${s.cat}".`, 'success')
      carregar()
    } catch (e) {
      showToast('Erro ao salvar: ' + e.message, 'error')
    } finally {
      setSalvando(null)
    }
  }

  if (loading) return <AppLayout title="Classificar Lançamentos"><div style={emptyState}>Carregando…</div></AppLayout>

  return (
    <AppLayout title="Classificar Lançamentos">
      <div style={{ fontSize: 12, color: 'var(--text-mid)', marginBottom: 16, lineHeight: 1.6 }}>
        Estes lançamentos estão <strong>sem categoria</strong> — por isso não aparecem na DRE. Escolha a categoria de cada grupo (as parcelas de uma série já vêm juntas) e clique <strong>Classificar</strong>.
        {totalPend === 0 && <span style={{ color: 'var(--green)' }}> Tudo classificado! 🎉</span>}
      </div>

      <div style={tabsBar}>
        <button onClick={() => setAba('Saída')} style={aba === 'Saída' ? tabActive : tabInactive}>Despesas ({payable.length})</button>
        <button onClick={() => setAba('Entrada')} style={aba === 'Entrada' ? tabActive : tabInactive}>Receitas ({receivable.length})</button>
      </div>

      {grupos.length === 0 ? (
        <div style={card}><div style={emptyState}>Nada a classificar aqui. ✓</div></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {grupos.map(g => {
            const s = sel[g.key] || {}
            const subs = subcategoriasDe(plano, aba, s.cat)
            return (
              <div key={g.key} style={card}>
                <div style={grpRow}>
                  <div style={{ minWidth: 0, flex: '1 1 260px' }}>
                    <div style={grpNome} title={g.nome}>{g.nome}</div>
                    <div style={grpMeta}>{g.itens.length} lançamento(s) · <strong style={{ color: aba === 'Saída' ? 'var(--red)' : 'var(--green)' }}>{fmtMoney(g.total)}</strong></div>
                  </div>
                  <select value={s.cat || ''} onChange={e => setCampo(g.key, 'cat', e.target.value)} style={selectStyle}>
                    <option value="">— categoria —</option>
                    {categorias.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <select value={s.subcat || ''} onChange={e => setCampo(g.key, 'subcat', e.target.value)} style={{ ...selectStyle, opacity: subs.length ? 1 : 0.5 }} disabled={!subs.length}>
                    <option value="">{subs.length ? '— subcategoria (opcional) —' : 'sem subcategoria'}</option>
                    {subs.map(sc => <option key={sc} value={sc}>{sc}</option>)}
                  </select>
                  <button
                    onClick={() => aplicar(g)}
                    disabled={!s.cat || salvando === g.key}
                    style={{ ...btnAplicar, opacity: (!s.cat || salvando === g.key) ? 0.5 : 1, cursor: (!s.cat || salvando === g.key) ? 'default' : 'pointer' }}
                  >
                    {salvando === g.key ? 'Salvando…' : 'Classificar'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </AppLayout>
  )
}

const emptyState = { padding: '60px 24px', textAlign: 'center', fontFamily: 'var(--body)', color: 'var(--text-mid)', fontSize: 13 }
const card = { background: 'var(--white)', borderRadius: 10, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)', padding: 14 }
const grpRow = { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }
const grpNome = { fontSize: 13, fontWeight: 600, color: 'var(--navy)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const grpMeta = { fontSize: 11, color: 'var(--text-mid)', marginTop: 2 }
const tabsBar = { display: 'flex', gap: 4, marginBottom: 16, background: 'var(--cream)', padding: 4, borderRadius: 8, width: 'fit-content' }
const tabBase = { border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 11, fontWeight: 700, letterSpacing: 0.5, cursor: 'pointer', fontFamily: 'var(--body)', textTransform: 'uppercase' }
const tabActive = { ...tabBase, background: 'var(--navy)', color: '#fff' }
const tabInactive = { ...tabBase, background: 'transparent', color: 'var(--text-mid)' }
const selectStyle = { fontFamily: 'var(--body)', fontSize: 12, padding: '8px 10px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, background: 'var(--white)', color: 'var(--navy)', cursor: 'pointer', outline: 'none', flex: '1 1 170px', minWidth: 150 }
const btnAplicar = { border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 12, fontWeight: 700, background: 'var(--navy)', color: '#fff', fontFamily: 'var(--body)' }
