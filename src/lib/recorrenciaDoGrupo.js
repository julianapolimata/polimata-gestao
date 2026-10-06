// =============================================================================
// O GRUPO QUE SE REPETE VIRA RECORRÊNCIA — se ele mesmo provar que se repete.
//
// Depois de resolver um grupo na Conciliação, o sistema sabe uma coisa que ela
// não precisa digitar: 22 linhas de "DÉB.IOF", sempre R$ 0,82, uma por mês, de
// junho/25 a agosto/26. Isso É uma recorrência — já está escrita no extrato.
//
// Por que vale: a tela de Recorrências existe desde sempre e está VAZIA (zero
// cadastradas, zero lançamentos gerados). Cadastrar à mão pede nove campos por
// linha, e ninguém faz isso vinte vezes. Derivar do que ela acabou de
// classificar custa um clique.
//
// O que isso resolve NÃO é fechar 2025 — para linha que já está no extrato, o
// agrupamento é melhor, porque usa o valor e a data reais em vez de uma
// previsão. Resolve nunca mais chegar neste ponto: no mês que vem o lançamento
// já existe esperando a linha do banco, e a conciliação volta a ser conferência
// em vez de digitação.
//
// ── POR QUE A DETECÇÃO É DURA DE PROPÓSITO ──────────────────────────────────
//
// Recorrência errada não é um incômodo: ela CRIA despesa que não existe, mês
// após mês, e ninguém percebe porque o número aparece sozinho. O erro aqui é
// mais caro que o trabalho que ele economiza. Então a função só devolve algo
// quando o próprio grupo prova as três coisas — valor fixo, intervalo
// constante, e repetições suficientes para não ser coincidência. Na dúvida,
// null: ela continua cadastrando à mão, como hoje.
// =============================================================================

/** Quantas ocorrências bastam. Duas é coincidência; três é padrão. */
export const MINIMO_OCORRENCIAS = 3;

/** Os passos que o sistema sabe projetar (mesma lista de lib/recorrencias.js). */
const PASSOS = [
  { meses: 1, frequencia: 'mensal' },
  { meses: 2, frequencia: 'bimestral' },
  { meses: 3, frequencia: 'trimestral' },
  { meses: 6, frequencia: 'semestral' },
  { meses: 12, frequencia: 'anual' },
];

const soData = s => String(s || '').slice(0, 10);
const ano = s => Number(soData(s).slice(0, 4));
const mes = s => Number(soData(s).slice(5, 7));
const dia = s => Number(soData(s).slice(8, 10));
/** Meses absolutos desde o ano zero — para comparar meses sem fuso nem fim de mês. */
const indiceMes = s => ano(s) * 12 + (mes(s) - 1);

/**
 * O grupo é uma recorrência? Devolve o mestre pronto, ou null.
 *
 * @param {object} grupo  saída de agruparPendentes()
 * @param {object} classificacao  {cat, subcat, parte} que ela acabou de escolher
 */
export function detectarRecorrencia(grupo, classificacao = {}) {
  const linhas = grupo?.linhas || [];
  if (linhas.length < MINIMO_OCORRENCIAS) return null;

  // 1. VALOR FIXO. Valor que oscila não é mensalidade — é consumo (energia,
  //    telefone por uso). Projetar um valor que varia inventa número.
  if (grupo.valorUnico == null || !grupo.valorUnico) return null;

  const datas = linhas.map(l => soData(l.data?.data)).filter(Boolean).sort();
  if (datas.length < MINIMO_OCORRENCIAS) return null;

  // 2. UM POR MÊS, NO MÁXIMO. Duas cobranças no mesmo mês significam que a
  //    descrição agrupa coisas diferentes (duas compras na mesma loja, por
  //    exemplo) — e aí não há ciclo nenhum para projetar.
  const meses = datas.map(indiceMes);
  if (new Set(meses).size !== meses.length) return null;

  // 3. INTERVALO CONSTANTE. Um buraco no meio significa que parou e voltou, ou
  //    que são coisas diferentes com o mesmo nome. Qualquer uma das duas torna
  //    a projeção um palpite.
  const saltos = [];
  for (let i = 1; i < meses.length; i++) saltos.push(meses[i] - meses[i - 1]);
  const passo = saltos[0];
  if (!saltos.every(s => s === passo)) return null;

  const conhecido = PASSOS.find(p => p.meses === passo);
  if (!conhecido) return null;   // de 4 em 4 meses: existe, mas o sistema não projeta

  // O dia da cobrança: o mais frequente. A data do banco varia com fim de
  // semana e feriado, e o dia que mais aparece é o combinado de verdade.
  const contagem = new Map();
  for (const d of datas) contagem.set(dia(d), (contagem.get(dia(d)) || 0) + 1);
  const diaVencimento = [...contagem.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];

  // COMEÇA DEPOIS DA ÚLTIMA QUE JÁ ACONTECEU. Esta é a trava que impede a
  // recorrência de duplicar o que o agrupamento acabou de lançar: se ela
  // começasse na primeira ocorrência, o sistema projetaria de novo todos os
  // meses que já estão no extrato.
  const ultima = datas[datas.length - 1];
  const inicioIdx = indiceMes(ultima) + passo;
  const inicioAno = Math.floor(inicioIdx / 12);
  const inicioMes = (inicioIdx % 12) + 1;
  const ultimoDiaDoMes = new Date(inicioAno, inicioMes, 0).getDate();
  const data_inicio = `${inicioAno}-${String(inicioMes).padStart(2, '0')}-`
                    + String(Math.min(diaVencimento, ultimoDiaDoMes)).padStart(2, '0');

  return {
    frequencia: conhecido.frequencia,
    quantas: datas.length,
    primeira: datas[0],
    ultima,
    mestre: {
      descricao: grupo.descricao,
      parte: classificacao.parte || '',
      tipo: grupo.tipo === 'entrada' ? 'receita' : 'despesa',
      valor: grupo.valorUnico,
      frequencia: conhecido.frequencia,
      dia_vencimento: diaVencimento,
      data_inicio,
      data_fim: null,
      ativo: true,
      cat: classificacao.cat || '',
      subcat: classificacao.subcat || '',
      // Rastro: quem abrir a recorrência daqui a seis meses precisa saber que
      // ela não foi digitada — nasceu do que o extrato já mostrava.
      criada_de_grupo: grupo.descricao,
      criada_de_grupo_ocorrencias: datas.length,
    },
  };
}

/**
 * A frase que a tela mostra. Fica aqui porque é o que a prova consegue checar:
 * uma oferta que não diz o que vai ser criado faz a pessoa aceitar sem ler.
 */
export function frasesDaOferta(deteccao) {
  if (!deteccao) return null;
  const rotulo = { mensal: 'todo mês', bimestral: 'a cada 2 meses', trimestral: 'a cada 3 meses', semestral: 'a cada 6 meses', anual: 'uma vez por ano' };
  return {
    titulo: `Isto se repete ${rotulo[deteccao.frequencia] || deteccao.frequencia}`,
    detalhe: `Foram ${deteccao.quantas} vezes seguidas, sempre no mesmo valor, de `
           + `${soData(deteccao.primeira).split('-').reverse().join('/')} a `
           + `${soData(deteccao.ultima).split('-').reverse().join('/')}.`,
    acao: `Quer que o sistema já deixe as próximas prontas, a partir de `
        + `${soData(deteccao.mestre.data_inicio).split('-').reverse().join('/')}?`,
  };
}

export default detectarRecorrencia;
