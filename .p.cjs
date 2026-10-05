const fs = require('fs')
const p = 'lib/peneiraPdf.js'
let s = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const rep = (a, b) => { if (s.split(a).length !== 2) throw new Error('ancora: ' + a.slice(0, 50)); s = s.replace(a, b) }

rep(`  const texto = partes.join('\n');
  return { texto, visivel: textoVisivel(texto), bytes: bruto.length, blocos, inflados, falhos };`,
`  const texto = partes.join('\n');
  // ── O QUE A PÁGINA MOSTRA ≠ O QUE ESTÁ NO ARQUIVO ────────────────────────
  //
  // O texto da página vive DENTRO dos blocos comprimidos. O arquivo cru em
  // volta deles é cabeçalho, dicionários e os próprios bytes comprimidos — e
  // num PDF de 14 mil bytes isso é a maior parte, vindo toda ANTES do
  // conteúdo.
  //
  // Juntar os dois custou caro duas vezes, nos dois sentidos possíveis:
  //
  //   • falso positivo — "DARF" e "GNRE" casaram dentro do ruído binário e
  //     dois contratos de aluguel viraram guia de imposto;
  //   • falso negativo — a amostra de diagnóstico, tirada do começo, só
  //     mostrava lixo e nomes de glifo da fonte ("five hyphen oacute one"),
  //     escondendo que o texto da página estava lá, mais adiante.
  //
  // Então 'visivel' passa a ser só o conteúdo dos blocos abertos. O arquivo
  // cru entra apenas quando nenhum bloco abriu — aí ele é tudo que existe, e
  // é onde mora o texto dos PDFs que não comprimem nada (as notas da
  // prefeitura de Barueri são assim).
  const conteudo = inflados > 0 ? partes.slice(1).join('\n') : bruto;
  return { texto, visivel: textoVisivel(conteudo), bytes: bruto.length, blocos, inflados, falhos };`)
fs.writeFileSync(p, s)
console.log('ok')
