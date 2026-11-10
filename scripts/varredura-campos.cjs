// =============================================================================
// CAMPOS QUE O SISTEMA LÊ E NINGUÉM ESCREVE.
//
// O defeito que isto procura entrou em produção e ficou meses sem ser visto: a
// projeção de fluxo filtrava contratos por `rec_ativa`, um campo que havia sido
// retirado do formulário. A projeção lia algo que nenhuma tela preenchia, e o
// resultado era um número que nunca aparecia — sem erro, sem aviso, sem nada.
//
// Um campo lido e nunca escrito é sempre uma de três coisas:
//   • resto de uma função removida pela metade (o caso do `rec_ativa`);
//   • campo que vem de fora (do robô, de uma importação, do banco);
//   • leitura defensiva de dado antigo, que é legítima.
//
// O script não decide qual: ele lista para conferência humana.
//
// Rodar: node scripts/varredura-campos.cjs
// =============================================================================
const fs = require('fs');
const path = require('path');

const ALVOS = (process.argv[2] || 'src,api,lib').split(',');

// Leituras: d.campo, data?.campo, data->>'campo', data?.['campo']
const LEITURAS = [
  /\bdata\s*\?\.\s*([a-z_][a-z0-9_]*)/gi,
  /\bd\s*\?\.\s*([a-z_][a-z0-9_]*)/gi,
  /\bdata->>'([a-z_][a-z0-9_]*)'/gi,
  /\bdata->'([a-z_][a-z0-9_]*)'/gi,
  /:\s*data->>'([a-z_][a-z0-9_]*)'/gi,
];
// Escritas: campo: valor  (dentro de objeto), 'campo': valor, campo = ...
const ESCRITAS = [
  /\b([a-z_][a-z0-9_]*)\s*:/gi,
  /'([a-z_][a-z0-9_]*)'\s*:/gi,
  /jsonb_build_object\(([^)]*)\)/gi,
];

const lidos = new Map();   // campo -> [arquivo:linha]
const escritos = new Set();

function anda(dir) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) { anda(p); continue; }
    if (!/\.(jsx?|mjs|cjs|sql)$/.test(f.name)) continue;
    const texto = fs.readFileSync(p, 'utf8');
    const arquivo = p.replace(/\\/g, '/');

    texto.split('\n').forEach((linha, i) => {
      if (/^\s*(\/\/|\*|--)/.test(linha)) return;
      for (const re of LEITURAS) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(linha))) {
          const campo = m[1];
          if (!lidos.has(campo)) lidos.set(campo, []);
          if (lidos.get(campo).length < 3) lidos.get(campo).push(`${arquivo}:${i + 1}`);
        }
      }
      for (const re of ESCRITAS) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(linha))) {
          if (re.source.startsWith('jsonb')) {
            for (const chave of (m[1].match(/'([a-z_][a-z0-9_]*)'/gi) || [])) {
              escritos.add(chave.replace(/'/g, ''));
            }
          } else escritos.add(m[1]);
        }
      }
    });
  }
}

for (const a of ALVOS) if (fs.existsSync(a)) anda(a);

// Nomes que são da linguagem ou do React, não campos de dado.
const RUIDO = new Set([
  'then', 'catch', 'map', 'filter', 'find', 'length', 'data', 'error', 'id', 'toString',
  'slice', 'split', 'replace', 'trim', 'push', 'forEach', 'sort', 'reduce', 'includes',
  'style', 'className', 'key', 'ref', 'type', 'value', 'onChange', 'onClick', 'children',
]);

const orfaos = [...lidos.entries()]
  .filter(([campo]) => !escritos.has(campo) && !RUIDO.has(campo) && campo.length > 2)
  .sort((a, b) => a[0].localeCompare(b[0]));

if (!orfaos.length) {
  console.log('Nenhum campo lido sem escrita correspondente.');
} else {
  console.log(`${orfaos.length} campo(s) lidos e nunca escritos — conferir um a um:\n`);
  for (const [campo, onde] of orfaos) {
    console.log(`  ${campo.padEnd(28)} ${onde.join('  ')}`);
  }
}
