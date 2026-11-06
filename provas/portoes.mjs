// ===========================================================================
// PROVA: os três portões de entrada.
//
// Cada caso abaixo é um documento que JÁ ENTROU no sistema e que não devia ter
// entrado como conta a pagar. A prova não testa a ideia do portão — testa que
// esses documentos, exatamente como vieram, são barrados; e que os legítimos,
// exatamente como vieram, passam.
//
// Rodar: npm run provas
// ===========================================================================
import { portoesDeEntrada, resumoDasFalhas } from '../lib/portoes.js'

let falhas = 0
const ok = (nome, cond, extra = '') => {
  console.log((cond ? '  OK   ' : '  FALHA') + ' ' + nome + (cond ? '' : ' → ' + extra))
  if (!cond) falhas++
}
const POLIMATA = '48948776000164'

// ── 1. TITULARIDADE ───────────────────────────────────────────────────────
// O contrato de locação do cliente, encaminhado como material de trabalho.
const doTerceiro = portoesDeEntrada({
  parsed: {
    emitente_nome: 'Imobiliária Santos', emitente_cnpj: '11.222.333/0001-44',
    destinatario_nome: 'Cliente da consultoria', destinatario_cnpj: '55.666.777/0001-88',
  },
  cnpjEmpresa: POLIMATA,
})
ok('documento entre dois terceiros não passa', !doTerceiro.aprovado)
ok('e o motivo nomeia as duas partes',
  doTerceiro.falhas[0].motivo === 'documento_de_terceiro'
  && doTerceiro.falhas[0].explicacao.includes('Imobiliária Santos'),
  resumoDasFalhas(doTerceiro.falhas))

// A nota de um fornecedor contra a Polímata: ela é o destinatário.
const contraEla = portoesDeEntrada({
  parsed: {
    emitente_nome: 'Fornecedor', emitente_cnpj: '11222333000144',
    destinatario_nome: 'Polímata', destinatario_cnpj: POLIMATA,
    papel_documento: 'documento_fiscal',
  },
  cnpjEmpresa: POLIMATA,
})
ok('a nota de um fornecedor contra ela passa', contraEla.aprovado, resumoDasFalhas(contraEla.falhas))

// A nota que ela emitiu: ela é a emitente.
const dela = portoesDeEntrada({
  parsed: { emitente_cnpj: POLIMATA, destinatario_cnpj: '11222333000144', papel_documento: 'documento_fiscal' },
  cnpjEmpresa: POLIMATA,
})
ok('a nota emitida por ela passa', dela.aprovado, resumoDasFalhas(dela.falhas))

// O relatório sem nenhuma das partes — os R$ 138 milhões do ACR.
const semPartes = portoesDeEntrada({ parsed: { valor_total: 138143664 }, cnpjEmpresa: POLIMATA })
ok('relatório sem nenhuma das partes não passa', !semPartes.aprovado)
ok('e o motivo é "não dá para provar que é meu", não "não existe"',
  semPartes.falhas[0].motivo === 'titularidade_nao_comprovada', resumoDasFalhas(semPartes.falhas))

// Sem o CNPJ da empresa configurado, ninguém é reprovado por titularidade.
const semConfig = portoesDeEntrada({
  parsed: { emitente_cnpj: '11222333000144', papel_documento: 'documento_fiscal' },
  cnpjEmpresa: '',
})
ok('sem CNPJ da empresa configurado, o portão não acusa o documento', semConfig.aprovado,
  resumoDasFalhas(semConfig.falhas))

// ── 2. PAPEL ──────────────────────────────────────────────────────────────
// O recibo da DCTFWeb: traz o valor do DARF impresso dentro.
const recibo = portoesDeEntrada({
  parsed: { destinatario_cnpj: POLIMATA, papel_documento: 'comprovante', valor_total: 932.31 },
  cnpjEmpresa: POLIMATA,
})
ok('o comprovante de entrega não passa', !recibo.aprovado)
ok('e o motivo diz que o valor é de outro documento',
  recibo.falhas[0].motivo === 'nao_e_desembolso'
  && recibo.falhas[0].explicacao.includes('outro documento'), resumoDasFalhas(recibo.falhas))

