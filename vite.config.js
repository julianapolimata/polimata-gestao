import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Identificador único deste build. Vai (a) embutido no app (__BUILD_ID__) e
// (b) num /version.json servido estático. O app compara os dois de tempos em
// tempos: se diferirem, há deploy novo → aparece o aviso "Atualizar".
//
// Mesmo mecanismo que já roda no polimata-app (o sistema de CI) — a Juliana
// pediu para ter aqui depois de passar a tarde sem saber se estava vendo a
// versão nova ou a antiga. "Ainda não aparece" era, às vezes, a tela velha.
const BUILD_ID = String(Date.now())

// Após o switch arquitetural (PR pós-#22), o v2 React passa a ser servido
// na RAIZ do domínio. O sistema legado permanece em /legado.html como
// arquivo único.
//
// Fonte:
//   - static/         pasta com arquivos estáticos do legado (legado.html,
//                     favicons, v2-assets/) — copiada integralmente pra
//                     dist no build via `publicDir`
//   - src/            código React do v2
//
// Saída:
//   - public/         output do build (o que a Vercel publica) — inclui
//                     index.html do v2 React, assets/ versionados,
//                     e tudo de static/ replicado.
export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [
    react(),
    {
      name: 'polimata-version-json',
      writeBundle(options) {
        const dir = options.dir || 'public'
        writeFileSync(resolve(dir, 'version.json'), JSON.stringify({ buildId: BUILD_ID }))
      },
    },
  ],
  publicDir: 'static',
  base: '/',
  build: {
    outDir: 'public',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'supabase': ['@supabase/supabase-js'],
          'chart': ['chart.js'],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
})
