// ===========================================================================
// PROVA: juntar várias linhas do extrato numa baixa só.
//
// Caso real: o pró-labore sai "picado" — 24 Pix somando R$ 73.160 em oito
// meses. E o dinheiro se divide entre PRÓ-LABORE (conta no Fator R) e
// ANTECIPAÇÃO DE LUCRO (não conta). Essa divisão decide o anexo do Simples,
// e o anexo vale mais de R$ 15 mil por ano.
//
// A regra que atravessa tudo: a soma das partes fecha EXATAMENTE a soma das
// linhas. Conciliação que não fecha esconde sobra dentro da conta.
//
// Rodar: npm run provas
// ===========================================================================
import {
  somarLinhas, linhaAncora, podeJuntar, validarDivisao, montarLancamentos,
} from '../src/lib/agruparLinhas.js'

let falhas = 0
const ok = (nome, cond, extra = '') => {
  console.log((cond ? '  OK   ' : '  FALHA') + ' ' + nome + (cond ? '' : ' → ' + extra))
  if (!cond) falhas++
}

const CONTA = 'sicoob-cc'
const pix = (valor, data, over = {}) => ({
  id: `l-${data}-${valor}`, conta_id: CONTA, status: 'pendente',
  data: { tipo: 'saida', valor, data, descricao: 'Pagamento Pix ***.156.628-**' },
  ...over,
})

// ── 1. Somar ───────────────────────────────────────────────────────────────
{
  const linhas = [pix(2000, '2026-03-05'), pix(2443.77, '2026-03-20')]
  ok('soma das linhas', somarLinhas(linhas) === 4443.77, String(somarLinhas(linhas)))
  ok('lista vazia soma zero', somarLinhas([]) === 0)
  ok('a âncora é a linha mais antiga', linhaAncora(linhas).data.data === '2026-03-05',
    linhaAncora(linhas)?.data?.data)
}

// ── 2. O que NÃO pode ser juntado ──────────────────────────────────────────
{
  ok('uma linha só não é agrupamento', podeJuntar([pix(100, '2026-03-01')]) !== null)

  const contasDiferentes = [pix(100, '2026-03-01'), { ...pix(100, '2026-03-02'), conta_id: 'outra' }]
  ok('contas diferentes não juntam', /contas diferentes/i.test(podeJuntar(contasDiferentes) || ''),
    podeJuntar(contasDiferentes))

  const misturado = [pix(100, '2026-03-01'), { ...pix(100, '2026-03-02'), data: { tipo: 'entrada', valor: 100, data: '2026-03-02' } }]
  ok('entrada com saída não junta', /sentido/i.test(podeJuntar(misturado) || ''), podeJuntar(misturado))

  const jaConciliada = [pix(100, '2026-03-01'), { ...pix(100, '2026-03-02'), status: 'conciliado' }]
  ok('linha já conciliada não junta', /conciliada/i.test(podeJuntar(jaConciliada) || ''), podeJuntar(jaConciliada))

  ok('duas linhas normais juntam', podeJuntar([pix(100, '2026-03-01'), pix(200, '2026-03-02')]) === null)
}

// ── 3. A divisão tem que FECHAR ────────────────────────────────────────────
{
  const linhas = [pix(2000, '2026-03-05'), pix(2000, '2026-03-20'), pix(1000, '2026-03-28')]  // 5.000

  const fecha = [
    { cat: 'Pessoal / Mão de Obra', subcat: 'Pró-labore', valor: 4443.77 },
    { cat: 'Pessoal / Mão de Obra', subcat: 'Antecipação de Lucro', valor: 556.23 },
  ]
  ok('divisão que fecha passa', validarDivisao({ linhas, partes: fecha }) === null,
    validarDivisao({ linhas, partes: fecha }))

  const falta = [{ cat: 'Pessoal / Mão de Obra', subcat: 'Pró-labore', valor: 4443.77 }]
  ok('divisão incompleta é recusada', /Faltam R\$ 556,23/.test(validarDivisao({ linhas, partes: falta }) || ''),
    validarDivisao({ linhas, partes: falta }))

  const sobra = [
    { cat: 'Pessoal / Mão de Obra', subcat: 'Pró-labore', valor: 4443.77 },
    { cat: 'Pessoal / Mão de Obra', subcat: 'Antecipação de Lucro', valor: 1000 },
  ]
  ok('divisão que passa do total é recusada', /Sobram R\$ 443,77/.test(validarDivisao({ linhas, partes: sobra }) || ''),
    validarDivisao({ linhas, partes: sobra }))
}

