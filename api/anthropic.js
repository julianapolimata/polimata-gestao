// Serverless function (Vercel) — proxy seguro para a API da Anthropic.
// A chave ANTHROPIC_API_KEY fica só no servidor (vari\u00e1vel de ambiente Vercel),
// nunca exposta ao navegador.

export default async function handler(req, res) {
  // CORS b\u00e1sico (opcional; Vercel serve /api e / do mesmo dom\u00ednio, ent\u00e3o n\u00e3o \u00e9 estritamente necess\u00e1rio)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'M\u00e9todo n\u00e3o permitido' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY n\u00e3o configurada no servidor' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    const { model, max_tokens, messages, system } = body || {};
    if (!model || !messages) {
      return res.status(400).json({ error: 'model e messages s\u00e3o obrigat\u00f3rios' });
    }

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        max_tokens: max_tokens || 1024,
        messages,
        ...(system ? { system } : {})
      })
    });

    const data = await upstream.json();
    return res.status(upstream.status).json(data);
  } catch (err) {
    console.error('Erro no proxy Anthropic:', err);
    return res.status(500).json({ error: err.message || 'Falha ao chamar Anthropic' });
  }
}
