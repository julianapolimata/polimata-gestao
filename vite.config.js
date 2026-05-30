import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Convivência com o sistema legado:
// - public/index.html (legado) continua servido na raiz pela Vercel
// - Vite buildea para public/v2/ → servido em /v2/
// Quando todas as telas estiverem migradas, basta deletar public/index.html
// e mudar base pra '/'
export default defineConfig({
  plugins: [react()],
  publicDir: false, // não copia public/ pra dist (já estamos buildando pra dentro de public/v2)
  base: '/v2/',
  build: {
    outDir: 'public/v2',
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
