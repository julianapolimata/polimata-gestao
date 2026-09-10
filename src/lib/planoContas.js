import { supabase } from './supabase'

// Cache em módulo. plano_contas muda raramente — só pela tela /plano-contas,
// que chama invalidarPlanoContas() depois de gravar.
let _cache = null
let _carregando = null

/** Grupos da DRE (campo `classificacao`). Ordem = ordem de apresentação. */
export const CLASSIFICACOES = [
  'Receita Bruta',
  'Receita Financeira',
  'Outras Receitas',
  'Impostos sobre Vendas',
  'CSP',
  'Despesas Operacionais',
  'Despesas Comerciais',
  'Despesas de Viagens',
  'Despesas Financeiras',
  'Outras Despesas',
  'Antecipação de Lucro',
  'Imobilizado/Intangível',
  'Investimentos',
  'Transferência Entre Contas',
  'Empréstimo - Principal',
  'Parcelamento - Principal',
]

export async function fetchPlanoContas() {
  if (_cache) return _cache
  if (_carregando) return _carregando
  _carregando = supabase
    .from('plano_contas')
    .select('tipo,categoria,subcategoria,classificacao,na_dre,ordem')
    .order('ordem')
    .then(({ data }) => {
      _cache = data || []
      _carregando = null
      return _cache
    })
  return _carregando
}

/** Descarta o cache — próxima fetchPlanoContas() volta ao banco. */
export function invalidarPlanoContas() {
  _cache = null
  _carregando = null
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