for (const papel of ['base_de_calculo', 'declaracao', 'contrato']) {
  const r = portoesDeEntrada({ parsed: { destinatario_cnpj: POLIMATA, papel_documento: papel }, cnpjEmpresa: POLIMATA })
  ok(`${papel} não passa`, !r.aprovado, resumoDasFalhas(r.falhas))
}
for (const papel of ['obrigacao', 'documento_fiscal', 'pagamento_pf']) {
  const r = portoesDeEntrada({ parsed: { destinatario_cnpj: POLIMATA, papel_documento: papel }, cnpjEmpresa: POLIMATA })
  ok(`${papel} passa`, r.aprovado, resumoDasFalhas(r.falhas))
}
// Papel não reconhecido não reprova: vale a IA, como sempre valeu.
const semPapel = portoesDeEntrada({ parsed: { destinatario_cnpj: POLIMATA }, cnpjEmpresa: POLIMATA })
ok('papel não reconhecido não reprova', semPapel.aprovado, resumoDasFalhas(semPapel.falhas))

// ── 3. RECEITA ────────────────────────────────────────────────────────────
const inexistente = portoesDeEntrada({
  parsed: { destinatario_cnpj: POLIMATA, emitente_cnpj: '11111111111111', papel_documento: 'documento_fiscal' },
  cnpjEmpresa: POLIMATA,
  receita: { estado: 'inexistente', cnpj: '11111111111111' },
})
ok('CNPJ que a Receita não reconhece não passa', !inexistente.aprovado)
ok('e o motivo culpa a leitura, não ela',
  inexistente.falhas[0].explicacao.includes('leitura'), resumoDasFalhas(inexistente.falhas))

// A diferença que mais importa: silêncio da Receita não é reprovação.
const mudo = portoesDeEntrada({
  parsed: { destinatario_cnpj: POLIMATA, emitente_cnpj: '11222333000144', papel_documento: 'documento_fiscal' },
  cnpjEmpresa: POLIMATA,
  receita: { estado: 'nao_respondeu' },
})
ok('Receita fora do ar NÃO reprova o documento', mudo.aprovado, resumoDasFalhas(mudo.falhas))

const confirmado = portoesDeEntrada({
  parsed: { destinatario_cnpj: POLIMATA, emitente_cnpj: '11222333000144', papel_documento: 'documento_fiscal' },
  cnpjEmpresa: POLIMATA,
  receita: { estado: 'confirmado', razao_social: 'FORNECEDOR LTDA' },
})
ok('CNPJ confirmado passa', confirmado.aprovado, resumoDasFalhas(confirmado.falhas))

// ── OS TRÊS JUNTOS ────────────────────────────────────────────────────────
const tudoErrado = portoesDeEntrada({
  parsed: {
    emitente_nome: 'Outra empresa', emitente_cnpj: '11111111111111',
    destinatario_nome: 'Cliente', destinatario_cnpj: '22222222222222',
    papel_documento: 'contrato',
  },
  cnpjEmpresa: POLIMATA,
  receita: { estado: 'inexistente', cnpj: '11111111111111' },
})
ok('as três falhas são relatadas, e não só a primeira', tudoErrado.falhas.length === 3,
  String(tudoErrado.falhas.length))
ok('o resumo sai em uma linha legível, e o separador não aparece dentro das frases',
  resumoDasFalhas(tudoErrado.falhas).split(' · ').length === 3,
  resumoDasFalhas(tudoErrado.falhas))

console.log(falhas ? `\n${falhas} falha(s).` : '\nTodos os casos passaram.')
process.exit(falhas ? 1 : 0)
