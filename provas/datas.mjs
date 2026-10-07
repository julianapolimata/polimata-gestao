// O calendário do sistema. Data é onde mais se erra em silêncio: o erro não
// aparece na tela, aparece no fechamento do mês, três semanas depois.
import {
  hojeISO, ehISO, paraBR, deBR, diasNoMes, somarMeses, gradeDoMes, mesDe, foraDoLimite,
} from '../src/lib/datas.js'

let falhas = 0
const ok = (cond, oque) => { if (!cond) { falhas++; console.error('  X ' + oque) } }

// ── A ARMADILHA DO FUSO ──────────────────────────────────────────────────
// new Date('2025-05-22') é meia-noite em UTC; no Brasil vira 21/05 às 21h, e
// toISOString().slice(0,10) devolve o dia ANTERIOR. É o bug clássico de data
// em sistema brasileiro, e ele erra sempre para trás.
ok(paraBR('2025-05-22') === '22/05/2025', 'converter para BR não anda um dia para trás')
ok(deBR('22/05/2025') === '2025-05-22', 'converter de BR não anda um dia para frente')
ok(deBR(paraBR('2026-01-01')) === '2026-01-01', 'ida e volta no 1º de janeiro (o pior caso do fuso)')
ok(gradeDoMes(2025, 4).some(c => c.iso === '2025-05-22'), 'a grade usa data local, não UTC')

// ── O QUE A PESSOA DIGITA DE VERDADE ─────────────────────────────────────
ok(deBR('22/05/2025') === '2025-05-22', 'com barra')
ok(deBR('22-05-2025') === '2025-05-22', 'com traço')
ok(deBR('22052025') === '2025-05-22', 'só números')
ok(deBR('22/5/25') === '2025-05-22', 'mês e ano curtos')
ok(deBR('2/5/2025') === '2025-05-02', 'dia sem zero à esquerda')
ok(deBR('22/05', 2026) === '2026-05-22', 'sem o ano, assume o ano de referência')
ok(deBR('2025-05-22') === '2025-05-22', 'já no formato do banco passa direto')
ok(deBR('  22/05/2025  ') === '2025-05-22', 'espaço sobrando não atrapalha')
ok(deBR('') === null && deBR(null) === null, 'vazio é vazio, não é hoje')

// ── O QUE NÃO PODE VIRAR DATA ────────────────────────────────────────────
// Aceitar 31/02 calado é pior que recusar: vira 03/03 lá na frente.
ok(deBR('31/02/2025') === null, '31 de fevereiro não existe')
ok(deBR('30/02/2024') === null, 'nem em ano bissexto')
ok(deBR('29/02/2024') === '2024-02-29', 'mas 29/02 de ano bissexto existe')
ok(deBR('29/02/2025') === null, 'e não existe fora dele')
ok(deBR('22/13/2025') === null, 'mês 13 não existe')
ok(deBR('00/05/2025') === null, 'dia zero não existe')
ok(deBR('abacaxi') === null, 'texto não vira data')
ok(ehISO('2025-02-31') === false, 'a validação do ISO também confere o dia no mês')
ok(ehISO('2025-5-2') === false, 'ISO exige dois dígitos')

// ── A GRADE DO CALENDÁRIO ────────────────────────────────────────────────
const maio = gradeDoMes(2025, 4)
ok(maio.length === 42, 'sempre 6 semanas — trocar de mês não muda a altura do painel')
ok(maio.filter(c => c.doMes).length === 31, 'maio tem 31 dias dentro do mês')
ok(maio[0].iso === '2025-04-27', 'a grade começa no domingo anterior')
ok(maio.find(c => c.iso === '2025-04-30').doMes === false, 'dia de outro mês vem marcado como de fora')
ok(gradeDoMes(2026, 1).filter(c => c.doMes).length === 28, 'fevereiro comum')
ok(gradeDoMes(2024, 1).filter(c => c.doMes).length === 29, 'fevereiro bissexto')
// Mês que começa no domingo é o caso que quebra grade ingênua.
ok(gradeDoMes(2025, 5)[0].iso === '2025-06-01', 'junho/2025 começa num domingo e não ganha semana vazia na frente')

ok(diasNoMes(2025, 1) === 28 && diasNoMes(2024, 1) === 29, 'dias de fevereiro')

// ── NAVEGAR ENTRE MESES ──────────────────────────────────────────────────
ok(somarMeses('2025-01-31', 1) === '2025-02-28', '31/01 + 1 mês trava no fim de fevereiro, não vira 03/03')
ok(somarMeses('2025-12-15', 1) === '2026-01-15', 'virada de ano para frente')
ok(somarMeses('2025-01-15', -1) === '2024-12-15', 'virada de ano para trás')
ok(somarMeses('2025-03-31', -1) === '2025-02-28', 'voltar um mês também trava no último dia')

const m = mesDe('2025-05-22')
ok(m.ano === 2025 && m.mes === 4, 'mês de uma data (0-11)')
const vazio = mesDe('', new Date(2026, 9, 6))
ok(vazio.ano === 2026 && vazio.mes === 9, 'sem data, o calendário abre no mês corrente')

// ── LIMITES ──────────────────────────────────────────────────────────────
ok(foraDoLimite('2025-05-22', '2025-06-01', '') === true, 'antes do mínimo')
ok(foraDoLimite('2025-07-22', '', '2025-06-01') === true, 'depois do máximo')
ok(foraDoLimite('2025-05-22', '2025-01-01', '2025-12-31') === false, 'dentro do intervalo')
ok(foraDoLimite('', '2025-01-01', '') === false, 'vazio não é fora do limite')

ok(hojeISO(new Date(2026, 0, 1)) === '2026-01-01', 'hoje usa o relógio local no 1º de janeiro')
ok(hojeISO(new Date(2025, 11, 31)) === '2025-12-31', 'e no último dia do ano')

if (falhas) { console.error(falhas + ' falha(s)'); process.exit(1) }
console.log('  ok: datas convertem sem andar um dia, e 31/02 não passa')
