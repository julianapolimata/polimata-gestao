// ===========================================================================
// PROVA: "o que você já dispensou uma vez, o sistema para de perguntar"
// — e as quatro condições que impedem isso de virar um buraco.
//
// Pedido da Juliana (06/10), diante de três documentos do eSocial: "preciso
// que o sistema lembre disso e não traga esses arquivos novamente".
//
// O risco desta regra é o oposto do risco das outras: aqui o erro é fazer um
// documento DESAPARECER. Por isso metade das provas abaixo é sobre o que ela
// NÃO pode dispensar.
//
// Rodar: npm run provas
// ===========================================================================
import { construirRegrasDeDispensa, dispensaPara, chaveDeDispensa, dominioDe } from '../lib/regrasDocumento.js'

let falhas = 0
const ok = (nome, cond, extra = '') => {
  console.log((cond ? '  OK   ' : '  FALHA') + ' ' + nome + (cond ? '' : ' → ' + extra))
  if (!cond) falhas++
}

const CONTADOR = 'seu-contador <seu-contador@gclick.com.br>'
const doc = (extra = {}) => ({
  tipo_documento: 'Comprovante', papel_documento: 'comprovante',
  email_de: CONTADOR, fileName: '1201 - RECIBO DCTFWEB - 04 2026.pdf', ...extra,
})
const linha = (status, d) => ({ status, data: d })

// ── O caso dela ──────────────────────────────────────────────────────────
const historico = [linha('rejeitado', doc())]
const regras = construirRegrasDeDispensa(historico)
ok('um recibo da DCTFWeb rejeitado cria a regra', regras.size === 1)

const proximoMes = doc({ fileName: '1201 - RECIBO DCTFWEB - 05 2026.pdf' })
const d1 = dispensaPara(proximoMes, regras)
ok('o do mês seguinte cai na regra', !!d1, JSON.stringify(d1))
ok('e o motivo diz o porquê, em português',
  !!d1 && d1.motivo.includes('você já rejeitou') && d1.motivo.includes('gclick.com.br'), d1?.motivo)
ok('o motivo diz como desfazer',
  !!d1 && d1.motivo.includes('devolva para reanálise'))

// ── Condição 1: a regra não se alimenta de si mesma ──────────────────────
//
// Sem isto, um engano vira doutrina: o primeiro arquivamento automático
// confirmaria o segundo, que confirmaria o terceiro, e nunca mais sairia.
const soAutomaticos = construirRegrasDeDispensa([
  linha('rejeitado', doc({ rejeitado_por: 'regra' })),
  linha('rejeitado', doc({ rejeitado_por: 'regra' })),
])
ok('arquivado pela própria regra NÃO ensina nada', soAutomaticos.size === 0)

// ── Condição 2: unanimidade ──────────────────────────────────────────────
const divergente = construirRegrasDeDispensa([
  linha('rejeitado', doc()),
  linha('aprovado', doc({ fileName: 'outro.pdf' })),
])
ok('rejeitou uma vez e aprovou outra → não há regra', divergente.size === 0)
ok('e por isso o documento continua chegando na fila',
  dispensaPara(proximoMes, divergente) === null)

// ── Condição 4: só vale para PROVA ───────────────────────────────────────
//
// A metade que importa mais. Uma guia rejeitada foi rejeitada por algo DAQUELE
// documento — valor errado, duplicata, não era dela. Generalizar faria o
// sistema parar de trazer uma conta a pagar de verdade. Dobro se enxerga no
// extrato; falta não se enxerga em lugar nenhum.
for (const [papel, tipo] of [['obrigacao', 'DAS'], ['documento_fiscal', 'NFS-e'], ['pagamento_pf', 'Pró-labore']]) {
  const r = construirRegrasDeDispensa([linha('rejeitado', doc({ papel_documento: papel, tipo_documento: tipo }))])
  ok(`rejeitar um(a) ${tipo} NÃO cria regra (vira lançamento)`, r.size === 0)
}
for (const papel of ['comprovante', 'base_de_calculo', 'declaracao', 'contrato']) {
  const r = construirRegrasDeDispensa([linha('rejeitado', doc({ papel_documento: papel }))])
  ok(`rejeitar um(a) ${papel} cria regra (é prova)`, r.size === 1)
}

// ── A chave distingue remetente e tipo ───────────────────────────────────
//
// Dispensar o recibo do SEU contador não pode dispensar o recibo de outro
// escritório, nem um documento de outro tipo do mesmo remetente.
const regraDoContador = construirRegrasDeDispensa([linha('rejeitado', doc())])
ok('outro remetente não cai na regra',
  dispensaPara(doc({ email_de: 'x@outroescritorio.com.br' }), regraDoContador) === null)
ok('outro tipo do mesmo remetente também não',
  dispensaPara(doc({ tipo_documento: 'Folha' }), regraDoContador) === null)
ok('o mesmo tipo, com nome de arquivo diferente, cai',
  !!dispensaPara(doc({ fileName: 'qualquer-outro-nome.pdf' }), regraDoContador))

// ── Sem papel ou sem remetente não há chave ──────────────────────────────
//
// Documento que o reconhecedor não decidiu continua indo para a fila. Melhor
// perguntar à toa do que arquivar no escuro.
ok('documento sem papel não gera chave', chaveDeDispensa(doc({ papel_documento: null })) === null)
ok('documento sem remetente não gera chave', chaveDeDispensa(doc({ email_de: '' })) === null)
ok('histórico vazio não cria regra nenhuma', construirRegrasDeDispensa([]).size === 0)
ok('e sem regra, nada é dispensado', dispensaPara(doc(), new Map()) === null)

// ── O domínio, extraído de cabeçalhos de e-mail de verdade ───────────────
ok('extrai domínio de "Nome <x@y.com>"', dominioDe('Contador <a@gclick.com.br>') === 'gclick.com.br')
ok('extrai de endereço solto', dominioDe('a@gclick.com.br') === 'gclick.com.br')
ok('maiúsculas não mudam', dominioDe('A@GClick.COM.BR') === 'gclick.com.br')
ok('vazio devolve vazio', dominioDe('') === '' && dominioDe(null) === '')

console.log(falhas ? `\n${falhas} falha(s).` : '\n  todas passaram.')
process.exit(falhas ? 1 : 0)
