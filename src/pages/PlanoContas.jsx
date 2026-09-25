import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import AppLayout from '../components/AppLayout'
import { showToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'
import { CLASSIFICACOES, invalidarPlanoContas } from '../lib/planoContas'
import { construirRegras, chaveRecorrente, rotuloSituacaoFiscal } from '../lib/escrituracao'

// =====================================================================
// PLANO DE CONTAS — a tabela plano_contas é GLOBAL (sem user_id) e é a
// única fonte de categoria/subcategoria/classificação (DRE) do sistema.
// Toda configuração aqui tem efeito visível:
//   • classificação → grupo da DRE (e Fluxo: investimento/financiamento)
//   • na DRE       → entra ou não na DRE
//   • categoria/subcategoria → opções nos modais de lançamento
// Renomear NÃO altera lançamentos antigos (eles guardam o texto no jsonb).
// =====================================================================

const TIPOS = ['Entrada', 'Saída', 'Transferência']
const ABA_LABEL = { Entrada: 'Entradas', 'Saída': 'Saídas', 'Transferência': 'Transferências' }

const chaveUso = (cat, subcat) => `${cat || ''}||${subcat || ''}`

export default function PlanoContas() {
  const [plano, setPlano] = useState([])
  const [notas, setNotas] = useState([]) // linhas cruas {id, data, tabela} de payable + receivable
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState(null)
  const [aba, setAba] = useState('Saída')
  const [busca, setBusca] = useState('')

  // edições em andamento
  const [novaSubEm, setNovaSubEm] = useState(null)      // categoria que está recebendo nova subcategoria
  const [novaSubNome, setNovaSubNome] = useState('')
  const [novaCatAberta, setNovaCatAberta] = useState(false)
  const [novaCat, setNovaCat] = useState({ nome: '', classificacao: '', primeiraSub: '', na_dre: true })
  const [renomeandoCat, setRenomeandoCat] = useState(null) // { categoria, valor }
  const [renomeandoSub, setRenomeandoSub] = useState(null) // { id, valor }
  const [salvando, setSalvando] = useState(false)

  const carregar = useCallback(() => {
    setLoading(true)
    Promise.all([
      supabase.from('plano_contas').select('id,tipo,categoria,subcategoria,classificacao,na_dre,ordem').order('ordem'),
      supabase.from('payable').select('id,data'),
      supabase.from('receivable').select('id,data'),
    ]).then(([rP, rPay, rRec]) => {
      if (rP.error) { setErro(rP.error); setLoading(false); return }
      setErro(null)
      setPlano(rP.data || [])
      setNotas([
        ...(rPay.data || []).map(r => ({ ...r, tabela: 'payable' })),
        ...(rRec.data || []).map(r => ({ ...r, tabela: 'receivable' })),
      ])
      setLoading(false)
    }).catch(e => { setErro(e); setLoading(false) })
  }, [])

  useEffect(() => { carregar() }, [carregar])

  // ---- Uso: quantos lançamentos apontam pra cada categoria / subcategoria ----
  const uso = useMemo(() => {
    const porCat = new Map()
    const porSub = new Map()
    for (const n of notas) {
      const cat = n.data?.cat || ''
      if (!cat) continue
      porCat.set(cat, (porCat.get(cat) || 0) + 1)
      const k = chaveUso(cat, n.data?.subcat || '')
      porSub.set(k, (porSub.get(k) || 0) + 1)
    }
    return { porCat, porSub }
  }, [notas])
  const usoCat = cat => uso.porCat.get(cat) || 0
  const usoSub = (cat, sub) => uso.porSub.get(chaveUso(cat, sub)) || 0

  // ---- Linhas da aba, filtradas pela busca e agrupadas por categoria ----
  const grupos = useMemo(() => {
    const q = busca.trim().toLowerCase()
    const linhas = plano.filter(p => p.tipo === aba && (!q || [p.categoria, p.subcategoria, p.classificacao].filter(Boolean).join(' ').toLowerCase().includes(q)))
    const mapa = new Map()
    for (const p of linhas) {
      if (!mapa.has(p.categoria)) mapa.set(p.categoria, [])
      mapa.get(p.categoria).push(p)
    }
    return [...mapa.entries()].map(([categoria, itens]) => ({ categoria, itens }))
  }, [plano, aba, busca])

  const totalPorTipo = useMemo(() => {
    const out = {}
    for (const t of TIPOS) out[t] = plano.filter(p => p.tipo === t).length
    return out
  }, [plano])

  // ---- Gravações ----
  async function gravar(fn, msgOk) {
    setSalvando(true)
    try {
      await fn()
      invalidarPlanoContas()
      if (msgOk) showToast(msgOk, 'success')
      return true
    } catch (e) {
      showToast('Erro ao salvar: ' + (e.message || e), 'error')
      return false
    } finally { setSalvando(false) }
  }

  async function alterarLinha(id, patch) {
    const ok = await gravar(async () => {
      const { error } = await supabase.from('plano_contas').update(patch).eq('id', id)
      if (error) throw error
    })
    if (ok) setPlano(ps => ps.map(p => p.id === id ? { ...p, ...patch } : p))
  }

  async function salvarNovaSub(categoria) {
    const nome = novaSubNome.trim()
    if (!nome) { showToast('Informe o nome da subcategoria.', 'warning'); return }
    const irmas = plano.filter(p => p.tipo === aba && p.categoria === categoria)
    if (irmas.some(p => (p.subcategoria || '').toLowerCase() === nome.toLowerCase())) {
      showToast('Já existe uma subcategoria com esse nome nesta categoria.', 'warning'); return
    }
    const ref = irmas[0] || {}
    const ordem = Math.max(0, ...irmas.map(p => Number(p.ordem) || 0)) + 1
    const nova = { tipo: aba, categoria, subcategoria: nome, classificacao: ref.classificacao || null, na_dre: ref.na_dre ?? true, ordem }
    const ok = await gravar(async () => {
      const { error } = await supabase.from('plano_contas').insert(nova)
      if (error) throw error
    }, `Subcategoria "${nome}" criada em ${categoria}.`)
    if (ok) { setNovaSubEm(null); setNovaSubNome(''); carregar() }
  }

  async function salvarNovaCat() {
    const nome = novaCat.nome.trim()
    const sub = novaCat.primeiraSub.trim()
    if (!nome) { showToast('Informe o nome da categoria.', 'warning'); return }
    if (!novaCat.classificacao) { showToast('Escolha a classificação (grupo da DRE).', 'warning'); return }
    if (!sub) { showToast('Informe a primeira subcategoria.', 'warning'); return }
    if (plano.some(p => p.tipo === aba && p.categoria.toLowerCase() === nome.toLowerCase())) {
      showToast('Já existe uma categoria com esse nome neste tipo.', 'warning'); return
    }
    const ordem = Math.max(0, ...plano.map(p => Number(p.ordem) || 0)) + 1
    const ok = await gravar(async () => {
      const { error } = await supabase.from('plano_contas').insert({ tipo: aba, categoria: nome, subcategoria: sub, classificacao: novaCat.classificacao, na_dre: !!novaCat.na_dre, ordem })
      if (error) throw error
    }, `Categoria "${nome}" criada.`)
    if (ok) { setNovaCatAberta(false); setNovaCat({ nome: '', classificacao: '', primeiraSub: '', na_dre: true }); carregar() }
  }

  const [confirmar, dialogoConfirmacao] = useConfirm()

  async function confirmarRenomearCat() {
    const { categoria, valor } = renomeandoCat
    const novo = valor.trim()
    if (!novo || novo === categoria) { setRenomeandoCat(null); return }
    if (plano.some(p => p.tipo === aba && p.categoria.toLowerCase() === novo.toLowerCase())) {
      showToast('Já existe uma categoria com esse nome neste tipo.', 'warning'); return
    }
    const n = usoCat(categoria)
    const confirmado = await confirmar({
      titulo: `Renomear "${categoria}" para "${novo}"?`,
      consequencias: n > 0
        ? [
          `${n} lançamento(s) já classificados CONTINUAM com o nome antigo ("${categoria}").`,
          'O nome novo vale só para as classificações daqui em diante.',
          'Para trazer os antigos, reclassifique pela Escrituração.',
        ]
        : ['Nenhum lançamento usa esta categoria hoje — nada muda no que já existe.'],
      confirmarLabel: 'Renomear',
      width: 520,
    })
    if (!confirmado) return
    const ok = await gravar(async () => {
      const { error } = await supabase.from('plano_contas').update({ categoria: novo }).eq('tipo', aba).eq('categoria', categoria)
      if (error) throw error
    }, `Categoria renomeada para "${novo}".`)
    if (ok) { setRenomeandoCat(null); carregar() }
  }

  async function confirmarRenomearSub(linha) {
    const novo = renomeandoSub.valor.trim()
    if (!novo || novo === linha.subcategoria) { setRenomeandoSub(null); return }
    const irmas = plano.filter(p => p.tipo === aba && p.categoria === linha.categoria && p.id !== linha.id)
    if (irmas.some(p => (p.subcategoria || '').toLowerCase() === novo.toLowerCase())) {
      showToast('Já existe uma subcategoria com esse nome nesta categoria.', 'warning'); return
    }
    const n = usoSub(linha.categoria, linha.subcategoria)
    const confirmado = await confirmar({
      titulo: `Renomear "${linha.subcategoria}" para "${novo}"?`,
      consequencias: n > 0
        ? [
          `${n} lançamento(s) já classificados CONTINUAM com o nome antigo ("${linha.subcategoria}").`,
          'O nome novo vale só para as classificações daqui em diante.',
          'Para trazer os antigos, reclassifique pela Escrituração.',
        ]
        : ['Nenhum lançamento usa esta subcategoria hoje — nada muda no que já existe.'],
      confirmarLabel: 'Renomear',
      width: 520,
    })
    if (!confirmado) return
    const ok = await gravar(async () => {
      const { error } = await supabase.from('plano_contas').update({ subcategoria: novo }).eq('id', linha.id)
      if (error) throw error
    }, `Subcategoria renomeada para "${novo}".`)
    if (ok) { setRenomeandoSub(null); setPlano(ps => ps.map(p => p.id === linha.id ? { ...p, subcategoria: novo } : p)) }
  }

  async function excluirSub(linha) {
    if (usoSub(linha.categoria, linha.subcategoria) > 0) return
    const ultima = plano.filter(p => p.tipo === aba && p.categoria === linha.categoria).length === 1
    const confirmado = await confirmar({
      titulo: `Excluir "${linha.subcategoria}"?`,
      texto: `Ela está em ${linha.categoria}.`,
      consequencias: [
        'Nenhum lançamento usa esta subcategoria — por isso a exclusão é permitida.',
        ...(ultima ? [`É a última subcategoria: a categoria "${linha.categoria}" também sai do plano de contas.`] : []),
      ],
      confirmarLabel: 'Excluir',
      variante: 'perigo',
    })
    if (!confirmado) return
    const ok = await gravar(async () => {
      const { error } = await supabase.from('plano_contas').delete().eq('id', linha.id)
      if (error) throw error
    }, 'Subcategoria excluída.')
    if (ok) setPlano(ps => ps.filter(p => p.id !== linha.id))
  }

  // ---- Regras aprendidas (leitura) ----
  const regras = useMemo(() => {
    const mapa = construirRegras(notas)
    // Conta quantas escriturações manuais sustentam cada regra + guarda um nome legível.
    const suporte = new Map()
    for (const n of notas) {
      const d = n.data || {}
      if (d.escriturado !== true || d.escriturado_por !== 'manual' || !d.cat || !d.doc_status) continue
      const chave = chaveRecorrente(d)
      if (!chave || !mapa.has(chave)) continue
      const s = suporte.get(chave) || { n: 0, nome: '', tabela: n.tabela }
      s.n += 1
      if (!s.nome) s.nome = d.supplier || d.client || d.desc || ''
      suporte.set(chave, s)
    }
    return [...mapa.entries()]
      .map(([chave, r]) => ({ chave, ...r, ...(suporte.get(chave) || { n: 0, nome: '', tabela: null }) }))
      .sort((a, b) => b.n - a.n || a.nome.localeCompare(b.nome))
  }, [notas])

  const fmtChave = chave => {
    if (chave.startsWith('cnpj:')) {
      const c = chave.slice(5)
      return `CNPJ ${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`
    }
    return `descrição "${chave.slice(5)}"`
  }

  if (loading) return <AppLayout title="Plano de contas"><div style={emptyState}>Carregando…</div></AppLayout>
  if (erro) return <AppLayout title="Plano de contas"><div style={emptyState}>Erro ao carregar o plano de contas: {erro.message}</div></AppLayout>

  return (
    <AppLayout title="Plano de contas">
      <div style={{ fontSize: 12, color: 'var(--text-mid)', marginBottom: 14, lineHeight: 1.6 }}>
        Categorias e subcategorias que aparecem nos lançamentos. A <strong>classificação</strong> define em qual grupo da DRE o valor cai;
        <strong> na DRE</strong> liga/desliga a linha no relatório. Alterações valem na hora para lançamentos novos e para a DRE.
      </div>

      {/* Abas + busca + nova categoria */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {TIPOS.map(t => (
            <button key={t} onClick={() => { setAba(t); setNovaCatAberta(false); setNovaSubEm(null) }} style={aba === t ? abaAtiva : abaBtn}>
              {ABA_LABEL[t]} <span style={{ opacity: 0.7, fontWeight: 500 }}>({totalPorTipo[t]})</span>
            </button>
          ))}
        </div>
        <div style={{ position: 'relative', flex: '1 1 240px', maxWidth: 380 }}>
          <span style={{ position: 'absolute', left: 11, top: 9, fontSize: 13, color: 'var(--text-mid)' }}>🔍</span>
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar categoria, subcategoria ou classificação…" style={searchInput} />
        </div>
        <button onClick={() => setNovaCatAberta(v => !v)} style={btnNovo}>+ Nova categoria</button>
      </div>

      {novaCatAberta && (
        <div style={{ ...tableWrap, padding: 16, marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--navy)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 }}>Nova categoria em {ABA_LABEL[aba]}</div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={campo}><span style={campoLabel}>Categoria</span>
              <input value={novaCat.nome} onChange={e => setNovaCat(c => ({ ...c, nome: e.target.value }))} style={input} placeholder="ex.: Softwares e assinaturas" /></label>
            <label style={campo}><span style={campoLabel}>Classificação (grupo da DRE)</span>
              <select value={novaCat.classificacao} onChange={e => setNovaCat(c => ({ ...c, classificacao: e.target.value }))} style={input}>
                <option value="">— escolha —</option>
                {CLASSIFICACOES.map(c => <option key={c} value={c}>{c}</option>)}
              </select></label>
            <label style={campo}><span style={campoLabel}>Primeira subcategoria</span>
              <input value={novaCat.primeiraSub} onChange={e => setNovaCat(c => ({ ...c, primeiraSub: e.target.value }))} style={input} placeholder="ex.: Google Workspace" /></label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--navy)', paddingBottom: 9 }}>
              <input type="checkbox" checked={!!novaCat.na_dre} onChange={e => setNovaCat(c => ({ ...c, na_dre: e.target.checked }))} /> na DRE
            </label>
            <button onClick={salvarNovaCat} disabled={salvando} style={btnPrimary}>{salvando ? 'Salvando…' : 'Criar categoria'}</button>
            <button onClick={() => setNovaCatAberta(false)} style={btnGhost}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Tabela agrupada por categoria */}
      <div style={tableWrap}>
        {grupos.length === 0 ? (
          <div style={emptyState}>{busca ? 'Nada encontrado com esse texto.' : `Nenhuma categoria em ${ABA_LABEL[aba]}.`}</div>
        ) : (
          <table style={tbl}>
            <thead>
              <tr>
                <th style={th}>Categoria / subcategoria</th>
                <th style={{ ...th, width: 240 }}>Classificação (DRE)</th>
                <th style={{ ...th, width: 80, textAlign: 'center' }}>na DRE</th>
                <th style={{ ...th, width: 130, textAlign: 'right' }}>Uso</th>
                <th style={{ ...th, width: 150 }}></th>
              </tr>
            </thead>
            <tbody>
              {grupos.map(g => {
                const nCat = usoCat(g.categoria)
                const renCat = renomeandoCat?.categoria === g.categoria
                return [
                  <tr key={`cat-${g.categoria}`} style={{ background: 'var(--cream)' }}>
                    <td style={{ ...td, fontWeight: 700 }} colSpan={2}>
                      {renCat ? (
                        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                          <input autoFocus value={renomeandoCat.valor} onChange={e => setRenomeandoCat(r => ({ ...r, valor: e.target.value }))}
                            onKeyDown={e => { if (e.key === 'Enter') confirmarRenomearCat(); if (e.key === 'Escape') setRenomeandoCat(null) }} style={{ ...input, padding: '5px 8px', minWidth: 260 }} />
                          <button onClick={confirmarRenomearCat} disabled={salvando} style={btnMini}>Salvar</button>
                          <button onClick={() => setRenomeandoCat(null)} style={btnMiniGhost}>Cancelar</button>
                        </span>
                      ) : g.categoria}
                    </td>
                    <td style={td}></td>
                    <td style={{ ...td, textAlign: 'right', color: 'var(--text-mid)', fontSize: 11 }}>{nCat} lançamento{nCat === 1 ? '' : 's'}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      {!renCat && <button onClick={() => setRenomeandoCat({ categoria: g.categoria, valor: g.categoria })} style={btnLink} title="Renomear categoria">✎ renomear</button>}
                      <button onClick={() => { setNovaSubEm(g.categoria); setNovaSubNome('') }} style={btnLink} title="Adicionar subcategoria nesta categoria">+ subcategoria</button>
                    </td>
                  </tr>,
                  ...g.itens.map(p => {
                    const n = usoSub(p.categoria, p.subcategoria)
                    const renSub = renomeandoSub?.id === p.id
                    return (
                      <tr key={p.id}>
                        <td style={{ ...td, paddingLeft: 32 }}>
                          {renSub ? (
                            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                              <input autoFocus value={renomeandoSub.valor} onChange={e => setRenomeandoSub(r => ({ ...r, valor: e.target.value }))}
                                onKeyDown={e => { if (e.key === 'Enter') confirmarRenomearSub(p); if (e.key === 'Escape') setRenomeandoSub(null) }} style={{ ...input, padding: '5px 8px', minWidth: 240 }} />
                              <button onClick={() => confirmarRenomearSub(p)} disabled={salvando} style={btnMini}>Salvar</button>
                              <button onClick={() => setRenomeandoSub(null)} style={btnMiniGhost}>Cancelar</button>
                            </span>
                          ) : (p.subcategoria || <em style={{ color: 'var(--text-mid)' }}>(sem subcategoria)</em>)}
                        </td>
                        <td style={td}>
                          <select value={p.classificacao || ''} onChange={e => alterarLinha(p.id, { classificacao: e.target.value || null })} style={selectInline} title="Grupo da DRE em que esta subcategoria cai">
                            <option value="">— sem classificação —</option>
                            {CLASSIFICACOES.map(c => <option key={c} value={c}>{c}</option>)}
                            {p.classificacao && !CLASSIFICACOES.includes(p.classificacao) && <option value={p.classificacao}>{p.classificacao}</option>}
                          </select>
                        </td>
                        <td style={{ ...td, textAlign: 'center' }}>
                          <input type="checkbox" checked={!!p.na_dre} onChange={e => alterarLinha(p.id, { na_dre: e.target.checked })} title={p.na_dre ? 'Aparece na DRE' : 'Fora da DRE'} />
                        </td>
                        <td style={{ ...td, textAlign: 'right', color: n ? 'var(--navy)' : 'var(--text-mid)', fontSize: 11 }}>{n} lançamento{n === 1 ? '' : 's'}</td>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>
                          {!renSub && <button onClick={() => setRenomeandoSub({ id: p.id, valor: p.subcategoria || '' })} style={btnLink} title="Renomear subcategoria">✎</button>}
                          <button onClick={() => excluirSub(p)} disabled={n > 0 || salvando} style={{ ...btnLink, color: n > 0 ? 'var(--cream-dark)' : 'var(--red)', cursor: n > 0 ? 'not-allowed' : 'pointer' }}
                            title={n > 0 ? `Não dá pra excluir: ${n} lançamento${n === 1 ? '' : 's'} usa${n === 1 ? '' : 'm'} esta subcategoria. Reclassifique-os na Escrituração primeiro.` : 'Excluir subcategoria (sem uso)'}>
                            ✕
                          </button>
                        </td>
                      </tr>
                    )
                  }),
                  novaSubEm === g.categoria && (
                    <tr key={`nova-${g.categoria}`} style={{ background: 'rgba(204,145,94,0.06)' }}>
                      <td style={{ ...td, paddingLeft: 32 }} colSpan={5}>
                        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 11, color: 'var(--text-mid)' }}>Nova subcategoria em <strong>{g.categoria}</strong>:</span>
                          <input autoFocus value={novaSubNome} onChange={e => setNovaSubNome(e.target.value)} placeholder="nome da subcategoria"
                            onKeyDown={e => { if (e.key === 'Enter') salvarNovaSub(g.categoria); if (e.key === 'Escape') setNovaSubEm(null) }} style={{ ...input, padding: '5px 8px', minWidth: 260 }} />
                          <button onClick={() => salvarNovaSub(g.categoria)} disabled={salvando} style={btnMini}>{salvando ? 'Salvando…' : 'Salvar'}</button>
                          <button onClick={() => setNovaSubEm(null)} style={btnMiniGhost}>Cancelar</button>
                          <span style={{ fontSize: 10, color: 'var(--text-mid)' }}>herda a classificação da categoria; ajuste depois se precisar</span>
                        </span>
                      </td>
                    </tr>
                  ),
                ]
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Regras aprendidas */}
      <div style={{ ...tableWrap, marginTop: 24 }}>
        <div style={{ padding: '18px 24px 14px', borderBottom: '1px solid var(--cream-dark)' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--navy)' }}>Regras aprendidas</div>
          <div style={{ fontSize: 11, color: 'var(--text-mid)', marginTop: 4, lineHeight: 1.6, maxWidth: 820 }}>
            Uma regra nasce quando você escritura o mesmo fornecedor sempre do mesmo jeito. Ela <strong>nunca</strong> escritura sozinha:
            aparece pré-carregada na Escrituração e só é aplicada quando você clica em Escriturar (padrão "sugerir", não "automático").
            Se o histórico de um fornecedor diverge (classificações diferentes), não há regra para ele. {regras.length} regra{regras.length === 1 ? '' : 's'}.
          </div>
        </div>
        {regras.length === 0 ? (
          <div style={emptyState}>Nenhuma regra ainda. Elas aparecem conforme você escritura manualmente na Conciliação/Escrituração.</div>
        ) : (
          <table style={tbl}>
            <thead>
              <tr>
                <th style={th}>Fornecedor / chave</th>
                <th style={th}>Categoria</th>
                <th style={th}>Subcategoria</th>
                <th style={{ ...th, width: 170 }}>Situação fiscal</th>
                <th style={{ ...th, width: 130, textAlign: 'right' }}>Escriturações</th>
              </tr>
            </thead>
            <tbody>
              {regras.map(r => (
                <tr key={r.chave}>
                  <td style={td}>
                    <div style={{ fontWeight: 600 }}>{r.nome || '—'}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-mid)' }}>{fmtChave(r.chave)}{r.tabela ? ` · ${r.tabela === 'payable' ? 'a pagar' : 'a receber'}` : ''}</div>
                  </td>
                  <td style={td}>{r.cat || '—'}</td>
                  <td style={td}>{r.subcat || <span style={{ color: 'var(--text-mid)' }}>—</span>}</td>
                  <td style={td}>
                    {rotuloSituacaoFiscal(r.doc_status)}
                    {r.doc_status === 'dispensado' && r.doc_motivo_dispensa && <div style={{ fontSize: 10, color: 'var(--text-mid)' }}>{r.doc_motivo_dispensa}</div>}
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{r.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    {dialogoConfirmacao}
    </AppLayout>
  )
}

// ---- estilos (mesma família de ContasBancarias) ----
const btnNovo = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 6, border: 'none', background: 'var(--gold)', color: '#fff', fontFamily: 'var(--body)', fontSize: 12, fontWeight: 700, letterSpacing: 0.5, cursor: 'pointer', textTransform: 'uppercase' }
const searchInput = { width: '100%', padding: '10px 13px 10px 32px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 12, color: 'var(--navy)', background: 'var(--white)', outline: 'none' }
const tableWrap = { background: 'var(--white)', borderRadius: 12, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)', overflow: 'clip' }
const tbl = { width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--body)' }
const th = { textAlign: 'left', padding: '12px 14px', fontSize: 9, fontWeight: 700, letterSpacing: 1.5, color: '#fff', textTransform: 'uppercase', background: 'var(--navy)', borderBottom: '2px solid var(--gold)' }
const td = { padding: '10px 14px', fontSize: 12, color: 'var(--navy)', borderBottom: '1px solid var(--cream-dark)', verticalAlign: 'middle' }
const emptyState = { padding: '60px 24px', textAlign: 'center', fontFamily: 'var(--body)', color: 'var(--text-mid)', fontSize: 13 }
const abaBtn = { padding: '8px 14px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, background: 'var(--white)', color: 'var(--navy)', fontFamily: 'var(--body)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }
const abaAtiva = { ...abaBtn, background: 'var(--navy)', color: '#fff', borderColor: 'var(--navy)' }
const campo = { display: 'flex', flexDirection: 'column', gap: 5, flex: '1 1 200px', minWidth: 180 }
const campoLabel = { fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--text-mid)' }
const input = { padding: '9px 11px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 13, color: 'var(--navy)', background: 'var(--white)', outline: 'none' }
const selectInline = { width: '100%', padding: '5px 8px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 12, color: 'var(--navy)', background: 'var(--white)', outline: 'none' }
const btnPrimary = { padding: '9px 18px', border: 'none', borderRadius: 6, background: 'var(--gold)', color: '#fff', fontFamily: 'var(--body)', fontSize: 12, fontWeight: 700, letterSpacing: 0.5, cursor: 'pointer' }
const btnGhost = { padding: '9px 14px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, background: 'var(--white)', color: 'var(--navy)', fontFamily: 'var(--body)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }
const btnMini = { ...btnPrimary, padding: '5px 10px', fontSize: 11 }
const btnMiniGhost = { ...btnGhost, padding: '5px 10px', fontSize: 11 }
const btnLink = { background: 'none', border: 'none', color: 'var(--gold-dark)', fontFamily: 'var(--body)', fontSize: 11, fontWeight: 600, cursor: 'pointer', padding: '2px 6px' }
