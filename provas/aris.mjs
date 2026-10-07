// A Aris contábil. O risco aqui não é errar a conta — é ACERTAR O TOM e errar
// o conteúdo: produzir um parecer fluente, com cara de contador, apoiado numa
// generalização plausível. Foi o que eu fiz com o "Seguro Prestamista" antes de
// a Juliana perguntar "TEM CERTEZA?".
//
// Por isso quase toda esta prova cobra RECUSA, não acerto.
import { montarPergunta, lerResposta, opcoesDoPlano } from '../src/lib/aris.js'
import {
  procurar, respostaDoHistorico, fraseDaEvidencia, chave, semParcela,
} from '../src/lib/arisHistorico.js'

let falhas = 0
const ok = (cond, oque) => { if (!cond) { falhas++; console.error('  X ' + oque) } }

const plano = [
  { tipo: 'Saída', categoria: 'Despesas Operacionais', subcategoria: 'Seguro Prestamista', classificacao: 'Despesas Financeiras' },
  { tipo: 'Saída', categoria: 'Despesas Operacionais', subcategoria: 'Seguro de Vida', classificacao: 'Despesas Operacionais' },
  { tipo: 'Saída', categoria: 'Despesas Financeiras', subcategoria: 'IOF', classificacao: 'Despesas Financeiras' },
  { tipo: 'Entrada', categoria: 'Receita de Serviços', subcategoria: 'Consultoria', classificacao: 'Receita Operacional' },
]

// ── A TRAVA: CATEGORIA QUE NÃO EXISTE É RECUSADA ─────────────────────────
// O prompt PEDE para não inventar. Isto aqui RECUSA se inventar. Instrução é
// pedido; isto é controle, e é a diferença entre confiar e conferir.
const inventada = lerResposta(
  '{"cat":"Despesas com Seguros","subcat":"Prestamista","confianca":"alta","porque":"é um seguro"}',
  plano, 'Saída')
ok(inventada.ok === false, 'categoria fora do plano é RECUSADA')
ok(/não existe no seu plano/.test(inventada.motivo), 'e a recusa diz por quê, com o nome inventado')

// Nem "quase certo" passa: subcategoria errada é outra conta.
const quase = lerResposta(
  '{"cat":"Despesas Operacionais","subcat":"Seguro Prestamista ","confianca":"alta","porque":"x"}',
  plano, 'Saída')
ok(quase.ok === true, 'espaço sobrando não derruba a sugestão boa')
const erradaSub = lerResposta(
  '{"cat":"Despesas Operacionais","subcat":"Seguros","confianca":"alta","porque":"x"}',
  plano, 'Saída')
ok(erradaSub.ok === false, 'subcategoria que não existe é recusada, mesmo com a categoria certa')

// Tipo errado: categoria de Entrada não serve para uma Saída.
const tipoErrado = lerResposta(
  '{"cat":"Receita de Serviços","subcat":"Consultoria","confianca":"alta","porque":"x"}',
  plano, 'Saída')
ok(tipoErrado.ok === false, 'categoria de entrada não pode classificar uma saída')

// ── "NÃO SEI" É RESPOSTA VÁLIDA ──────────────────────────────────────────
const naoSei = lerResposta(
  '{"cat":null,"subcat":null,"confianca":"baixa","porque":"não consigo ligar a crédito nenhum","falta_saber":"o contrato do Sicoob"}',
  plano, 'Saída')
ok(naoSei.ok === true && naoSei.cat === null, 'não saber não é erro')
ok(naoSei.faltaSaber === 'o contrato do Sicoob', 'e diz o que confirmaria a resposta')

// ── CONFIANÇA ALTA SEM EXPLICAÇÃO NÃO PASSA ──────────────────────────────
const semPorque = lerResposta(
  '{"cat":"Despesas Financeiras","subcat":"IOF","confianca":"alta","porque":""}',
  plano, 'Saída')
ok(semPorque.ok === true && semPorque.confianca === 'media',
  'confiança alta sem explicação cai para média — a régua é mostrar a evidência')

// ── RESPOSTA MALFORMADA NÃO VIRA SUGESTÃO ────────────────────────────────
ok(lerResposta('Acho que é despesa financeira.', plano, 'Saída').ok === false, 'texto solto não vira sugestão')
ok(lerResposta('', plano, 'Saída').ok === false, 'resposta vazia não vira sugestão')
ok(lerResposta('{"cat":"Despesas Financeiras","subcat":"IOF"', plano, 'Saída').ok === false, 'JSON quebrado não vira sugestão')
const comCerca = lerResposta(
  '```json\n{"cat":"Despesas Financeiras","subcat":"IOF","confianca":"media","porque":"imposto sobre operação financeira"}\n```',
  plano, 'Saída')
ok(comCerca.ok === true && comCerca.subcat === 'IOF', 'JSON embrulhado em crase é aceito')

