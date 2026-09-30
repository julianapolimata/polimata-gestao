// ===========================================================================
// PROVA: leitura de XML fiscal sem IA (REGRAS.md, regra 9 — primeira linha).
//
// Ler o XML por conta própria é exato e de graça; mandar para a IA custa. Mas
// o risco aqui não é o custo: é ler ERRADO com ar de certeza. O leitor já teve
// um bug sutil de roteamento — `<InfNfse>` do ABRASF e `<infNFSe>` do padrão
// nacional são a mesma coisa quando se ignora maiúsculas, e um leitor caía em
// cima do outro. Esta prova fixa isso e o resto das decisões perigosas.
//
// A regra de ouro do módulo: na dúvida, devolver null e deixar a IA ler. Um
// lançamento errado é pior que um centavo gasto.
//
// Rodar: npm run provas
// ===========================================================================
import { lerXmlFiscal, notaCanceladaNoXml } from '../lib/xmlFiscal.js'

const EMPRESA = '12345678000190'
const CLIENTE = '99888777000166'

let falhas = 0
const ok = (nome, cond, extra = '') => {
  console.log((cond ? '  OK   ' : '  FALHA') + ' ' + nome + (cond ? '' : ' → ' + extra))
  if (!cond) falhas++
}

// ── Fixtures com a estrutura real de cada layout ───────────────────────────

// ABRASF: o mais comum entre as prefeituras. Repare no <InfNfse> maiúsculo.
const abrasf = ({ prestador = EMPRESA, tomador = CLIENTE, servicos = '15000.00', liquido = '14250.00' } = {}) => `<?xml version="1.0" encoding="UTF-8"?>
<ConsultarNfseResposta><ListaNfse><CompNfse><Nfse><InfNfse>
  <Numero>44</Numero>
  <DataEmissao>2025-11-03T10:22:00</DataEmissao>
  <ValoresNfse><ValorLiquidoNfse>${liquido}</ValorLiquidoNfse></ValoresNfse>
  <PrestadorServico>
    <IdentificacaoPrestador><CpfCnpj><Cnpj>${prestador}</Cnpj></CpfCnpj></IdentificacaoPrestador>
    <RazaoSocial>POLIMATA CONSULTORIA EM GRC LTDA</RazaoSocial>
  </PrestadorServico>
  <TomadorServico>
    <IdentificacaoTomador><CpfCnpj><Cnpj>${tomador}</Cnpj></CpfCnpj></IdentificacaoTomador>
    <RazaoSocial>BRASCABOS COMPONENTES ELETRICOS</RazaoSocial>
  </TomadorServico>
  <DeclaracaoPrestacaoServico><InfDeclaracaoPrestacaoServico><Servico>
    <Valores><ValorServicos>${servicos}</ValorServicos></Valores>
    <Discriminacao>Prestacao de servico de consultoria em Controles Internos.</Discriminacao>
  </Servico></InfDeclaracaoPrestacaoServico></DeclaracaoPrestacaoServico>
</InfNfse></Nfse></CompNfse></ListaNfse></ConsultarNfseResposta>`

// Padrão Nacional: nomes curtos, <infNFSe> minúsculo e <nNFSe>.
const nacional = `<?xml version="1.0" encoding="UTF-8"?>
<NFSe><infNFSe Id="NFS123">
  <nNFSe>70</nNFSe>
  <dhProc>2026-09-18T09:00:00-03:00</dhProc>
  <emit><CNPJ>${EMPRESA}</CNPJ><xNome>POLIMATA CONSULTORIA EM GRC LTDA</xNome></emit>
  <toma><CNPJ>${CLIENTE}</CNPJ><xNome>BRASCABOS COMPONENTES ELETRICOS</xNome></toma>
  <valores><vServPrest>7132.00</vServPrest></valores>
  <serv><xDescServ>Prestacao de servicos de Controles Internos, referente a julho/2026.</xDescServ></serv>
</infNFSe></NFSe>`

