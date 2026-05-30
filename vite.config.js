import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

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
  plugins: [react()],
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
