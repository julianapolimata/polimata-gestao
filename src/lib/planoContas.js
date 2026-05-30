import { supabase } from './supabase'

// Cache em módulo (não invalida na mesma sessão). plano_contas é fixo.
let _cache = null
let _carregando = null

export async function fetchPlanoContas() {
  if (_cache) return _cache
  if (_carregando) return _carregando
  _carregando = supabase
    .from('plano_contas')
    .select('tipo,categoria,subcategoria,na_dre,ordem')
    .order('ordem')
    .then(({ data }) => {
      _cache = data || []
      _carregando = null
      return _cache
    })
  return _carregando
}

/** Lista distinct de categorias para um tipo (Entrada | Saída | Transferência) */
export function categoriasDe(plano, tipo) {
  const set = []
  const visto = new Set()
  for (const p of plano || []) {
    if (p.tipo === tipo && p.categoria && !visto.has(p.categoria)) {
      visto.add(p.categoria)
      set.push(p.categoria)
    }
  }
  return set
}

/** Subcategorias de uma categoria + tipo (na ordem do plano de contas) */
export function subcategoriasDe(plano, tipo, categoria) {
  if (!categoria) return []
  return (plano || [])
    .filter(p => p.tipo === tipo && p.categoria === categoria && p.subcategoria)
    .map(p => p.subcategoria)
}