// ── O PROMPT ─────────────────────────────────────────────────────────────
const { system, pergunta } = montarPergunta({
  descricao: 'DÉB.SEGURO PRESTAMISTA', parte: 'Sicoob', valor: 2.59, tipo: 'Saída', plano, candidatos: [],
})
ok(/NUNCA cite norma, lei, NBC, CPC/i.test(system),
  'o prompt proíbe citar norma — o que o modelo lembra de norma não dá para conferir aqui')
ok(/SOMENTE uma das opções listadas/i.test(system), 'o prompt manda escolher só do plano dela')
ok(/escolha nula/i.test(system), 'o prompt deixa explícito que pode não saber')
ok(pergunta.includes('Seguro Prestamista') && pergunta.includes('IOF'), 'as opções do plano vão no texto')
ok(!pergunta.includes('Consultoria'), 'opção de Entrada não é oferecida para uma Saída')
ok(opcoesDoPlano(plano, 'Saída').length === 3, 'opções filtradas por tipo')

// ── O HISTÓRICO, QUE VENCE O MODELO ──────────────────────────────────────
const historico = [
  { tipo: 'Saída', parte: 'Vivo', descricao: 'DÉB.CONV.TELECOMUNICAÇÕES', cat: 'Despesas Operacionais', subcat: 'Seguro de Vida', vezes: 7, ultima: '2025-12-15' },
  { tipo: 'Saída', parte: 'Outro', descricao: 'DÉB. CONV. SEGUROS', cat: 'Despesas Operacionais', subcat: 'Seguro de Vida', vezes: 9, ultima: '2025-11-10' },
  { tipo: 'Entrada', parte: 'Cliente', descricao: 'DÉB.CONV.TELECOMUNICAÇÕES', cat: 'Receita de Serviços', subcat: 'Consultoria', vezes: 1, ultima: '2025-01-01' },
]

const achados = procurar({ descricao: 'DÉB.CONV.TELECOMUNICAÇÕES', parte: 'Vivo', tipo: 'Saída', historico })
ok(achados.length === 1 && achados[0].vezes === 7, 'acha a classificação anterior da mesma descrição')
ok(achados[0].forca === 'exata', 'mesma descrição é evidência forte')
ok(!achados.some(c => c.cat === 'Receita de Serviços'), 'não mistura entrada com saída')

const resolvido = respostaDoHistorico(achados)
ok(resolvido && resolvido.vezes === 7, 'histórico inequívoco resolve sozinho, sem chamar a IA')
ok(/7 vezes/.test(fraseDaEvidencia(resolvido)) && /15\/12\/2025/.test(fraseDaEvidencia(resolvido)),
  'a evidência diz quantas vezes e quando — é o que ela confere olhando')

// Duas decisões diferentes para a mesma descrição: quem desempata é ela.
const ambiguo = procurar({
  descricao: 'TARIFA', parte: '', tipo: 'Saída',
  historico: [
    { tipo: 'Saída', parte: 'A', descricao: 'TARIFA', cat: 'Despesas Financeiras', subcat: 'IOF', vezes: 3, ultima: '2025-03-01' },
    { tipo: 'Saída', parte: 'B', descricao: 'TARIFA', cat: 'Despesas Operacionais', subcat: 'Seguro de Vida', vezes: 2, ultima: '2025-05-01' },
  ],
})
ok(ambiguo.length === 2, 'as duas classificações aparecem')
ok(respostaDoHistorico(ambiguo) === null,
  'histórico ambíguo NÃO decide sozinho — desempate automático esconderia a divergência dela')

// Mesma parte é evidência fraca: a mesma empresa vende coisas de naturezas
// diferentes, e isso não pode virar resposta automática.
const porParte = procurar({ descricao: 'COISA NOVA', parte: 'Vivo', tipo: 'Saída', historico })
ok(porParte.length === 1 && porParte[0].forca === 'parte', 'acha pelo fornecedor, marcado como evidência fraca')
ok(respostaDoHistorico(porParte) === null, 'evidência de fornecedor não resolve sozinha')
ok(/outros lançamentos desta mesma parte/.test(fraseDaEvidencia(porParte[0])),
  'e a frase deixa claro que é por fornecedor, não pela mesma despesa')

// ── NORMALIZAÇÃO: O LIMITE APRENDIDO DO JEITO CARO ───────────────────────
ok(semParcela('SebraeSp 3/10') === 'sebraesp', 'número da parcela sai: a compra é a mesma')
ok(chave('DÉB.CONV.SEGUROS') === chave('deb.conv.seguros'), 'acento e caixa não separam')
ok(chave('Pagamento Pix ***.156.628-**') !== chave('Pagamento Pix ***.985.018-**'),
  'DUAS PESSOAS DIFERENTES continuam diferentes — foi o erro que custou caro no agrupamento')

if (falhas) { console.error(falhas + ' falha(s)'); process.exit(1) }
console.log('  ok: a Aris só escolhe do plano dela, mostra a evidência e pode dizer que não sabe')
