// =============================================================================
// AS LINHAS DO EXTRATO QUE SÃO A MESMA COISA, JUNTAS.
//
// Medido no extrato dela: 393 linhas pendentes, 88 descrições distintas. 345
// das linhas estão em 40 grupos repetidos — "DÉB.IOF" aparece 22 vezes e soma
// R$ 18,12 no período INTEIRO; "Pagamento Pix ***.156.628-**" aparece 43.
//
// O sistema pedia uma decisão por linha. Ninguém atravessa 393 decisões:
// desiste na quinta, e aí o mês não fecha por causa de dezoito reais de IOF.
//
// A decisão continua humana — ela classifica o GRUPO. O que muda é o sistema
// parar de perguntar 22 vezes a mesma coisa.
//
// ── A CHAVE É A DESCRIÇÃO EXATA, E ISSO NÃO É PREGUIÇA ──────────────────────
//
// A primeira versão deste agrupamento normalizava a descrição (tirava os
// dígitos) para formar grupos maiores. Testado contra o extrato real, isso
// juntava "Pagamento Pix ***.156.628-**" com "Pagamento Pix ***.985.018-**":
// DUAS PESSOAS DIFERENTES, R$ 151.160 e R$ 5.750, no mesmo grupo. Classificar
// os dois juntos poria o dinheiro de uma na conta da outra.
//
// O banco já escreve a contraparte na descrição. Não há nada a normalizar: o
// que parece igual e não é, não é. Grupo menor e certo vale mais que grupo
// grande e misturado — e o ganho medido continua enorme: 393 → 88.
// =============================================================================

/** Centavos inteiros: comparar dinheiro em float dá diferença de um centavo. */
const centavos = v => Math.round(Math.abs(Number(v) || 0) * 100);

/**
 * A chave do grupo: tipo de movimento + descrição exata.
 *
 * O TIPO entra porque entrada e saída nunca são a mesma despesa, mesmo com o
 * texto igual — um estorno tem a descrição do pagamento que estornou.
 */
export function chaveDoGrupo(linha) {
  const d = linha?.data || {};
  const descricao = String(d.descricao || '').trim();
  if (!descricao) return null;   // sem descrição não há grupo: decide uma a uma
  const tipo = d.tipo === 'entrada' ? 'entrada' : 'saida';
  return `${tipo}\u0000${descricao}`;
}

/**
 * Agrupa as linhas pendentes.
 *
 * @param {Array} linhas  transacoes_extrato pendentes
 * @returns {Array} grupos, os maiores primeiro:
 *   {chave, descricao, tipo, linhas[], quantas, total, periodo:{de,ate}, valorUnico}
 *   Linhas sem par saem como grupo de uma — a tela decide se as mostra à parte.
 */
export function agruparPendentes(linhas) {
  const mapa = new Map();
  for (const linha of linhas || []) {
    const chave = chaveDoGrupo(linha);
    if (!chave) continue;
    if (!mapa.has(chave)) mapa.set(chave, []);
    mapa.get(chave).push(linha);
  }

  const grupos = [];
  for (const [chave, itens] of mapa) {
    const d0 = itens[0].data || {};
    const datas = itens.map(l => String(l.data?.data || '')).filter(Boolean).sort();
    const valores = new Set(itens.map(l => centavos(l.data?.valor)));
    grupos.push({
      chave,
      descricao: String(d0.descricao || '').trim(),
      tipo: d0.tipo === 'entrada' ? 'entrada' : 'saida',
      linhas: itens,
      quantas: itens.length,
      total: itens.reduce((s, l) => s + Math.abs(Number(l.data?.valor) || 0), 0),
      periodo: { de: datas[0] || null, ate: datas[datas.length - 1] || null },
      // Valor sempre igual é sinal de cobrança fixa (mensalidade, tarifa) — a
      // tela usa isso para dizer "22x R$ 0,82" em vez de só somar.
      valorUnico: valores.size === 1 ? Math.abs(Number(d0.valor) || 0) : null,
    });
  }

  // Os maiores primeiro: é onde está o ganho de quem está com pressa.
  return grupos.sort((a, b) => b.quantas - a.quantas || b.total - a.total);
}

/**
 * O resumo honesto do que o agrupamento economiza.
 *
 * Serve para a tela dizer o número ANTES de ela clicar — "393 linhas em 88
 * decisões" é o que faz alguém começar; "393 linhas" é o que faz desistir.
 */
export function resumoDoAgrupamento(grupos) {
  const repetidos = (grupos || []).filter(g => g.quantas > 1);
  const linhas = (grupos || []).reduce((s, g) => s + g.quantas, 0);
  return {
    linhas,
    grupos: (grupos || []).length,
    repetidos: repetidos.length,
    linhasEmGrupo: repetidos.reduce((s, g) => s + g.quantas, 0),
    avulsas: linhas - repetidos.reduce((s, g) => s + g.quantas, 0),
    // Quantas decisões sobram: uma por grupo repetido + as avulsas.
    decisoes: (grupos || []).length,
  };
}

/**
 * Os lançamentos que um grupo vai criar, um por linha.
 *
 * Fica aqui, e não na tela, porque é a parte que a prova consegue checar: cada
 * lançamento guarda a data e o valor DA SUA linha. Um grupo resolvido com uma
 * decisão não pode virar um lançamento só com a soma — isso apagaria quando
 * cada despesa aconteceu, e o mês de competência é o que fecha o mês.
 */
export function lancamentosDoGrupo(grupo, { cat, subcat, parte }) {
  if (!grupo?.linhas?.length) return [];
  if (!cat) return [];
  const agora = new Date().toISOString();
  return grupo.linhas.map(linha => {
    const d = linha.data || {};
    const entrada = d.tipo === 'entrada';
    const alvo = entrada ? 'receivable' : 'payable';
    const quando = d.data;
    return {
      extrato_id: linha.id,
      target: alvo,
      lanc: {
        [entrada ? 'client' : 'supplier']: String(parte || d.descricao || '').substring(0, 80),
        desc: d.descricao,
        value: Number(d.valor || 0),
        due: quando,
        data_pagamento: quando,
        data_competencia: quando,
        status: entrada ? 'Recebido' : 'Pago',
        cat,
        subcat: subcat || '',
        // Nasce sem documento fiscal e já escriturado, igual ao que a tela faz
        // numa linha só: a linha do banco É a evidência deste lançamento.
        doc_status: 'pendente',
        sem_documento: true,
        escriturado: true,
        escriturado_em: agora,
        escriturado_por: 'manual',
        created: quando,
        criado_via_conciliacao: true,
        // Deixa rastro de que veio de uma decisão de grupo: quem conferir
        // depois precisa saber que estes 22 nasceram de um clique só.
        criado_em_grupo: grupo.descricao,
        criado_em_grupo_tamanho: grupo.quantas,
      },
    };
  });
}

export default agruparPendentes;
