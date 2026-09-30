// ===========================================================================
// PROVA: "a diferença de valor só é tolerada quando há evidência de
// identidade" (REGRAS.md, regra 7).
//
// Esta é a regra que separa uma sugestão de um chute. Conciliar é cruzar
// dinheiro com documento; fazer bater sem saber QUEM está do outro lado é só
// fazer bater — e bater não é a mesma coisa que estar certo.
//
// Rodar: npm run provas
// ===========================================================================
import { classificarLinha, sugerirMatches, sugerirCombinacoes } from '../src/lib/matchExtrato.js'
import { ehPagamentoFatura } from '../src/lib/faturaCartao.js'

let falhas = 0
const ok = (nome, cond, extra = '') => {
  console.log((cond ? '  OK   ' : '  FALHA') + ' ' + nome + (cond ? '' : ' → ' + extra))
  if (!cond) falhas++
}

const linha = (descricao, valor, data, extra = {}) => ({ tipo: 'saida', descricao, valor, data, ...extra })
const lanc = (id, parte, value, due, extra = {}) => ({ id, value, due, data: { supplier: parte, value, due, ...extra } })

// ── 1. A linha é entendida ANTES de procurar par ───────────────────────────
// Encargo do banco não tem par: o certo é criar, não casar.
{
  // Descrições REAIS do extrato do Sicoob — prova com string inventada não diz
  // nada sobre o extrato dela.
  for (const d of [
    'Debito Automatico Cartao · DEBITO AUTOMATICO FATURA CARTÃO VISA',
    'Pagamento de cartão de crédito · DÉB. PAGAMENTO DE BOLETO INTERCREDIS',
  ]) {
    ok('pagamento da fatura reconhecido: ' + d.slice(0, 32),
      classificarLinha({ descricao: d }).tipo === 'fatura', classificarLinha({ descricao: d }).tipo)
  }
  // E o contrário, que é onde mora o perigo: TODO Pix do Sicoob começa com
  // "Pagamento". Se isso virasse "pagamento da fatura", 25 linhas da conta
  // corrente parariam de procurar par.
  for (const d of [
    'Pagamento Pix 00.394.460 0058-87 · PIX EMITIDO OUTRA IF',
    'Pagamento Pix ***.156.628-** · PIX EMITIDO OUTRA IF',
    'DÉB. PAGAMENTO DE BOLETO INTERCREDIS',
  ]) {
    ok('Pix/boleto NÃO é pagamento de fatura: ' + d.slice(0, 28),
      classificarLinha({ descricao: d }).tipo !== 'fatura', classificarLinha({ descricao: d }).tipo)
  }
  ok('encargo do banco é reconhecido', classificarLinha({ descricao: 'IOF SAQ/ROTATIVO DIARIO' }).tipo === 'encargo',
    classificarLinha({ descricao: 'IOF SAQ/ROTATIVO DIARIO' }).tipo)
  ok('compra comum não é classificada como nada disso', classificarLinha({ descricao: 'PG *BUSTI NEGOCIO' }).tipo === 'comum')
  ok('encargo vem com a explicação de que não existe par',
    /criar/i.test(classificarLinha({ descricao: 'TARIFA MENSALIDADE' }).explicacao || ''),
    classificarLinha({ descricao: 'TARIFA MENSALIDADE' }).explicacao)
}

// ── 2. Valor diferente SEM identidade não vira sugestão ────────────────────
{
  const r = sugerirMatches(
    linha('PIX ENVIADO', 1000, '2026-07-10'),
    [lanc('A', 'FORNECEDOR DESCONHECIDO', 1010, '2026-07-10')],
  )
  ok('valor diferente e nenhuma identidade → nenhuma sugestão', r.length === 0, JSON.stringify(r.map(x => x.motivo)))
}

// ── 3. Valor diferente COM identidade vira sugestão (juros, multa) ─────────
{
  const r = sugerirMatches(
    linha('PIX ENVIADO CLICKSIGN GESTAO', 1010, '2026-07-10'),
    [lanc('A', 'CLICKSIGN GESTAO DE DOCUMENTOS', 1000, '2026-07-10')],
  )
  ok('mesmo nome + valor próximo → sugere', r.length === 1, JSON.stringify(r.map(x => x.motivo)))
  ok('e explica que o valor difere', /difere/i.test(r[0]?.motivo || ''), r[0]?.motivo)
  ok('mas NÃO com confiança alta (o valor não bate)', r[0]?.confianca !== 'alta', r[0]?.confianca)
}

// ── 4. Valor exato sem identidade ainda é sugestão, mas fraca ──────────────
{
  const r = sugerirMatches(
    linha('DEBITO EM CONTA', 250, '2026-07-10'),
    [lanc('A', 'ALGUEM', 250, '2026-07-10')],
  )
  ok('valor exato entra como sugestão mesmo sem nome', r.length === 1)
  ok('e a data igual basta para confiança alta', r[0]?.confianca === 'alta', r[0]?.confianca)
}

