// =============================================================================
// A LISTA DE BANCOS DO BANCO CENTRAL.
//
// O campo "Banco" da conta de recebimento era texto livre. Quem digita escreve
// "Sicoob", "SICOOB", "Banco Cooperativo Sicoob", "756" — quatro grafias do
// mesmo banco, e nenhuma delas carrega o código COMPE, que é o que identifica
// a instituição em boleto, TED e arquivo de retorno.
//
// Pergunta dela, 10/11/2026: "a lista de bancos e seus respectivos códigos,
// disponibilizados pelo banco central, n poderiam ser uma lista suspensa aqui?"
//
// Podem. A fonte é a mesma que já consulta o CNPJ, e a lista é a do próprio
// Banco Central (cerca de 460 instituições com código COMPE).
//
// ── POR QUE DATALIST, E NÃO SELECT ─────────────────────────────────────────
// São 460 opções. Num <select> isso é uma rolagem interminável; num <input
// list=…> quem digita "sicoob" vê a linha certa em dois toques, e quem tem um
// banco fora da lista ainda consegue escrever o nome à mão. A lista guia, não
// prende.
//
// ── O QUE FICA GRAVADO ─────────────────────────────────────────────────────
// O nome E o código, em campos separados (banco / banco_codigo). O rótulo
// mostrado na tela é remontado a partir deles — o texto da linha nunca é a
// fonte do dado.
// =============================================================================

const FONTE = 'https://brasilapi.com.br/api/banks/v1'

// Os que ela usa, e os maiores. Só entram em cena se a consulta não sair: a
// tela continua utilizável, com a lista curta, e o campo segue aceitando texto.
const RESERVA = [
  { codigo: '001', nome: 'Banco do Brasil S.A.' },
  { codigo: '033', nome: 'Banco Santander (Brasil) S.A.' },
  { codigo: '077', nome: 'Banco Inter S.A.' },
  { codigo: '104', nome: 'Caixa Econômica Federal' },
  { codigo: '208', nome: 'Banco BTG Pactual S.A.' },
  { codigo: '212', nome: 'Banco Original S.A.' },
  { codigo: '237', nome: 'Banco Bradesco S.A.' },
  { codigo: '260', nome: 'Nu Pagamentos S.A. (Nubank)' },
  { codigo: '290', nome: 'PagSeguro Internet S.A. (PagBank)' },
  { codigo: '323', nome: 'Mercado Pago' },
  { codigo: '336', nome: 'Banco C6 S.A.' },
  { codigo: '341', nome: 'Itaú Unibanco S.A.' },
  { codigo: '380', nome: 'PicPay' },
  { codigo: '422', nome: 'Banco Safra S.A.' },
  { codigo: '748', nome: 'Banco Cooperativo Sicredi S.A.' },
  { codigo: '756', nome: 'Banco Cooperativo Sicoob S.A.' },
]

let cache = null          // a lista, depois que a consulta sai
let emAndamento = null    // a promessa, para não consultar duas vezes na mesma tela

/** O código COMPE sempre com três dígitos: 1 → "001". */
export function codigoCompe(bruto) {
  const n = String(bruto ?? '').replace(/\D/g, '')
  if (!n) return ''
  return n.padStart(3, '0').slice(-3)
}

/** "756 — Banco Cooperativo Sicoob S.A." */
export function rotuloBanco(codigo, nome) {
  const c = codigoCompe(codigo)
  const n = String(nome || '').trim()
  if (c && n) return `${c} — ${n}`
  return n || c
}

/** O inverso: do rótulo escolhido na lista de volta para código e nome. */
export function bancoDoRotulo(texto, lista) {
  const t = String(texto || '').trim()
  if (!t) return { banco: '', banco_codigo: '' }
  const achado = (lista || []).find(b => rotuloBanco(b.codigo, b.nome) === t)
  if (achado) return { banco: achado.nome, banco_codigo: achado.codigo }

  // Digitou o código puro ("756") e saiu do campo: ainda assim reconhece.
  const soDigitos = /^\d{1,3}$/.test(t) ? codigoCompe(t) : ''
  if (soDigitos) {
    const porCodigo = (lista || []).find(b => b.codigo === soDigitos)
    if (porCodigo) return { banco: porCodigo.nome, banco_codigo: porCodigo.codigo }
  }

  // Fora da lista: o que ela escreveu vale, sem código. Não se inventa um.
  return { banco: t, banco_codigo: '' }
}

/**
 * A lista, consultada uma vez por tela aberta.
 * Nunca rejeita: se a consulta não sair, devolve a reserva.
 * @returns {Promise<Array<{codigo: string, nome: string}>>}
 */
export function listarBancos() {
  if (cache) return Promise.resolve(cache)
  if (emAndamento) return emAndamento

  emAndamento = fetch(FONTE)
    .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then(j => {
      const lista = (Array.isArray(j) ? j : [])
        // Sem código COMPE não há o que escolher: são entradas do próprio
        // Banco Central (Selic, câmaras de liquidação), não bancos de conta.
        .filter(b => b && b.code != null)
        .map(b => ({
          codigo: codigoCompe(b.code),
          nome: String(b.fullName || b.name || '').trim(),
        }))
        .filter(b => b.codigo && b.nome)
        .sort((a, b) => a.codigo.localeCompare(b.codigo))
      if (!lista.length) throw new Error('vazia')
      cache = lista
      return lista
    })
    .catch(() => {
      // Não guarda a reserva em cache: a próxima abertura da tela tenta de novo.
      emAndamento = null
      return RESERVA
    })

  return emAndamento
}