// SIGISS (Valinhos e outras): tudo em português, valor em reais, data dd/mm.
const sigiss = `<?xml version="1.0" encoding="ISO-8859-1"?>
<retorno><notafiscal>
  <numero_nf>56</numero_nf>
  <data_emissao>04/05/2026</data_emissao>
  <valor_servico>R$ 5.867,40</valor_servico>
  <cnpj_cpf_prestador>${EMPRESA}</cnpj_cpf_prestador>
  <razao_social_prestador></razao_social_prestador>
  <cnpj_cpf_destinatario>${CLIENTE}</cnpj_cpf_destinatario>
  <razao_social_destinatario>BRASCABOS COMPONENTES ELETRICOS</razao_social_destinatario>
  <descricao>Prestacao de servicos de Controles Internos - abr/2026</descricao>
</notafiscal></retorno>`

// NF-e modelo 55 (mercadoria), com duplicata.
const nfe = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc><NFe><infNFe Id="NFe35260...">
  <ide><nNF>19862722</nNF><dhEmi>2026-01-24T08:00:00-03:00</dhEmi></ide>
  <emit><CNPJ>${CLIENTE}</CNPJ><xNome>LUCID SOFTWARE INC</xNome></emit>
  <dest><CNPJ>${EMPRESA}</CNPJ><xNome>POLIMATA CONSULTORIA EM GRC LTDA</xNome></dest>
  <det><prod><xProd>Licenca anual de software</xProd></prod></det>
  <total><ICMSTot><vNF>190.36</vNF></ICMSTot></total>
  <cobr><dup><dVenc>2026-02-22</dVenc></dup></cobr>
