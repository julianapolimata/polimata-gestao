import { useEffect, useState } from 'react'
import { PERIODOS_LANCAMENTO } from '../../lib/dateRanges'
import { fetchPlanoContas, categoriasDe } from '../../lib/planoContas'

// =============================================================================
// FILTROS AVANÇADOS — barra colapsável de filtros pra Receber/Pagar.
// Estado é controlado pelo pai (lifting state up): aqui só dispara onChange.
// =============================================================================

export default function FiltrosAvancados({
  tipo,           // 'rec' | 'pay' — define categoria (Entrada/Saída) e textos
  filtros,        // { periodo, dataDe, dataAte, categoria, vmin, vmax }
  setFiltros,
  expanded,
  setExpanded,
}) {
  const [categorias, setCategorias] = useState([])
  const tipoFinanc = tipo === 'rec' ? 'Entrada' : 'Saída'

  useEffect(() => {
    fetchPlanoContas().then(plano => setCategorias(categoriasDe(plano, tipoFinanc)))
  }, [tipoFinanc])

  const algumAtivo = !!(filtros.periodo || filtros.categoria || filtros.vmin || filtros.vmax)
  const isCustom = filtros.periodo === 'custom'

  function up(patch) { setFiltros(f => ({ ...f, ...patch })) }
  function limpar() {
    setFiltros({ periodo: '', dataDe: '', dataAte: '', categoria: '', vmin: '', vmax: '' })
  }

  return (
    <div style={wrap}>
      <button
        onClick={() => setExpanded(v => !v)}
        style={toggle}
        aria-expanded={expanded}
      >
        <span>{expanded ? '▾' : '▸'}</span>
        <span>Filtros avançados</span>
        {algumAtivo && (
          <span style={badge}>
            {[filtros.periodo, filtros.categoria, filtros.vmin || filtros.vmax ? 'valor' : null]
              .filter(Boolean).length} ativo(s)
          </span>
        )}
      </button>

      {expanded && (
        <div style={panel}>
          <div style={grid}>
            <Field label="Período">
              <select value={filtros.periodo} onChange={e => up({ periodo: e.target.value })} style={input}>
                {PERIODOS_LANCAMENTO.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </Field>

            {isCustom && (
              <>
                <Field label="De">
                  <input type="date" value={filtros.dataDe} onChange={e => up({ dataDe: e.target.value })} style={input} />
                </Field>
                <Field label="Até">
                  <input type="date" value={filtros.dataAte} onChange={e => up({ dataAte: e.target.value })} style={input} />
                </Field>
              </>
            )}

            <Field label="Categoria">
              <select value={filtros.categoria} onChange={e => up({ categoria: e.target.value })} style={input}>
                <option value="">Todas categorias</option>
                {categorias.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>

            <Field label="Valor mínimo (R$)">
              <input
                type="number" step="0.01" value={filtros.vmin}
                onChange={e => up({ vmin: e.target.value })}
                placeholder="0,00"
                style={input}
              />
            </Field>

            <Field label="Valor máximo (R$)">
              <input
                type="number" step="0.01" value={filtros.vmax}
                onChange={e => up({ vmax: e.target.value })}
                placeholder="0,00"
                style={input}
              />
            </Field>
          </div>

          {algumAtivo && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <button onClick={limpar} style={btnLimpar}>↻ Limpar filtros</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  )
}

const wrap = { marginBottom: 14 }
const toggle = {
  display: 'inline-flex', alignItems: 'center', gap: 8,
  padding: '7px 14px', borderRadius: 6,
  border: '1.5px solid var(--cream-dark)',
  background: 'var(--white)', color: 'var(--navy)',
  fontFamily: 'var(--body)', fontSize: 11, fontWeight: 600, letterSpacing: 0.5,
  cursor: 'pointer', textTransform: 'uppercase',
}
const badge = {
  background: 'var(--gold)', color: '#fff',
  padding: '2px 8px', borderRadius: 999,
  fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
}
const panel = {
  marginTop: 8, padding: 16,
  background: 'var(--white)', borderRadius: 8,
  border: '1px solid var(--cream-dark)',
  boxShadow: 'var(--shadow)',
}
const grid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 12,
}
const labelStyle = {
  fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase',
  color: 'var(--text-mid)', marginBottom: 6, fontFamily: 'var(--body)',
}
const input = {
  width: '100%', padding: '9px 12px', border: '1.5px solid var(--cream-dark)',
  borderRadius: 6, fontFamily: 'var(--body)', fontSize: 13,
  color: 'var(--navy)', background: 'var(--white)', outline: 'none',
  boxSizing: 'border-box',
}
const btnLimpar = {
  padding: '7px 14px', borderRadius: 6,
  border: '1.5px solid var(--cream-dark)',
  background: 'var(--white)', color: 'var(--text-mid)',
  fontFamily: 'var(--body)', fontSize: 11, fontWeight: 600,
  cursor: 'pointer', letterSpacing: 0.5, textTransform: 'uppercase',
}
