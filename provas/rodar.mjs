// ===========================================================================
// Rodador das provas. O projeto não tem framework de teste; estas provas são
// JS puro sobre as funções de regra.
//
// O esbuild (que já vem com o Vite) resolve os imports sem extensão que o Node
// sozinho não resolve. Usamos a API dele, e não a linha de comando: no Windows
// o shell come as aspas dos parâmetros e o `define` chega quebrado.
//
// Nova prova: crie provas/<nome>.mjs e saia com código 1 se algo falhar.
// ===========================================================================
import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const aqui = dirname(fileURLToPath(import.meta.url))
const raiz = join(aqui, '..')
const arquivos = readdirSync(aqui).filter(f => f.endsWith('.mjs') && f !== 'rodar.mjs').sort()

// As libs de regra são puras, mas algumas importam um vizinho que cria o
// cliente do Supabase a partir de import.meta.env — que só existe no Vite.
// Damos valores de faz-de-conta: o cliente é construído e nunca usado, porque
// prova não fala com banco.
const ENV_FALSO = {
  'import.meta.env': JSON.stringify({
    VITE_SUPABASE_URL: 'http://localhost:0',
    VITE_SUPABASE_PUBLISHABLE_KEY: 'prova',
  }),
}

let falhou = 0
for (const f of arquivos) {
  console.log(`\n── ${f} ${'─'.repeat(Math.max(0, 60 - f.length))}`)
  const saida = join(raiz, 'node_modules', '.cache-provas', f)
  try {
    await build({
      entryPoints: [join(aqui, f)],
      outfile: saida,
      bundle: true,
      platform: 'node',
      format: 'esm',
      logLevel: 'error',
      define: ENV_FALSO,
    })
  } catch {
    falhou++
    continue
  }
  const run = spawnSync(process.execPath, [saida], { cwd: raiz, stdio: 'inherit' })
  if (run.status !== 0) falhou++
}

console.log(falhou ? `\n${falhou} prova(s) falharam.` : `\n${arquivos.length} prova(s), todas passaram.`)
process.exit(falhou ? 1 : 0)