// ── 4. Um centavo importa ──────────────────────────────────────────────────
// Comparação em decimal deixaria passar — e conciliação com sobra de um
// centavo é conciliação errada que fecha na tela.
{
  const linhas = [pix(0.07, '2026-03-01'), pix(0.07, '2026-03-02')]  // 0,14
  ok('0,07 + 0,07 fecha 0,14',
    validarDivisao({ linhas, partes: [{ cat: 'X', valor: 0.14 }] }) === null,
    validarDivisao({ linhas, partes: [{ cat: 'X', valor: 0.14 }] }))
  ok('0,13 não fecha 0,14',
    validarDivisao({ linhas, partes: [{ cat: 'X', valor: 0.13 }] }) !== null)

  const grandes = [pix(549.99, '2026-03-01'), pix(0.01, '2026-03-02')]  // 550,00
  ok('549,99 + 0,01 fecha 550,00',
    validarDivisao({ linhas: grandes, partes: [{ cat: 'X', valor: 550 }] }) === null,
    validarDivisao({ linhas: grandes, partes: [{ cat: 'X', valor: 550 }] }))
}

// ── 5. Toda parte precisa de natureza ──────────────────────────────────────
// Sem categoria não dá para saber se conta no Fator R — que é o motivo de a
// divisão existir.
{
  const linhas = [pix(500, '2026-03-01'), pix(500, '2026-03-02')]
  ok('parte sem categoria é recusada',
    /categoria/i.test(validarDivisao({ linhas, partes: [{ cat: '', valor: 1000 }] }) || ''),
    validarDivisao({ linhas, partes: [{ cat: '', valor: 1000 }] }))
  ok('a mensagem explica que a categoria decide o Fator R',
    /Fator R/.test(validarDivisao({ linhas, partes: [{ cat: '  ', valor: 1000 }] }) || ''))
  ok('parte zerada é recusada',
    /zerado/i.test(validarDivisao({ linhas, partes: [{ cat: 'X', valor: 1000 }, { cat: 'Y', valor: 0 }] }) || ''))
  ok('sem nenhuma parte é recusada', validarDivisao({ linhas, partes: [] }) !== null)
}

// ── 6. Os lançamentos montados ─────────────────────────────────────────────
{
  const linhas = [pix(2000, '2026-03-05'), pix(2443.77, '2026-03-20')]
  const partes = [
    { cat: 'Pessoal / Mão de Obra', subcat: 'Pró-labore', valor: 4000 },
    { cat: 'Pessoal / Mão de Obra', subcat: 'Antecipação de Lucro', valor: 443.77 },
  ]
  const lancs = montarLancamentos({ linhas, partes, parte: 'Juliana', hoje: '2026-09-30' })

  ok('sai um lançamento por natureza', lancs.length === 2, String(lancs.length))
  ok('a soma dos lançamentos é a soma das linhas',
    lancs.reduce((s, l) => s + l.data.value, 0) === 4443.77,
    String(lancs.reduce((s, l) => s + l.data.value, 0)))
  ok('cada um leva a sua categoria',
    lancs[0].data.subcat === 'Pró-labore' && lancs[1].data.subcat === 'Antecipação de Lucro')
  ok('nascem liquidados na data da ÚLTIMA transferência',
    lancs.every(l => l.data.data_pagamento === '2026-03-20' && l.data.status === 'Pago'),
    JSON.stringify(lancs.map(l => l.data.data_pagamento)))
  ok('competência é o mês em que o pagamento terminou',
    lancs.every(l => l.data.data_competencia === '2026-03-01'),
    JSON.stringify(lancs.map(l => l.data.data_competencia)))
  ok('a descrição diz de quantas transferências veio',
    /2 transferência\(s\) entre 05\/03\/2026 e 20\/03\/2026/.test(lancs[0].data.desc), lancs[0].data.desc)
  ok('dispensa nota com motivo escrito',
    lancs.every(l => l.data.doc_status === 'dispensado' && l.data.doc_motivo_dispensa.length > 10))
  // Sem esta marca, desfazer o agrupamento não acha o que apagar e deixa
  // lançamentos órfãos (pagos, conciliados com nada). Achado na auditoria.
  ok('levam a marca que permite desfazer o agrupamento',
    lancs.every(l => l.data.criado_via_agrupamento === true),
    JSON.stringify(lancs.map(l => l.data.criado_via_agrupamento)))
  ok('NÃO nascem escriturados — isso é decisão dela',
    lancs.every(l => l.data.escriturado === undefined), JSON.stringify(lancs[0].data.escriturado))

  const receita = montarLancamentos({ linhas, partes: [{ cat: 'X', valor: 4443.77 }], tabela: 'receivable', parte: 'Cliente' })
  ok('do lado da receita o campo é client e o status é Recebido',
    receita[0].tabela === 'receivable' && receita[0].data.client === 'Cliente' && receita[0].data.status === 'Recebido',
    JSON.stringify(receita[0].data.status))
}

