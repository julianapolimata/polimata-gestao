# Polímata GRC — Sistema de Gestão

Sistema pessoal de gestão administrativa e financeira da Polímata. UI em HTML único (`public/index.html`), persistência no Supabase, autenticação Supabase Auth, deploy na Vercel.

## Estrutura

```
.
├── public/
│   └── index.html        # App inteiro (UI + lógica cliente)
├── api/
│   └── anthropic.js      # Serverless — proxy seguro para Anthropic API
├── package.json
├── vercel.json
├── .gitignore
├── .env.example
└── README.md
```

## Variáveis de ambiente (Vercel)

Definir em **Vercel → Project → Settings → Environment Variables**:

| Chave                      | Onde                | Escopo        |
|----------------------------|---------------------|---------------|
| `ANTHROPIC_API_KEY`        | `/api/anthropic.js` | Server only   |

As chaves do Supabase (URL e publishable key) já estão no HTML — são seguras para o frontend porque o RLS protege os dados.

## Primeiro uso

1. Criar usuário no Supabase Auth: **Supabase Dashboard → Authentication → Users → Add user**.
2. Fazer login pela tela inicial do app com o email/senha criados.
3. Começar a cadastrar dados — cada registro fica isolado ao seu `user_id` via Row Level Security.

## Desenvolvimento local

```bash
npm install
npx vercel dev
```

Requer `ANTHROPIC_API_KEY` em `.env.local` (copiar de `.env.example`).

## Deploy

Conectado ao GitHub: cada push para `main` dispara deploy automático na Vercel.
