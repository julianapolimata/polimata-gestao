// =============================================================================
// MÁSCARAS DE INPUT — helpers reutilizáveis pra formatar conforme o usuário digita.
// Todas aceitam input "sujo" e retornam string formatada.
// =============================================================================

/** Documento CPF (000.000.000-00) ou CNPJ (00.000.000/0000-00) — autodetecta */
export function maskDocumento(v) {
  const d = String(v || '').replace(/\D/g, '')
  if (d.length <= 11) {
    return d
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2')
  }
  return d
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2')
}

/** CEP (00000-000) */
export function maskCEP(v) {
  const d = String(v || '').replace(/\D/g, '').slice(0, 8)
  if (d.length <= 5) return d
  return `${d.slice(0, 5)}-${d.slice(5)}`
}

/** Telefone BR — fixo (00) 0000-0000 ou celular (00) 00000-0000 — autodetecta */
export function maskTelefone(v) {
  const d = String(v || '').replace(/\D/g, '').slice(0, 11)
  if (d.length <= 2) return d.length > 0 ? `(${d}` : ''
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  // 11 dígitos = celular com 9
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}

/**
 * Agência bancária — última posição vira dígito verificador automaticamente.
 *   '4446' → '4446'
 *   '44466' → '4446-6'
 * Máximo 5 dígitos + dígito.
 */
export function maskAgencia(v) {
  const d = String(v || '').replace(/[^\dX]/gi, '').toUpperCase().slice(0, 6)
  if (d.length <= 4) return d
  return `${d.slice(0, 4)}-${d.slice(4)}`
}

/**
 * Conta corrente — última posição vira dígito verificador automaticamente.
 *   '58050' → '58050'
 *   '580503' → '58050-3'
 *   '12345678' → '1234567-8'
 * Suporta dígito X comum em algumas contas.
 */
export function maskConta(v) {
  const d = String(v || '').replace(/[^\dX]/gi, '').toUpperCase().slice(0, 10)
  if (d.length <= 5) return d
  // Pega últimos 1 caractere como dígito
  return `${d.slice(0, -1)}-${d.slice(-1)}`
}

/** Valida agência: mínimo 4 dígitos no número (antes do hífen) */
export function validarAgencia(v) {
  const d = String(v || '').replace(/[^\dX]/gi, '')
  return d.length >= 4 && d.length <= 6
}

/** Valida conta: mínimo 5 dígitos */
export function validarConta(v) {
  const d = String(v || '').replace(/[^\dX]/gi, '')
  return d.length >= 5 && d.length <= 10
}

/** Valida CEP: 8 dígitos */
export function validarCEP(v) {
  return String(v || '').replace(/\D/g, '').length === 8
}

/** Valida telefone: 10 ou 11 dígitos */
export function validarTelefone(v) {
  const len = String(v || '').replace(/\D/g, '').length
  return len === 10 || len === 11
}
