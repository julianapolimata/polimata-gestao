// =============================================================================
// A RELAÇÃO DOS LANÇAMENTOS — entradas e saídas na mesma lista.
//
// O sistema tinha duas telas: Contas a Receber e Contas a Pagar. Ambas listam
// tudo (inclusive o que já foi pago) e ambas têm busca. Mesmo assim, a pergunta
// "como ficou classificado o seguro prestamista?" não tinha onde ser feita:
//
//   • para procurar, é preciso saber ANTES se aquilo foi entrada ou saída —
//     que é exatamente o que quem procura ainda não sabe;
//   • "Contas a pagar" é o nome de uma OBRIGAÇÃO. Ninguém pensa em abrir as
//     contas a pagar para conferir um registro já realizado;
//   • não dava para perguntar por categoria: "tudo que caiu em Despesas
//     Financeiras em 2025" exigia abrir as duas telas e somar na mão.
//
// Esta é a visão de razão da operação: o que aconteceu, com o que foi
// classificado, dos dois lados, em uma lista só.
//
// A CLASSIFICAÇÃO (o grupo da DRE) não fica gravada no lançamento — só
// categoria e subcategoria ficam. Ela vem do plano de contas, no momento da
// leitura. É de propósito: se o plano mudar o grupo de uma categoria, a lista
// acompanha, em vez de mostrar um retrato velho.
// =============================================================================

const texto = v => String(v ?? '').trim()
const minusc = v => texto(v).toLowerCase()

/** Realizado = o dinheiro andou. Previsto = ainda é projeção. */
export function situacaoDe(d) {
  const s = minusc(d?.status)
  if (s === 'pago' || s === 'recebido') return 'realizado'
  if (s === 'provisão' || s === 'provisao' || s === 'previsto') return 'previsto'
  return 'aberto'
}

export const ROTULO_SITUACAO = {
  realizado: 'Realizado',
  aberto: 'Em aberto',
  previsto: 'Previsto',
}

/** Mapa categoria→grupo da DRE, para não varrer o plano a cada linha. */
export function mapaDeClassificacao(plano) {
  const m = new Map()
  for (const p of plano || []) {
    m.set(`${p.tipo}|${minusc(p.categoria)}|${minusc(p.subcategoria)}`, p.classificacao || '')
    // Sem subcategoria: serve de recurso quando o lançamento só tem categoria.
    const soCat = `${p.tipo}|${minusc(p.categoria)}|`
    if (!m.has(soCat)) m.set(soCat, p.classificacao || '')
  }
  return m
}

/**
 * Junta as duas tabelas numa lista só, já com o grupo da DRE resolvido.
 *
 * `pagar` e `receber` são as linhas cruas do Supabase ({ id, codigo, data }).
 */
export function unificar({ pagar = [], receber = [], plano = [] } = {}) {
  const mapa = mapaDeClassificacao(plano)

  const converter = (row, tipo) => {
    const d = row?.data || {}
    const chave = `${tipo}|${minusc(d.cat)}|${minusc(d.subcat)}`
    const situacao = situacaoDe(d)
    return {
      id: row.id,
      tabela: tipo === 'Entrada' ? 'receivable' : 'payable',
      codigo: texto(row.codigo),
      // O numero do documento fiscal. Ele ja era gravado em 113 lancamentos e
      // nao aparecia em lista nenhuma -- o codigo identifica o lancamento
      // DENTRO do sistema, o numero da nota identifica o papel que existe
      // fora dele. Quem concilia com o contador precisa do segundo.
      numeroNf: texto(d.numero_nf),
      tipo,
      parte: texto(d.client || d.supplier) || '—',
      descricao: texto(d.desc),
      valor: Math.abs(Number(d.value) || 0),
      cat: texto(d.cat),
      subcat: texto(d.subcat),
      classificacao: mapa.get(chave) || mapa.get(`${tipo}|${minusc(d.cat)}|`) || '',
      situacao,
      status: texto(d.status),
      escriturado: d.escriturado === true,
      // Parcela e grupo vem de colunas que o sistema JA escrevia e que a
      // interface nunca mostrou: parent_id costura as parcelas de uma compra
      // no cartao, emprestimo_id liga a parcela ao contrato. Nada aqui e
      // derivado por semelhanca -- e o vinculo gravado na hora em que a
      // parcela nasceu.
      parcelaAtual: Number(d.parcela_atual) || 0,
      parcelaTotal: Number(d.parcela_total) || 0,
      parcela: Number(d.parcela_total) > 1 ? `${Number(d.parcela_atual) || '?'}/${d.parcela_total}` : '',
      grupoId: String(row.parent_id || row.emprestimo_id || ''),
      grupoTipo: row.emprestimo_id ? 'contrato' : (row.parent_id ? 'compra' : ''),
      competencia: texto(d.data_competencia),
      vencimento: texto(d.due),
      pagamento: texto(d.data_pagamento),
      // A data que a linha mostra: quando realizado, o dia em que o dinheiro
      // andou; senão, o vencimento. É a data que a pessoa tem na cabeça.
      data: situacao === 'realizado' ? (texto(d.data_pagamento) || texto(d.due)) : (texto(d.due) || texto(d.data_competencia)),
    }
  }

  return [
    ...receber.map(r => converter(r, 'Entrada')),
    ...pagar.map(r => converter(r, 'Saída')),
  ]
}

/** Qual campo de data o filtro de período usa. */
export const CAMPOS_DE_DATA = {
  data: 'Data do lançamento',
  competencia: 'Competência',
  vencimento: 'Vencimento',
  pagamento: 'Pagamento',
}

