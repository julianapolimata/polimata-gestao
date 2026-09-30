// ===========================================================================
// PROVA: "o sistema aprende do que você decidiu, nunca do que ele propôs"
// (REGRAS.md, regra 6). As três condições, testadas pela INTENÇÃO:
//
//   1. só aprende do que foi decidido à mão;
//   2. só vira regra se o histórico for unânime;
//   3. a regra copia a classificação, e só ela.
//
// Se isto quebra, um erro vira doutrina: a proposta errada é aplicada em lote
// e realimenta a si mesma. É a regra com maior efeito multiplicador do sistema.
//
// Rodar: npm run provas
// ===========================================================================
import { construirRegras, regraPara, escriturarAuto, chaveRecorrente, normalizarFornecedor } from '../src/lib/escrituracao.js'

let falhas = 0
const ok = (nome, cond, extra = '') => {
  console.log((cond ? '  OK   ' : '  FALHA') + ' ' + nome + (cond ? '' : ' → ' + extra))
  if (!cond) falhas++
}

const escriturado = (supplier, cat, subcat, doc_status, por = 'manual', extra = {}) => ({
  data: { supplier, cat, subcat, doc_status, escriturado: true, escriturado_por: por, ...extra },
})

// ── 1. Só aprende do que foi decidido à mão ────────────────────────────────
{
  const regras = construirRegras([
    escriturado('CLICKSIGN*Clicksi SAO PAULO', 'Despesas Operacionais', 'Softwares', 'vinculado', 'auto'),
  ])
  ok('escrituração AUTOMÁTICA não vira regra', regras.size === 0, `${regras.size} regra(s)`)
}
{
  const regras = construirRegras([
    escriturado('SEBRAE SP', 'Capacitação e Desenvolvimento', 'Eventos', 'vinculado', 'grandfather'),
  ])
  ok('escrituração de migração (grandfather) não vira regra', regras.size === 0, `${regras.size} regra(s)`)
}
{
  const regras = construirRegras([
    escriturado('EBN *Canva04559', 'Despesas Operacionais', 'Softwares', 'vinculado', 'sistema'),
  ])
  ok('escrituração feita pelo sistema não vira regra', regras.size === 0, `${regras.size} regra(s)`)
}
{
  const regras = construirRegras([
    escriturado('ADOBE', 'Despesas Operacionais', 'Softwares', 'vinculado', 'manual'),
  ])
  ok('decisão MANUAL vira regra', regras.size === 1, `${regras.size} regra(s)`)
}

// ── 2. O ciclo não se fecha sobre si mesmo ─────────────────────────────────
// Uma escrituração feita POR REGRA não pode voltar a alimentar as regras —
// senão a proposta vira prova de si mesma.
{
  const original = { supplier: 'ADOBE', value: 120, desc: 'ADOBE', data_competencia: '2026-03-01' }
  const regra = { cat: 'Despesas Operacionais', subcat: 'Softwares', doc_status: 'vinculado', doc_motivo_dispensa: '' }
  const aplicado = escriturarAuto(original, regra, '2026-09-30T12:00:00Z')
  ok('escriturarAuto marca a origem como automática', aplicado.escriturado_por === 'auto', aplicado.escriturado_por)
  const regras = construirRegras([{ data: aplicado }])
  ok('e o resultado dela NÃO volta a virar regra', regras.size === 0, `${regras.size} regra(s)`)
}

// ── 3. Só vira regra se o histórico for unânime ────────────────────────────
{
  const regras = construirRegras([
    escriturado('UBER *TRIP', 'Deslocamento e Viagem', 'Combustível', 'dispensado'),
    escriturado('UBER *TRIP', 'Despesas Operacionais', 'Softwares', 'vinculado'),
  ])
  ok('histórico divergente NÃO vira regra', regras.size === 0, `${regras.size} regra(s)`)
}
{
  const regras = construirRegras([
    escriturado('UBER *TRIP', 'Deslocamento e Viagem', 'Combustível', 'dispensado'),
    escriturado('UBER *TRIP', 'Deslocamento e Viagem', 'Combustível', 'dispensado'),
    escriturado('UBER *TRIP', 'Deslocamento e Viagem', 'Combustível', 'dispensado'),
  ])
  ok('histórico unânime vira regra', regras.size === 1, `${regras.size} regra(s)`)
}
{
  // Divergência SÓ na situação fiscal também é divergência: a situação fiscal
  // faz parte da decisão, não é detalhe.
  const regras = construirRegras([
    escriturado('IOF OPERACAO EXTERIOR', 'Despesas Financeiras', 'IOF', 'dispensado'),
    escriturado('IOF OPERACAO EXTERIOR', 'Despesas Financeiras', 'IOF', 'vinculado'),
  ])
  ok('divergência só na situação fiscal também impede a regra', regras.size === 0, `${regras.size} regra(s)`)
}

