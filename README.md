# Polímata GRC — Sistema de Gestão

Sistema pessoal de gestão administrativa e financeira da Polímata. Em **migração progressiva** do single-file HTML para Vite + React modular.

## Estrutura atual (migração em andamento)

```
.
├── public/
│   ├── index.html              # 🟫 Sistema LEGADO (single-file, ainda em produção)
│   ├── favicon-32x32.png
│   └── v2/                     # 🟦 Build do Vite v2 (gitignored, gerado em deploy)
├── src/                        # 🟦 Código novo (Vite + React)
│   ├── pages/                  # Telas migradas
│   ├── components/             # Componentes reutilizáveis
│   ├── contexts/AuthContext.jsx
│   ├── lib/supabase.js
│   └── styles/global.css
├── api/
│   ├── anthropic.js            # Serverless — proxy para Anthropic API
│   └── email-cron.js           # Serverless — cron de processamento de emails
├── .github/workflows/ci.yml    # ESLint + build em PRs
├── eslint.config.js
├── vite.config.js
├── vercel.json
├── package.json
└── index.html                  # Entry do Vite (não confundir com public/index.html)
```

## Convivência durante a migração

- `polimata-gestao.vercel.app/` → 🟫 sistema legado (`public/index.html`)
- `polimata-gestao.vercel.app/v2/` → 🟦 sistema novo (React, em construção)

Quando todas as telas migrarem, deletamos `public/index.html` e o `vercel.json` redireciona `/` pra `/v2/`.

## Como rodar localmente

```bash
npm install
npm run dev          # roda Vite em http://localhost:5173 (versão v2)
npm run vercel-dev   # roda Vercel localmente (legado + v2)
npm run build        # build de produção (gera public/v2/)
npm run lint         # ESLint
```

Node 22+.

## Variáveis de ambiente

`.env.local` (não versionado) e Vercel Project Settings:

| Chave                          | Usado em                  | Escopo        |
|--------------------------------|---------------------------|---------------|
| `ANTHROPIC_API_KEY`            | `/api/anthropic.js`       | Server only   |
| `VITE_SUPABASE_URL`            | App v2 (bundle Vite)      | Frontend      |
| `VITE_SUPABASE_PUBLISHABLE_KEY`| App v2 (bundle Vite)      | Frontend      |

As chaves do Supabase no `index.html` legado continuam hard-coded.

## Stack

- **Frontend (v2):** Vite + React 18 + React Router 6
- **Frontend (legado):** HTML single-file vanilla
- **Backend:** Supabase Postgres + Auth + Storage
- **Hospedagem:** Vercel
- **CI:** GitHub Actions (ESLint + build em todo PR)
