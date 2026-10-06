// ===========================================================================
// PROVA: "o grupo que se repete vira recorrência — se ele mesmo provar".
//
// Depois de resolver um grupo na Conciliação, o sistema já sabe o que ela não
// precisa digitar: 22 linhas de "DÉB.IOF", sempre R$ 0,82, uma por mês. A
// tela de Recorrências existe desde sempre e está VAZIA, porque cadastrar à
// mão pede nove campos e ninguém faz isso vinte vezes.
//
// O RISCO é assimétrico e é o motivo de quase toda prova aqui ser uma recusa:
// recorrência errada não incomoda, ela CRIA despesa que não existe, mês após
// mês, e ninguém percebe porque o número aparece sozinho. O erro custa mais
// que o trabalho que economiza. Na dúvida, null.
//
// Rodar: npm run provas
// ===========================================================================
import { detectarRecorrencia, frasesDaOferta, MINIMO_OCORRENCIAS } from '../src/lib/recorrenciaDoGrupo.js'

let falhas = 0
const ok = (nome, cond, extra = '') => {
  console.log((cond ? '  OK   ' : '  FALHA') + ' ' + nome + (cond ? '' : ' → ' + extra))
  if (!cond) falhas++
}

// Um grupo como agruparPendentes() devolve.
const grupo = (datas, valor = 0.82, tipo = 'saida', descricao = 'DÉB.IOF') => ({
  descricao, tipo, quantas: datas.length,
  valorUnico: valor,
  linhas: datas.map((d, i) => ({ id: 'l' + i, data: { descricao, tipo, valor, data: d } })),
})

// ── O caso real: o IOF, mensal ───────────────────────────────────────────
const iof = detectarRecorrencia(
  grupo(['2026-01-12', '2026-02-10', '2026-03-11']),
  { cat: 'Despesas Financeiras', subcat: 'Tarifas' },
)
ok('três meses seguidos no mesmo valor viram recorrência mensal',
  iof?.frequencia === 'mensal', JSON.stringify(iof))
ok('o valor da recorrência é o valor fixo observado', iof.mestre.valor === 0.82)
ok('a classificação que ela escolheu vai junto',
  iof.mestre.cat === 'Despesas Financeiras' && iof.mestre.subcat === 'Tarifas')
ok('saída vira despesa', iof.mestre.tipo === 'despesa')

// A trava mais importante deste arquivo.
ok('COMEÇA DEPOIS da última que já aconteceu — não duplica o que foi lançado',
  iof.mestre.data_inicio > '2026-03-11', iof.mestre.data_inicio)
ok('e começa no ciclo seguinte, não num mês qualquer',
  iof.mestre.data_inicio.startsWith('2026-04'), iof.mestre.data_inicio)

// ── O que ela NÃO pode criar ─────────────────────────────────────────────

// Valor que oscila é consumo (energia, telefone por uso), não mensalidade.
// Projetar um valor variável é inventar número.
ok('valor que varia não vira recorrência',
  detectarRecorrencia({ ...grupo(['2026-01-10', '2026-02-10', '2026-03-10']), valorUnico: null }) === null)

// Duas é coincidência.
ok(`menos de ${MINIMO_OCORRENCIAS} ocorrências não basta`,
  detectarRecorrencia(grupo(['2026-01-10', '2026-02-10'])) === null)

// Buraco no meio: parou e voltou, ou são coisas diferentes com o mesmo nome.
ok('intervalo irregular não vira recorrência',
  detectarRecorrencia(grupo(['2026-01-10', '2026-02-10', '2026-06-10'])) === null)

// Duas no mesmo mês significa que a descrição agrupa coisas diferentes — duas
// compras na mesma loja, por exemplo. Não há ciclo para projetar.
ok('duas cobranças no mesmo mês não viram recorrência',
  detectarRecorrencia(grupo(['2026-01-05', '2026-01-20', '2026-02-05'])) === null)

// Existe no mundo, mas o sistema não sabe projetar de 4 em 4 meses.
ok('passo que o sistema não projeta (4 meses) é recusado',
  detectarRecorrencia(grupo(['2026-01-10', '2026-05-10', '2026-09-10'])) === null)

ok('grupo vazio não vira nada', detectarRecorrencia({ linhas: [] }) === null)
ok('nulo não quebra', detectarRecorrencia(null) === null)

// ── Os outros passos que ele reconhece ───────────────────────────────────
ok('trimestral é reconhecido',
  detectarRecorrencia(grupo(['2026-01-10', '2026-04-10', '2026-07-10']))?.frequencia === 'trimestral')
ok('anual também',
  detectarRecorrencia(grupo(['2024-03-10', '2025-03-10', '2026-03-10']))?.frequencia === 'anual')

// ── Entrada vira receita ─────────────────────────────────────────────────
const receita = detectarRecorrencia(
  grupo(['2026-01-05', '2026-02-05', '2026-03-05'], 5000, 'entrada', 'Recebimento Pix TERRA CONTTEMPOR'),
  { cat: 'Receita de Serviços' },
)
ok('entrada vira receita', receita?.mestre.tipo === 'receita')
ok('e guarda a descrição do extrato', receita.mestre.descricao.includes('TERRA CONTTEMPOR'))

// ── O dia da cobrança: o que mais se repete ──────────────────────────────
//
// A data do banco varia com fim de semana e feriado; o dia que mais aparece é
// o combinado de verdade.
ok('o dia de vencimento é o mais frequente, não o primeiro',
  detectarRecorrencia(grupo(['2026-01-12', '2026-02-10', '2026-03-10'])).mestre.dia_vencimento === 10)

// Dia 31 num mês de 30: a data de início não pode nascer inválida.
const dia31 = detectarRecorrencia(grupo(['2026-01-31', '2026-03-31', '2026-05-31']))
ok('dia 31 não gera data inválida no mês seguinte',
  dia31 && /^\d{4}-\d{2}-\d{2}$/.test(dia31.mestre.data_inicio)
       && !Number.isNaN(new Date(dia31.mestre.data_inicio + 'T12:00:00').getTime()),
  dia31?.mestre.data_inicio)

// ── A oferta diz o que vai acontecer ─────────────────────────────────────
//
// Oferta que não diz o que vai ser criado faz a pessoa aceitar sem ler — e
// aceitar sem ler é como nasce despesa fantasma.
const f = frasesDaOferta(iof)
ok('a oferta diz a frequência em português', f.titulo.includes('todo mês'), f?.titulo)
ok('diz quantas vezes aconteceu e em que período',
  f.detalhe.includes('3 vezes') && f.detalhe.includes('12/01/2026'), f?.detalhe)
ok('e diz a partir de quando as próximas nascem',
  f.acao.includes('/04/2026'), f?.acao)
ok('sem detecção não há oferta', frasesDaOferta(null) === null)

// ── O rastro ─────────────────────────────────────────────────────────────
ok('fica registrado que nasceu de um grupo, não da digitação',
  iof.mestre.criada_de_grupo === 'DÉB.IOF' && iof.mestre.criada_de_grupo_ocorrencias === 3)

console.log(falhas ? `\n${falhas} falha(s).` : '\n  todas passaram.')
process.exit(falhas ? 1 : 0)