// ── 4. Lançamento sem classificação real não ensina nada ───────────────────
{
  const regras = construirRegras([
    escriturado('FORNECEDOR SEM CAT', '', '', 'vinculado'),
    escriturado('FORNECEDOR SEM DOC', 'Despesas Operacionais', 'Softwares', ''),
  ])
  ok('sem categoria ou sem situação fiscal não vira regra', regras.size === 0, `${regras.size} regra(s)`)
}

// ── 5. A chave: CNPJ vence a descrição ─────────────────────────────────────
// É o que faz a NOTA ("Anthropic, PBC") e a COBRANÇA DO CARTÃO
// ("ANTHROPIC* CLAUDE SU...") caírem na mesma regra quando ambas trazem CNPJ.
{
  const k1 = chaveRecorrente({ supplier: 'Anthropic, PBC', cnpj: '12.345.678/0001-90' })
  const k2 = chaveRecorrente({ supplier: 'ANTHROPIC* CLAUDE SU ANTHROPIC.COM', cnpj: '12345678000190' })
  ok('mesmo CNPJ, nomes diferentes → mesma chave', k1 === k2 && k1.startsWith('cnpj:'), `${k1} × ${k2}`)
}
{
  const k1 = chaveRecorrente({ supplier: 'PORTO SEGURO SEGUROS  01/12   SAO PAULO' })
  const k2 = chaveRecorrente({ supplier: 'PORTO SEGURO SEGUROS  07/12   SAO PAULO' })
  ok('parcelas diferentes da mesma série → mesma chave', k1 === k2, `${k1} × ${k2}`)
}
{
  ok('número longo (cartão/documento) não separa fornecedores iguais',
    normalizarFornecedor('EBN *Canva04559 6') === normalizarFornecedor('EBN *Canva04559 6'),
    'sanidade')
  const k1 = chaveRecorrente({ supplier: 'PIX ENVIADO 20260315123456789' })
  const k2 = chaveRecorrente({ supplier: 'PIX ENVIADO 20260416987654321' })
  ok('números longos são descartados na chave', k1 === k2, `${k1} × ${k2}`)
}
{
  ok('sem nome e sem CNPJ não há chave', chaveRecorrente({}) === null, String(chaveRecorrente({})))
}

// ── 6. A regra copia a CLASSIFICAÇÃO, e só ela ─────────────────────────────
{
  const original = {
    supplier: 'CLICKSIGN', value: 42.62, desc: 'CLICKSIGN*Clicksi',
    data_competencia: '2026-07-25', due: '2026-08-22', numero_nf: '00678536',
    cat: 'Operacional', subcat: 'texto livre antigo',
  }
  const regra = { cat: 'Despesas Operacionais', subcat: 'Softwares', doc_status: 'vinculado', doc_motivo_dispensa: '' }
  const r = escriturarAuto(original, regra, '2026-09-30T12:00:00Z')
  ok('valor preservado', r.value === 42.62)
  ok('datas preservadas', r.data_competencia === '2026-07-25' && r.due === '2026-08-22')
  ok('número da nota preservado', r.numero_nf === '00678536')
  ok('classificação substituída pela da regra', r.cat === 'Despesas Operacionais' && r.subcat === 'Softwares')
  ok('a regra aplicada fica registrada no lançamento', !!r.escriturado_regra, String(r.escriturado_regra))
}

// ── 7. "Não tem nota" carrega o motivo junto ───────────────────────────────
// Sem isso a regra aplicaria "sem nota fiscal" sem justificativa — que é
// exatamente o que a regra 2 do manual proíbe.
{
  const regras = construirRegras([
    escriturado('ANUIDADE VISA C', 'Despesas Financeiras', 'Tarifas bancárias', 'dispensado', 'manual',
      { doc_motivo_dispensa: 'Tarifa bancária: o documento é o extrato.' }),
    escriturado('ANUIDADE VISA C', 'Despesas Financeiras', 'Tarifas bancárias', 'dispensado', 'manual',
      { doc_motivo_dispensa: 'Tarifa bancária: o documento é o extrato.' }),
  ])
  const r = regraPara({ supplier: 'ANUIDADE VISA C' }, regras)
  ok('a regra guarda o motivo da dispensa', r?.doc_motivo_dispensa?.includes('extrato'), JSON.stringify(r))
  const aplicado = escriturarAuto({ supplier: 'ANUIDADE VISA C', value: 15 }, r, '2026-09-30T12:00:00Z')
  ok('e o motivo vai junto ao aplicar', aplicado.doc_motivo_dispensa?.includes('extrato'), aplicado.doc_motivo_dispensa)
}

// ── 8. Sem regras, nada é proposto ─────────────────────────────────────────
{
  ok('mapa vazio não propõe nada', regraPara({ supplier: 'QUALQUER' }, new Map()) === null)
  ok('fornecedor desconhecido não recebe proposta',
    regraPara({ supplier: 'NOVO FORNECEDOR' }, construirRegras([escriturado('ADOBE', 'Despesas Operacionais', 'Softwares', 'vinculado')])) === null)
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTodos os casos passaram.')
process.exit(falhas ? 1 : 0)