// ── 7. O caso real, inteiro ────────────────────────────────────────────────
// Oito Pix de março a agosto; a divisão que a Juliana faria.
{
  const reais = [
    pix(10000, '2026-01-20'), pix(5000, '2026-01-09'), pix(5000, '2026-02-19'),
    pix(3000, '2026-04-15'), pix(6000, '2026-04-15'), pix(3460, '2026-04-20'),
    pix(3000, '2026-05-05'), pix(5000, '2026-05-18'),
  ]
  const total = somarLinhas(reais)
  ok('oito Pix somam 40.460', total === 40460, String(total))
  ok('a âncora é o Pix mais antigo', linhaAncora(reais).data.data === '2026-01-09',
    linhaAncora(reais)?.data?.data)
  const divisao = [
    { cat: 'Pessoal / Mão de Obra', subcat: 'Pró-labore', valor: 26662.62 },
    { cat: 'Pessoal / Mão de Obra', subcat: 'Antecipação de Lucro', valor: 13797.38 },
  ]
  ok('a divisão fecha os 40.460', validarDivisao({ linhas: reais, partes: divisao }) === null,
    validarDivisao({ linhas: reais, partes: divisao }))
}

// ── O ENCONTRO DE CONTAS, A PARTIR DO GRUPO ──────────────────────────────
//
// Pedido da Juliana: "eu agrupo os valores transferidos e classifico conforme
// necessário — um, o valor exato do pró-labore; o restante, antecipação de
// lucros".
//
// O mecanismo já existia para uma seleção manual de linhas; faltava chegar
// nele a partir do grupo, em vez de marcar 43 linhas uma a uma. Estas provas
// travam a conta que o painel passa a fazer: total do grupo → parte exata +
// restante.
{
  // Três transferências para o CPF dela, valores redondos como os reais.
  const pix = [
    { id: 'x1', conta_id: 'c', status: 'pendente', data: { tipo: 'saida', valor: 5000, data: '2026-04-05' } },
    { id: 'x2', conta_id: 'c', status: 'pendente', data: { tipo: 'saida', valor: 3000, data: '2026-04-15' } },
    { id: 'x3', conta_id: 'c', status: 'pendente', data: { tipo: 'saida', valor: 1000, data: '2026-04-28' } },
  ]
  const total = somarLinhas(pix)
  ok('as três transferências somam 9.000', total === 9000, String(total))

  // Ela sabe o valor exato do pró-labore: está no recibo.
  const PRO_LABORE = 3956.05
  // "e o restante" — a conta que o botão faz, para ninguém digitar de cabeça.
  const restante = Math.round((total - PRO_LABORE) * 100) / 100
  ok('o restante fecha sem sobrar centavo', restante === 5043.95, String(restante))

  const divisao = [
    { cat: 'Pessoal / Mão de Obra', subcat: 'Pró-labore', valor: PRO_LABORE },
    { cat: 'Pessoal / Mão de Obra', subcat: 'Antecipação de Lucro', valor: restante },
  ]
  ok('a divisão fecha exatamente o total do grupo',
    validarDivisao({ linhas: pix, partes: divisao }) === null,
    validarDivisao({ linhas: pix, partes: divisao }))

  const lancs = montarLancamentos({ linhas: pix, partes: divisao, tabela: 'payable', parte: 'Juliana' })
  ok('nascem DOIS lançamentos — um por natureza, não um por linha', lancs.length === 2)
  ok('o do pró-labore guarda o valor exato do recibo',
    lancs.find(l => l.data.subcat === 'Pró-labore')?.data.value === PRO_LABORE)
  ok('o da antecipação fica com o resto',
    lancs.find(l => l.data.subcat === 'Antecipação de Lucro')?.data.value === restante)
  ok('os dois somam o que saiu do banco',
    lancs.reduce((s, l) => s + l.data.value, 0) === total)

  // A parte que decide o imposto: é a subcategoria que separa o que conta no
  // Fator R do que não conta. Se ela se perdesse no caminho, a folha sumiria e
  // o anexo do Simples mudaria sozinho, sem ninguém decidir nada.
  ok('a subcategoria sobrevive até o lançamento',
    lancs.every(l => !!l.data.subcat), JSON.stringify(lancs.map(l => l.data.subcat)))

  // Um centavo a menos não pode passar: é assim que nasce sobra escondida.
  ok('faltando um centavo, a divisão é recusada',
    validarDivisao({
      linhas: pix,
      partes: [divisao[0], { ...divisao[1], valor: restante - 0.01 }],
    }) !== null)
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTodos os casos passaram.')
process.exit(falhas ? 1 : 0)