// ── 5. O mesmo identificador do banco encerra a discussão ──────────────────
{
  const r = sugerirMatches(
    linha('QUALQUER COISA', 999, '2026-07-10', { fit_id: 'ABC123' }),
    [lanc('A', 'OUTRO NOME QUALQUER', 999, '2026-01-01', { fit_id_ofx: 'ABC123' })],
  )
  ok('mesmo fit_id → confiança alta mesmo com data distante', r[0]?.confianca === 'alta', r[0]?.confianca)
  ok('e o motivo diz por quê', /identificador/i.test(r[0]?.motivo || ''), r[0]?.motivo)
}

// ── 6. Diferença GRANDE não passa nem com identidade ───────────────────────
// Identidade explica juros e multa, não explica outro pagamento.
{
  const r = sugerirMatches(
    linha('PIX CLICKSIGN', 5000, '2026-07-10'),
    [lanc('A', 'CLICKSIGN GESTAO DE DOCUMENTOS', 40, '2026-07-10')],
  )
  ok('diferença enorme não vira sugestão nem com o nome batendo', r.length === 0,
    JSON.stringify(r.map(x => x.motivo)))
}

// ── 7. A ordem: a melhor evidência primeiro ────────────────────────────────
{
  const r = sugerirMatches(
    linha('PIX ENVIADO CLICKSIGN GESTAO', 1000, '2026-07-10'),
    [
      lanc('fraco', 'OUTRO FORNECEDOR', 1000, '2026-02-01'),
      lanc('forte', 'CLICKSIGN GESTAO DE DOCUMENTOS', 1000, '2026-07-10'),
    ],
  )
  ok('o par com nome e data confere vem primeiro', r[0]?.lancamento.id === 'forte',
    r.map(x => x.lancamento.id).join(' > '))
}

// ── 8. Nada de candidatos, nada de sugestão ────────────────────────────────
{
  ok('sem candidatos não inventa', sugerirMatches(linha('X', 10, '2026-07-10'), []).length === 0)
  ok('valor inválido não inventa', sugerirMatches(linha('X', NaN, '2026-07-10'), [lanc('A', 'Y', 10, '2026-07-10')]).length === 0)
}

// ── 9. Combinações (um pagamento quita várias contas) ──────────────────────
// Só da MESMA parte — senão qualquer valor acha uma soma por acaso.
{
  const combos = sugerirCombinacoes(
    linha('PIX ENVIADO CLICKSIGN', 130, '2026-07-10'),
    [
      lanc('a', 'CLICKSIGN GESTAO', 40, '2026-07-01'),
      lanc('b', 'CLICKSIGN GESTAO', 90, '2026-07-05'),
      lanc('c', 'OUTRO FORNECEDOR', 130, '2026-07-02'),
    ],
  )
  ok('acha a soma 40 + 90 do mesmo fornecedor', combos.length > 0, JSON.stringify(combos.slice(0, 1)))
  const ids = (combos[0]?.lancamentos || combos[0]?.itens || []).map(x => x.id).sort().join(',')
  ok('e a combinação é a do fornecedor certo', ids === 'a,b', ids || JSON.stringify(combos[0]))
}
{
  const combos = sugerirCombinacoes(
    linha('PIX ENVIADO', 130, '2026-07-10'),
    [lanc('a', 'FORNECEDOR UM', 40, '2026-07-01'), lanc('b', 'FORNECEDOR DOIS', 90, '2026-07-05')],
  )
  ok('não soma partes DIFERENTES para fechar o valor', combos.length === 0, JSON.stringify(combos))
}

// ── 10. Duas definições de "pagamento da fatura", dois escopos ─────────────
// faturaCartao.ehPagamentoFatura é LARGO de propósito: na conta do cartão, um
// crédito descrito só como "PAGAMENTO" é o pagamento da fatura. Fora desse
// escopo ele casa com todo Pix do Sicoob. Esta prova fixa os dois lados para
// que ninguém troque um pelo outro por engano.
{
  ok('ehPagamentoFatura é largo — casa com "Pagamento Pix" também',
    ehPagamentoFatura('Pagamento Pix 00.394.460 0058-87 · PIX EMITIDO OUTRA IF') === true,
    'se isto mudar, reveja o comentário de escopo em faturaCartao.js')
  ok('por isso ele só pode ser usado em ENTRADA da conta do cartão',
    classificarLinha({ descricao: 'Pagamento Pix 00.394.460 0058-87 · PIX EMITIDO OUTRA IF' }).tipo === 'comum',
    'classificarLinha é a função certa para conta corrente')
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTodos os casos passaram.')
process.exit(falhas ? 1 : 0)