export function filtrar(linhas, f = {}) {
  let r = linhas || []

  if (f.tipo) r = r.filter(l => l.tipo === f.tipo)
  if (f.situacao) r = r.filter(l => l.situacao === f.situacao)
  if (f.cat) r = r.filter(l => l.cat === f.cat)
  if (f.subcat) r = r.filter(l => l.subcat === f.subcat)
  if (f.classificacao) r = r.filter(l => l.classificacao === f.classificacao)
  if (f.grupo) r = r.filter(l => l.grupoId === f.grupo)

  const campo = CAMPOS_DE_DATA[f.campoData] ? f.campoData : 'data'
  // O período filtra DE VERDADE: quem não tem a data escolhida não está no
  // intervalo, então sai.
  //
  // A primeira versão deixava essas linhas passarem, para "não esconder nada".
  // O resultado foi um filtro que não filtrava: pagamento entre 01 e 31/05/2025
  // devolveu 223 lançamentos — quase todos —, porque quase nenhum tem data de
  // pagamento preenchida. Filtro que não filtra é pior que filtro que esconde,
  // porque o número que aparece na tela está errado e ninguém desconfia.
  //
  // O cuidado original continua valendo, só que dito em voz alta em vez de
  // silenciosamente: contarSemData diz quantas ficaram de fora por isso, e a
  // tela mostra.
  if (f.de || f.ate) r = r.filter(l => !!l[campo])
  if (f.de) r = r.filter(l => l[campo] >= f.de)
  if (f.ate) r = r.filter(l => l[campo] <= f.ate)

  const vmin = parseFloat(f.valorMin)
  const vmax = parseFloat(f.valorMax)
  if (!isNaN(vmin)) r = r.filter(l => l.valor >= vmin)
  if (!isNaN(vmax)) r = r.filter(l => l.valor <= vmax)

  const q = minusc(f.busca)
  if (q) {
    r = r.filter(l => [l.codigo, l.numeroNf, l.parte, l.descricao, l.cat, l.subcat, l.classificacao, l.valor.toFixed(2)]
      .join(' ').toLowerCase().includes(q))
  }
  return r
}

/**
 * O resumo de uma compra parcelada ou de um contrato: quantas parcelas, quanto
 * soma, quantas já foram pagas. É a resposta para "a compra do Sebrae inteira",
 * que antes não existia em lugar nenhum -- o vínculo estava gravado, só não
 * aparecia.
 */
export function resumoDoGrupo(linhas, grupoId) {
  const ls = (linhas || []).filter(l => l.grupoId && l.grupoId === grupoId)
  if (!ls.length) return null
  const total = ls[0].parcelaTotal || ls.length
  return {
    id: grupoId,
    tipo: ls[0].grupoTipo,
    nome: ls[0].parte,
    parcelasNoSistema: ls.length,
    parcelasDoContrato: total,
    pagas: ls.filter(l => l.situacao === 'realizado').length,
    valor: Math.round(ls.reduce((s, l) => s + l.valor, 0) * 100) / 100,
  }
}

/**
 * Quantas linhas ficaram de fora SÓ por não terem a data escolhida.
 *
 * Conta sobre o mesmo recorte dos outros filtros, sem o período: senão o aviso
 * somaria linhas que já estavam fora por outro motivo e assustaria à toa.
 */
export function contarSemData(linhas, f = {}) {
  if (!f.de && !f.ate) return 0
  const campo = CAMPOS_DE_DATA[f.campoData] ? f.campoData : 'data'
  const base = filtrar(linhas, { ...f, de: '', ate: '' })
  return base.filter(l => !l[campo]).length
}

/** Entradas, saídas e o que sobra — o placar da lista que está na tela. */
export function totais(linhas) {
  let entradas = 0, saidas = 0
  for (const l of linhas || []) {
    if (l.tipo === 'Entrada') entradas += l.valor
    else saidas += l.valor
  }
  const arred = v => Math.round(v * 100) / 100
  return { quantidade: (linhas || []).length, entradas: arred(entradas), saidas: arred(saidas), resultado: arred(entradas - saidas) }
}

export function ordenar(linhas, coluna = 'data', direcao = 'desc') {
  const sinal = direcao === 'asc' ? 1 : -1
  return [...(linhas || [])].sort((a, b) => {
    const x = a[coluna], y = b[coluna]
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * sinal
    return String(x ?? '').localeCompare(String(y ?? ''), 'pt-BR') * sinal
  })
}

/**
 * CSV para levar ao contador. Ponto e vírgula e vírgula decimal: é o que o
 * Excel em português abre sem pedir nada.
 */
export function paraCSV(linhas) {
  const cabecalho = ['Código', 'Nº do documento', 'Tipo', 'Data', 'Competência', 'Vencimento', 'Pagamento', 'Parte', 'Descrição', 'Categoria', 'Subcategoria', 'Classificação', 'Situação', 'Valor']
  const campo = v => {
    const s = String(v ?? '')
    return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  const linha = l => [
    l.codigo, l.numeroNf, l.tipo, l.data, l.competencia, l.vencimento, l.pagamento,
    l.parte, l.descricao, l.cat, l.subcat, l.classificacao,
    ROTULO_SITUACAO[l.situacao] || l.situacao,
    l.valor.toFixed(2).replace('.', ','),
  ].map(campo).join(';')
  return [cabecalho.join(';'), ...(linhas || []).map(linha)].join('\n')
}
