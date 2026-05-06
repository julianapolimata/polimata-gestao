// Serverless function (Vercel) — proxy seguro para a API da Anthropic.
//
// SEGURANÇA:
// - A chave ANTHROPIC_API_KEY fica só no servidor (env var Vercel), nunca exposta.
// - Endpoint exige Bearer JWT do Supabase pertencente ao POLIMATA_USER_ID.
// - CORS restrito ao domínio próprio.
// - model em allowlist; max_tokens limitado; messages com cap de tamanho.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://euktswsroqgvewzqappq.supabase.co';

// Modelos permitidos (manter sincronizado com o que o frontend usa)
const ALLOWED_MODELS = new Set([
  'claude-sonnet-4-6',
  'claude-opus-4-6',
  'claude-haiku-4-5-20251001',
]);

// Limites de proteção contra abuso/custo
const MAX_TOKENS_HARD_CAP = 4096;
const MAX_BODY_BYTES = 200 * 1024; // 200 KB de payload (entrada multimodal pode ser grande, mas não absurda)

// CORS: só permite origem própria do app gerencial
const ALLOWED_ORIGINS = new Set([
  'https://gestao.polimatagrc.com.br',
  'https://polimata-gestao.vercel.app',
]);

let _supabase = null;
function getSupabase() {
  if (_supabase) return _supabase;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY ausente');
  _supabase = createClient(SUPABASE_URL, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _supabase;
}

function setCors(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '600');
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  // ---- AUTH: Bearer JWT do Supabase, igual a POLIMATA_USER_ID ----
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = auth.slice(7);

  const allowedUserId = process.env.POLIMATA_USER_ID;
  if (!allowedUserId) {
    return res.status(500).json({ error: 'Configuração do servidor incompleta' });
  }

  try {
    const { data: { user }, error: authErr } = await getSupabase().auth.getUser(token);
    if (authErr || !user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (user.id !== allowedUserId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // ---- ENV CHECK ----
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Configuração do servidor incompleta' });
  }

  // ---- VALIDAÇÃO DE PAYLOAD ----
  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'JSON inválido' });
  }
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Payload inválido' });
  }

  // Tamanho do body
  const bodyBytes = Buffer.byteLength(JSON.stringify(body), 'utf8');
  if (bodyBytes > MAX_BODY_BYTES) {
    return res.status(413).json({ error: 'Payload muito grande' });
  }

  const { model, messages, system } = body;
  let { max_tokens } = body;

  if (typeof model !== 'string' || !ALLOWED_MODELS.has(model)) {
    return res.status(400).json({ error: 'model inválido ou não permitido' });
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages obrigatório' });
  }

  // Cap em max_tokens (sempre, independente do que o cliente pediu)
  if (typeof max_tokens !== 'number' || !Number.isFinite(max_tokens) || max_tokens <= 0) {
    max_tokens = 1024;
  }
  max_tokens = Math.min(Math.floor(max_tokens), MAX_TOKENS_HARD_CAP);

  // ---- CHAMADA À ANTHROPIC ----
  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens,
        messages,
        ...(system ? { system } : {}),
      }),
    });

    const data = await upstream.json();
    return res.status(upstream.status).json(data);
  } catch (err) {
    // Não expõe stack traces para o cliente
    console.error('Erro no proxy Anthropic:', err);
    return res.status(502).json({ error: 'Falha ao chamar provedor de IA' });
  }
}
