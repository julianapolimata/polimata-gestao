// ===========================================================================
// Rodador das provas. O projeto não tem framework de teste; estas provas são
// JS puro sobre as funções de regra, e o esbuild (que já vem com o Vite)
// resolve os imports sem extensão que o Node sozinho não resolve.
//
// Nova prova: crie provas/<nome>.mjs, saia com código 1 se algo falhar.
// ===========================================================================
import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const aqui = dirname(fileURLToPath(import.meta.url))
const raiz = join(aqui, '..')
const arquivos = readdirSync(aqui).filter(f => f.endsWith('.mjs') && f !== 'rodar.mjs').sort()

let falhou = 0
for (const f of arquivos) {
  console.log(`
── ${f} ${'─'.repeat(Math.max(0, 60 - f.length))}`)
  const saida = join(raiz, 'node_modules', '.cache-provas', f)
  const bundle = spawnSync('npx', ['esbuild', join(aqui, f), '--bundle', '--platform=node', '--format=esm', `--outfile=${saida}`, '--log-level=error'], { cwd: raiz, stdio: 'inherit', shell: process.platform === 'win32' })
  if (bundle.status !== 0) { falhou++; continue }
  const run = spawnSync(process.execPath, [saida], { cwd: raiz, stdio: 'inherit' })
  if (run.status !== 0) falhou++
}
console.log(falhou ? `
${falhou} prova(s) falharam.` : `
${arquivos.length} prova(s), todas passaram.`)
process.exit(falhou ? 1 : 0)
