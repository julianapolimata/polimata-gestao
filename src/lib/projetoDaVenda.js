// =============================================================================
// DA VENDA AO FATURAMENTO — oportunidade → projeto → receita.
//
// Decidido com ela em 09/11/2026, depois de comparar com a prática de mercado:
//
//   A RENOVAÇÃO É UMA VENDA NOVA. Cada ciclo anual vira uma oportunidade e um
//   projeto próprios. É assim que se mede taxa de renovação (sem oportunidade
//   de renovação, essa taxa não existe) e é assim que um ano se compara com o
//   outro.
//
//   A CONTINUIDADE NÃO SE PERDE, porque ela não mora no projeto: mora no
//   cliente, que é um só com vários projetos. E cada projeto novo aponta para
//   o anterior (`renovacao_de`), encadeando 2023 → 2024 → 2025 → 2026.
//
// O QUE ISTO NÃO FAZ, de propósito: não cria projeto sozinho. Foi exatamente
// um gatilho automático de "prospect fechado vira projeto" que deixou duas
// cascas de R$ 0 no sistema, sem valor, sem prazo e sem dono. Aqui o projeto
// nasce de um clique dela, com os dados da venda que ela mesma registrou.
// =============================================================================

const num = v => Number(v) || 0
const dadosDe = x => x?.data || x || {}

/**
 * O projeto que nasce de uma oportunidade ganha.
 *
 * @param {object} oportunidade  o registro, com data.pessoa_id e valor
 * @param {object} pessoa        a pessoa, para o nome do projeto
 * @param {object} [anterior]    o projeto que este renova, quando houver
 * @param {string} [hoje]
 * @returns {object} o `data` do projeto — sem o código, que o banco numera
 */
export function projetoDaOportunidade(oportunidade, pessoa, anterior = null, hoje = new Date().toISOString().slice(0, 10)) {
  const o = dadosDe(oportunidade)
  const p = dadosDe(pessoa)
  const nomePessoa = String(p.fantasia || p.nome || '').trim()
  const descricao = String(o.descricao || '').trim()
  const ciclo = anterior ? num(dadosDe(anterior).ciclo || 1) + 1 : 1

  return {
    // O VÍNCULO por identificador, e não por texto. Era texto que fazia o
    // projeto e o cadastro serem, para o sistema, duas coisas sem relação.
    pessoa_id: o.pessoa_id || null,
    oportunidade_id: oportunidade?.id || null,
    // O elo da renovação: é por ele que a linha do tempo se lê.
    renovacao_de: anterior?.id || null,
    ciclo,
    // `client` continua, porque o resto do sistema ainda lê esse texto. Ele
    // passa a ser rótulo, não vínculo.
    client: nomePessoa,
    name: nomeDoProjeto({ nomePessoa, descricao, ciclo, dataProposta: o.data_proposta }),
    value: o.valor_estimado == null ? 0 : num(o.valor_estimado),
    // A referência da venda é LIDA da oportunidade, nunca copiada para cá:
    // guardar o número em dois lugares é como o código acabou divergindo.
    status: 'Em planejamento',
    progress: 0,
    start: o.data_proposta || hoje,
    deadline: '',
    notes: anterior
      ? `Renovação do ciclo ${ciclo - 1}. Gerado da oportunidade em ${hoje}.`
      : `Gerado da oportunidade em ${hoje}.`,
    created: hoje,
  }
}

/** O nome do projeto: o cliente, o que foi vendido e o ciclo, quando há mais de um. */
export function nomeDoProjeto({ nomePessoa, descricao, ciclo, dataProposta }) {
  const ano = String(dataProposta || '').slice(0, 4)
  const partes = [nomePessoa || 'Projeto']
  if (descricao) partes.push(descricao)
  if (ciclo > 1) partes.push(`ciclo ${ciclo}${ano ? `/${ano}` : ''}`)
  return partes.join(' — ')
}

/**
 * Quanto cada projeto faturou.
 *
 * Só conta o que foi RECEBIDO. Uma receita ainda pendente é promessa, e
 * somá-la ao faturado faria o projeto parecer pago antes de o dinheiro entrar.
 * As duas somas voltam separadas, para a tela poder mostrar as duas.
 */