</infNFe></NFe></nfeProc>`

// ── 1. A colisão de layout que já deu bug ──────────────────────────────────
// Se o roteamento voltar a olhar <infNFSe> ignorando maiúsculas, o ABRASF cai
// no leitor nacional, não acha campo nenhum e o XML vira null — a nota some do
// caminho barato e volta a custar IA. Ou pior: lê pela metade.
{
  const r = lerXmlFiscal(abrasf(), { cnpjEmpresa: EMPRESA })
  ok('ABRASF (<InfNfse>) é lido como ABRASF', r !== null, 'voltou null — roteamento trocado?')
  ok('número certo', r?.numero_nf === '44', r?.numero_nf)
  ok('data certa', r?.data_emissao === '2025-11-03', r?.data_emissao)
  ok('emitente é a empresa → é receita', r?.tipo === 'saida', r?.tipo)

  const n = lerXmlFiscal(nacional, { cnpjEmpresa: EMPRESA })
  ok('Padrão Nacional (<nNFSe>) é lido como nacional', n !== null && n.numero_nf === '70', JSON.stringify(n))
  ok('e pega o valor do serviço prestado', n?.valor_total === 7132, String(n?.valor_total))
}

// ── 2. Retenção não pode virar desconto no valor ───────────────────────────
// O valor da nota é o dos SERVIÇOS. O líquido é o que sobrou depois das
// retenções — usá-lo encolheria a receita declarada.
{
  const r = lerXmlFiscal(abrasf({ servicos: '15000.00', liquido: '14250.00' }), { cnpjEmpresa: EMPRESA })
  ok('valor é o dos serviços, não o líquido', r?.valor_total === 15000, String(r?.valor_total))
}

// ── 3. SIGISS: reais com R$ e ponto de milhar, data dd/mm/aaaa ─────────────
{
  const r = lerXmlFiscal(sigiss, { cnpjEmpresa: EMPRESA })
  ok('SIGISS é lido', r !== null, 'voltou null')
  ok('"R$ 5.867,40" vira 5867.4', r?.valor_total === 5867.4, String(r?.valor_total))
  ok('"04/05/2026" vira 2026-05-04', r?.data_emissao === '2026-05-04', r?.data_emissao)
  ok('sem razão social do prestador, quem nomeia é o destinatário',
    r?.parte === 'BRASCABOS COMPONENTES ELETRICOS', r?.parte)
}

// ── 4. NF-e 55 ─────────────────────────────────────────────────────────────
{
  const r = lerXmlFiscal(nfe, { cnpjEmpresa: EMPRESA })
  ok('NF-e é lida', r !== null, 'voltou null')
  ok('é despesa (a empresa é a destinatária)', r?.tipo === 'entrada', r?.tipo)
  ok('tipo do documento é NF-e', r?.tipo_documento === 'NF-e', r?.tipo_documento)
  ok('valor total da nota', r?.valor_total === 190.36, String(r?.valor_total))
  ok('vencimento vem da duplicata', r?.data_vencimento === '2026-02-22', r?.data_vencimento)
}

// ── 5. A direção sai do CNPJ, nunca de palpite ─────────────────────────────
{
  const entrada = lerXmlFiscal(abrasf({ prestador: CLIENTE, tomador: EMPRESA }), { cnpjEmpresa: EMPRESA })
  ok('empresa como tomadora → despesa', entrada?.tipo === 'entrada', entrada?.tipo)
  ok('e a parte é quem emitiu', entrada?.parte === 'POLIMATA CONSULTORIA EM GRC LTDA', entrada?.parte)

  const alheia = lerXmlFiscal(abrasf({ prestador: CLIENTE, tomador: '11111111000111' }), { cnpjEmpresa: EMPRESA })
  ok('XML que não é da empresa → null (quem decide é a IA)', alheia === null, JSON.stringify(alheia))

  ok('sem CNPJ da empresa configurado → null', lerXmlFiscal(abrasf(), {}) === null)
}

// ── 6. Na dúvida, devolver null ────────────────────────────────────────────
{
  ok('texto que não é XML → null', lerXmlFiscal('isto nao e xml', { cnpjEmpresa: EMPRESA }) === null)
  ok('vazio → null', lerXmlFiscal('', { cnpjEmpresa: EMPRESA }) === null)
  ok('XML de layout desconhecido → null',
    lerXmlFiscal('<recibo><valor>10</valor></recibo>', { cnpjEmpresa: EMPRESA }) === null)

  const semValor = abrasf({ servicos: '0', liquido: '0' })
  ok('sem valor → null (vai para a IA)', lerXmlFiscal(semValor, { cnpjEmpresa: EMPRESA }) === null)

  const semNumero = abrasf().replace('<Numero>44</Numero>', '')
  ok('sem número da nota → null', lerXmlFiscal(semNumero, { cnpjEmpresa: EMPRESA }) === null)

  const semData = abrasf().replace('<DataEmissao>2025-11-03T10:22:00</DataEmissao>', '')
  ok('sem data de emissão → null', lerXmlFiscal(semData, { cnpjEmpresa: EMPRESA }) === null)
}

// ── 7. Arquivo com VÁRIAS notas não é lido pela metade ─────────────────────
//
// Ler só a primeira faz as outras sumirem sem ninguém saber — e o total do mês
// continua fechando, porque ninguém sabe o que faltou.
//
// Isto JÁ FOI BUG: a trava só contava <notafiscal> (SIGISS). Um lote ABRASF —
// que é exatamente o que a consulta por período devolve, um <ListaNfse> com
// vários <CompNfse> — entrava como UMA nota, a primeira. Num lote de
// R$ 1.000 + R$ 2.000 + R$ 3.000, entravam R$ 1.000 e sumiam R$ 5.000.
{
  const sigissDuplo = sigiss.replace('</retorno>',
    sigiss.replace(/<\?xml[^>]*\?>/, '').replace('<retorno>', '').replace('</retorno>', '') + '</retorno>')
  ok('SIGISS com duas notas → null', lerXmlFiscal(sigissDuplo, { cnpjEmpresa: EMPRESA }) === null,
    JSON.stringify(lerXmlFiscal(sigissDuplo, { cnpjEmpresa: EMPRESA })))

  const comp = (num, valor) => abrasf()
    .replace(/<\?xml[^>]*\?>\n?/, '')
    .replace('<ConsultarNfseResposta><ListaNfse>', '')
    .replace('</ListaNfse></ConsultarNfseResposta>', '')
    .replace('<Numero>44</Numero>', '<Numero>' + num + '</Numero>')
    .replace('<ValorServicos>15000.00</ValorServicos>', '<ValorServicos>' + valor + '</ValorServicos>')
  const loteAbrasf = '<?xml version="1.0"?><ConsultarNfseResposta><ListaNfse>' +
    comp(1, '1000.00') + comp(2, '2000.00') + comp(3, '3000.00') +
    '</ListaNfse></ConsultarNfseResposta>'
  const lido = lerXmlFiscal(loteAbrasf, { cnpjEmpresa: EMPRESA })
  ok('lote ABRASF com três notas → null (não grava só a primeira)', lido === null,
    'gravou ' + JSON.stringify(lido && { numero: lido.numero_nf, valor: lido.valor_total }))

  const nac = n => nacional
    .replace(/<\?xml[^>]*\?>\n?/, '')
    .replace('<nNFSe>70</nNFSe>', '<nNFSe>' + n + '</nNFSe>')
    .replace('<vServPrest>7132.00</vServPrest>', '<vServPrest>' + n + '000.00</vServPrest>')
  const loteNacional = '<lote>' + nac(1) + nac(2) + '</lote>'
  const lidoNac = lerXmlFiscal(loteNacional, { cnpjEmpresa: EMPRESA })
  ok('lote do Padrão Nacional com duas notas → null', lidoNac === null,
    'gravou ' + JSON.stringify(lidoNac && { numero: lidoNac.numero_nf, valor: lidoNac.valor_total }))

  // E o contrário: nota única continua sendo lida (a trava não pode pegar sã).
  ok('nota ABRASF única continua sendo lida', lerXmlFiscal(abrasf(), { cnpjEmpresa: EMPRESA }) !== null)
  ok('nota nacional única continua sendo lida', lerXmlFiscal(nacional, { cnpjEmpresa: EMPRESA }) !== null)
  ok('NF-e única continua sendo lida', lerXmlFiscal(nfe, { cnpjEmpresa: EMPRESA }) !== null)
}

// ── 8. Nota cancelada não pode virar lançamento ────────────────────────────
// A consequência é oposta à do "não consegui ler": desistir aqui faria a IA
// ler e criar um recebível que não existe mais.
{
  ok('bloco de cancelamento vazio = nota válida',
    notaCanceladaNoXml(abrasf().replace('</InfNfse>', '<CancelamentoNfse /></InfNfse>')) === false)
  ok('bloco de cancelamento preenchido = cancelada',
    notaCanceladaNoXml(abrasf().replace('</InfNfse>',
      '<CancelamentoNfse><Confirmacao><Pedido><CodigoCancelamento>2</CodigoCancelamento></Pedido></Confirmacao></CancelamentoNfse></InfNfse>')) === true)
  ok('SIGISS com <cancelada>S</cancelada> = cancelada',
    notaCanceladaNoXml(sigiss.replace('</notafiscal>', '<cancelada>S</cancelada></notafiscal>')) === true)
  ok('SIGISS com <cancelada>N</cancelada> = válida',
    notaCanceladaNoXml(sigiss.replace('</notafiscal>', '<cancelada>N</cancelada></notafiscal>')) === false)
  ok('nota normal não é cancelada', notaCanceladaNoXml(abrasf()) === false)
  ok('texto sem XML não é cancelamento', notaCanceladaNoXml('qualquer coisa') === false)
}

// ── 9. Namespace com prefixo (a prefeitura escolhe o dela) ─────────────────
{
  const comNs = abrasf().replace(/<(\/?)(InfNfse|PrestadorServico|TomadorServico)([\s>])/g, '<$1ns2:$2$3')
  const r = lerXmlFiscal(comNs, { cnpjEmpresa: EMPRESA })
  ok('prefixo de namespace não atrapalha', r !== null && r.numero_nf === '44', JSON.stringify(r))
}

// ── 10. XML de nota nunca é guia de imposto ────────────────────────────────
{
  const r = lerXmlFiscal(abrasf(), { cnpjEmpresa: EMPRESA })
  ok('sem período de apuração', r?.periodo_apuracao === '', JSON.stringify(r?.periodo_apuracao))
  ok('sem número de documento de arrecadação', r?.numero_documento === '')
  ok('moeda é sempre real', r?.moeda === 'BRL')
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTodos os casos passaram.')
process.exit(falhas ? 1 : 0)
