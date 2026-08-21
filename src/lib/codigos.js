import { supabase } from './supabase'

// Replica gerarCodigoRef do legado (linha 2341 public/index.html).
// Padrão de códigos:
//   Receivable: 1NNNNN (ex: 100001)
//   Payable:    2NNNNN (ex: 200001)
//   Cliente:    CLI-NNN
//   Fornecedor: FOR-NNN
//   Funcionário:FUN-NNN
//   Órgão:      ORG-NNN
//   Contrato:   CTR-YYYY-NNN
//   Projeto:    PRJ-YYYY-NNN

const PREFIX_PESSOA = {
  Cliente: 'CLI', Fornecedor: 'FOR', 'Funcionário': 'FUN', 'Órgão Público': 'ORG',
}

function seqMax(rows, regex) {
  let max = 0
  for (const r of rows || []) {
    const m = (r.codigo || '').match(regex)
    if (m) {
      const n = parseInt(m[1], 10)
      if (!isNaN(n) && n > max) max = n
    }
  }
  return max
}

export async function proximoCodigoReceivable() {
  const { data } = await supabase.from('receivable').select('codigo').not('codigo', 'is', null)
  const next = seqMax(data, /^1(\d{5})$/) + 1
  return `1${String(next).padStart(5, '0')}`
}

export async function proximoCodigoPayable() {
  const { data } = await supabase.from('payable').select('codigo').not('codigo', 'is', null)
  const next = seqMax(data, /^2(\d{5})$/) + 1
  return `2${String(next).padStart(5, '0')}`
}

// Gera N códigos sequenciais de Payable a partir de uma única leitura.
// Usado quando várias parcelas são inseridas de uma vez (bloco atômico),
// evitando N leituras que retornariam o mesmo código.
export async function proximosCodigosPayable(n) {
  const { data } = await supabase.from('payable').select('codigo').not('codigo', 'is', null)
  const base = seqMax(data, /^2(\d{5})$/)
  return Array.from({ length: n }, (_, i) => `2${String(base + 1 + i).padStart(5, '0')}`)
}

export async function proximoCodigoPessoa(tipoPessoa) {
  const pref = PREFIX_PESSOA[tipoPessoa]
  if (!pref) return ''
  const { data } = await supabase.from('pessoas').select('codigo,data')
  const mesmoTipo = (data || []).filter(p => (p.data?.tipo || '') === tipoPessoa)
  const next = seqMax(mesmoTipo, new RegExp(`^${pref}-(\\d+)$`)) + 1
  return `${pref}-${String(next).padStart(3, '0')}`
}

export async function proximoCodigoEmprestimo() {
  const { data } = await supabase.from('emprestimos_financiamentos').select('codigo').not('codigo', 'is', null)
  const next = seqMax(data, /^EMP-(\d+)$/) + 1
  return `EMP-${String(next).padStart(3, '0')}`
}

export async function proximoCodigoContrato() {
  const ano = new Date().getFullYear()
  const { data } = await supabase.from('contracts').select('codigo')
  const desteAno = (data || []).filter(c => (c.codigo || '').startsWith(`CTR-${ano}-`))
  const next = seqMax(desteAno, /^CTR-\d+-(\d+)$/) + 1
  return `CTR-${ano}-${String(next).padStart(3, '0')}`
}

export async function proximoCodigoProjeto() {
  const ano = new Date().getFullYear()
  const { data } = await supabase.from('projects').select('codigo')
  const desteAno = (data || []).filter(p => (p.codigo || '').startsWith(`PRJ-${ano}-`))
  const next = seqMax(desteAno, /^PRJ-\d+-(\d+)$/) + 1
  return `PRJ-${ano}-${String(next).padStart(3, '0')}`
}