export function faturamentoPorProjeto(receitas) {
  const mapa = new Map()
  for (const r of receitas || []) {
    const d = dadosDe(r)
    const id = d.projeto_id
    if (!id) continue
    if (!mapa.has(id)) mapa.set(id, { recebido: 0, aReceber: 0, lancamentos: 0 })
    const alvo = mapa.get(id)
    const valor = num(d.value)
    alvo.lancamentos += 1
    if (d.status === 'Recebido' || d.data_pagamento) alvo.recebido += valor
    else alvo.aReceber += valor
  }
  for (const v of mapa.values()) {
    v.recebido = Math.round(v.recebido * 100) / 100
    v.aReceber = Math.round(v.aReceber * 100) / 100
  }
  return mapa
}

/**
 * O projeto contra o que foi vendido.
 *
 * `diferenca` positiva = faturou mais que o vendido (aditivo, hora extra);
 * negativa = ainda falta faturar. Sem valor vendido, não há comparação — e
 * devolver zero afirmaria que está em dia.
 */
export function confrontoDoProjeto(projeto, faturamento) {
  const vendido = num(dadosDe(projeto).value)
  const f = faturamento || { recebido: 0, aReceber: 0, lancamentos: 0 }
  const faturado = Math.round((f.recebido + f.aReceber) * 100) / 100
  return {
    vendido,
    recebido: f.recebido,
    aReceber: f.aReceber,
    faturado,
    lancamentos: f.lancamentos,
    diferenca: vendido ? Math.round((faturado - vendido) * 100) / 100 : null,
  }
}

/**
 * A linha do tempo de uma renovação: do primeiro ciclo ao último.
 *
 * Segue o elo `renovacao_de`. Um elo quebrado (o projeto anterior foi
 * apagado) interrompe a corrente em vez de inventar o que falta.
 */
export function cadeiaDeRenovacao(projetos, idFinal) {
  const porId = new Map((projetos || []).map(p => [p.id, p]))
  const cadeia = []
  let atual = porId.get(idFinal)
  const vistos = new Set()
  while (atual && !vistos.has(atual.id)) {
    vistos.add(atual.id)
    cadeia.unshift(atual)
    const anteriorId = dadosDe(atual).renovacao_de
    atual = anteriorId ? porId.get(anteriorId) : null
  }
  return cadeia
}

/** O projeto mais recente desta pessoa, que é o candidato a ser renovado. */
export function ultimoProjetoDaPessoa(projetos, pessoaId) {
  if (!pessoaId) return null
  const dela = (projetos || []).filter(p => dadosDe(p).pessoa_id === pessoaId)
  if (!dela.length) return null
  return dela.reduce((maior, p) =>
    num(dadosDe(p).ciclo || 1) >= num(dadosDe(maior).ciclo || 1) ? p : maior)
}

/**
 * O projeto ao qual uma receita desta pessoa pertence, quando é inequívoco.
 *
 * ── O DEFEITO QUE ISTO FECHA, achado na auditoria de 10/11/2026 ────────────
 *
 * `projeto_id` só era gravado no lançamento manual de receita. Mas o caminho
 * normal da receita dela não é esse: é a nota que chega por e-mail e é
 * aprovada na Caixa de entrada. Por ali, o lançamento nascia SEM projeto — e
 * a coluna "Faturado" da tela de Projetos ficaria vazia para sempre, sem que
 * nada na tela explicasse por quê.
 *
 * A regra é a mesma do resto do sistema: UM candidato resolve; vários são
 * decisão dela. Dois projetos abertos para o mesmo cliente é exatamente a
 * situação em que adivinhar erra — e erra em silêncio, porque o faturamento
 * iria parar no projeto errado.
 *
 * Projeto encerrado não conta: uma receita nova não pertence a um trabalho
 * que acabou.
 */
export function projetoUnicoDaPessoa(projetos, pessoaId) {
  if (!pessoaId) return null
  const abertos = (projetos || []).filter(p => {
    const d = dadosDe(p)
    if (d.pessoa_id !== pessoaId) return false
    return String(d.status || '') !== 'Encerrado'
  })
  return abertos.length === 1 ? abertos[0].id : null
}
