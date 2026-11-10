// Varredura de linguagem conversacional no TEXTO QUE APARECE NA TELA.
//
// Os comentários do código ficam de fora de propósito: é lá que o raciocínio
// deve morar. O que se procura aqui é a voz de conversa na interface.
//
// O `\b` do JavaScript não funciona com acento (ê, ã), então todas as bordas
// são escritas à mão como "não-letra-portuguesa".
const fs = require('fs');
const path = require('path');

const RAIZ = process.argv[2] || 'src';
const L = 'a-zà-úA-ZÀ-Ú';
const borda = (p) => new RegExp(`(^|[^${L}])(${p})([^${L}]|$)`, 'i');

function semComentarios(txt) {
  const semBloco = txt.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
  return semBloco.split('\n').map(l => {
    const i = l.search(/(^|\s)\/\//);
    if (i < 0) return l;
    if (/:\/\//.test(l.slice(Math.max(0, i - 6), i + 3))) return l;
    return l.slice(0, i);
  }).join('\n');
}

const PADROES = [
  { re: borda('você|vocês'), nome: 'trata por "você"' },
  { re: borda('a gente'), nome: '"a gente"' },
  { re: borda('pra|pro'), nome: '"pra"/"pro" em vez de "para"' },
  { re: borda('tá|né|beleza|pô|ué'), nome: 'coloquialismo' },
  { re: /não se preocup|fique tranquil|sem problema|tudo certo|relaxa/i, nome: 'tranquilização' },
  { re: borda('vamos|bora'), nome: '"vamos" — o sistema não acompanha ninguém' },
  { re: borda('é só|basta|dá pra|deu certo'), nome: 'minimização' },
  { re: /e isso está certo|isso é normal|não tem problema|fica a seu critério/i, nome: 'justificativa falada' },
  { re: /mora aqui|fica aqui até|vive aqui/i, nome: 'dêixis' },
  { re: borda('ensina|aprende|entende|pensa|sabe|quer'), nome: 'antropomorfismo' },
  { re: /[a-zà-ú]!\s*(<|'|"|`|\))/, nome: 'exclamação' },
  { re: borda('merda|droga|zona|bagunça'), nome: 'desabafo' },
  // VOZ NARRATIVA. Acrescentado em 10/11/2026, depois de ela ler "Veio da
  // venda" num rótulo que eu havia escrito HORAS depois de duas correções
  // dela sobre exatamente isto. O sistema não conta a história do dado: ele
  // nomeia o que o campo é. "Proposta de origem", não "veio da venda".
  { re: borda('veio|vem|vieram|nasce|nasceu|nascem|virou|vira|viram'), nome: 'voz narrativa' },
];

// Textos candidatos de uma linha: strings literais e texto solto de JSX.
function textosDaLinha(linha) {
  const out = [];
  const reStr = /(['"`])((?:\\.|(?!\1)[^\\])*?)\1/g;
  let m;
  while ((m = reStr.exec(linha))) out.push(m[2]);
  // Texto entre > e < (JSX), e texto solto em linha de parágrafo.
  const reJsx = />([^<>{}]{6,})</g;
  while ((m = reJsx.exec(linha))) out.push(m[1]);
  const semTags = linha.replace(/<[^>]*>/g, ' ').replace(/\{[^}]*\}/g, ' ');
  // Linha que é texto corrido de JSX (sem código): 4+ palavras, sem = nem ;
  if (!/[=;{}()]/.test(semTags) && (semTags.match(new RegExp(`[${L}]{2,}`, 'g')) || []).length >= 4) {
    out.push(semTags);
  }
  return out.filter(t => (t.match(new RegExp(`[${L}]{2,}`, 'g')) || []).length >= 2);
}

const achados = [];
function anda(dir) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) { anda(p); continue; }
    if (!/\.(jsx?|mjs)$/.test(f.name)) continue;
    semComentarios(fs.readFileSync(p, 'utf8')).split('\n').forEach((linha, i) => {
      for (const texto of textosDaLinha(linha)) {
        for (const pad of PADROES) {
          if (!pad.re.test(texto)) continue;
          achados.push({
            arquivo: p.replace(/\\/g, '/'), linha: i + 1,
            padrao: pad.nome, texto: texto.trim().slice(0, 130),
          });
          return;
        }
      }
    });
  }
}
anda(RAIZ);

const porArquivo = new Map();
for (const a of achados) {
  if (!porArquivo.has(a.arquivo)) porArquivo.set(a.arquivo, []);
  porArquivo.get(a.arquivo).push(a);
}
const porPadrao = new Map();
for (const a of achados) porPadrao.set(a.padrao, (porPadrao.get(a.padrao) || 0) + 1);

console.log(`${achados.length} texto(s) em ${porArquivo.size} arquivo(s)\n`);
console.log('POR PADRÃO:');
for (const [p, n] of [...porPadrao].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${p}`);
console.log('');
for (const [arq, lista] of [...porArquivo].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`── ${arq} (${lista.length})`);
  for (const a of lista) console.log(`  ${String(a.linha).padStart(4)}  [${a.padrao}]  ${a.texto}`);
  console.log('');
}
