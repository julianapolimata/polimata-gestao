// =============================================================================
// VARREDURA DE EXPRESSÕES REGULARES COM A BARRA INVERTIDA PERDIDA.
//
// Este defeito já entrou em produção três vezes neste projeto, sempre do mesmo
// jeito: um script de edição passou por um shell que comeu a barra invertida, e
// `\d` virou `d`, `\D` virou `D`, `\s` virou `s`.
//
// O estrago é silencioso. `replace(/D/g, '')` não dá erro: ele remove a letra
// D e devolve um texto que PARECE certo. Foi assim que o CNPJ da parte foi
// para o lançamento com pontuação — e deixou de casar com o cadastro.
//
// O que se procura: dentro de um literal de expressão regular, uma letra de
// classe (d, D, s, S, w, W, b, B) isolada, sem a barra que a torna classe.
// Isolada quer dizer: não é parte de uma palavra de verdade.
//
// Rodar: node scripts/varredura-regex.cjs
// =============================================================================
const fs = require('fs');
const path = require('path');

const RAIZ = process.argv[2] || 'src';
const CLASSES = 'dDsSwWbB';

// O literal só conta quando está num lugar onde SÓ pode ser expressão regular:
// argumento de um método de string, do construtor, ou do lado direito de uma
// atribuição. Sem essa âncora, a barra que fecha uma tag JSX e o atributo
// d="..." de um ícone SVG entram como suspeitos e afogam o resultado em ruído.
const ANCORA = String.raw`(?:\.(?:replace|replaceAll|match|matchAll|test|exec|split|search)\s*\(\s*|RegExp\s*\(\s*|=\s*|\(\s*)`;
const CORPO = String.raw`\/((?:\\.|\[(?:\\.|[^\]])*\]|[^/\\\n])+)\/[gimsuyd]*`;
const RE_LITERAL = new RegExp(ANCORA + CORPO, 'g');

const suspeitos = [];

function olhar(arquivo, linha, numero) {
  let m;
  RE_LITERAL.lastIndex = 0;
  while ((m = RE_LITERAL.exec(linha))) {
    const corpo = m[1];
    // Remove o que é legítimo antes de procurar: os escapes e as classes de
    // caractere. Dentro de `[^s]` a letra s é literal, e acusá-la é ruído —
    // foi o único "achado" da primeira versão deste script.
    const semEscapes = corpo
      .replace(/\\./g, '\u0000')
      .replace(/\[[^\]]*\]/g, '\u0000');
    for (const c of CLASSES) {
      // A letra sozinha, cercada por algo que não é letra nem dígito.
      const solta = new RegExp(`(^|[^A-Za-z0-9\\u0000])${c}($|[^A-Za-z0-9\\u0000])`);
      if (!solta.test(semEscapes)) continue;
      // `b` e `s` aparecem legitimamente em muitos padrões de texto; só
      // acusamos quando o padrão inteiro é curto, que é o caso dos comidos.
      if ((c === 'b' || c === 'B') && corpo.length > 6) continue;
      suspeitos.push({ arquivo, numero, classe: c, trecho: m[0].slice(0, 70), linha: linha.trim().slice(0, 120) });
      break;
    }
  }
}

function anda(dir) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) { anda(p); continue; }
    if (!/\.(jsx?|mjs|cjs|ts)$/.test(f.name)) continue;
    fs.readFileSync(p, 'utf8').split('\n').forEach((linha, i) => {
      if (/^\s*(\/\/|\*)/.test(linha)) return;      // comentário
      olhar(p.replace(/\\/g, '/'), linha, i + 1);
    });
  }
}

for (const raiz of RAIZ.split(',')) {
  if (fs.existsSync(raiz)) anda(raiz);
}

if (!suspeitos.length) {
  console.log('Nenhuma expressão regular suspeita.');
} else {
  console.log(`${suspeitos.length} expressão(ões) a conferir:\n`);
  for (const s of suspeitos) {
    console.log(`${s.arquivo}:${s.numero}  classe "${s.classe}" solta em  ${s.trecho}`);
    console.log(`    ${s.linha}\n`);
  }
}
process.exit(suspeitos.length ? 1 : 0);
