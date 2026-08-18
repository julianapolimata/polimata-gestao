// Endpoint ONE-TIME de backfill — relê os anexos dos lançamentos importados
// que estão sem data de emissão (competência) e preenche data_competencia via IA.
// Só é necessário por causa de versões antigas do importador que não gravavam
// a competência. Acionado manualmente (workflow_dispatch) com Bearer CRON_SECRET.
//
// Processa um lote por chamada (MAX_PER_RUN) pra não estourar o timeout da
// Vercel; marca os que falham (data_competencia_backfill='tentado') pra
// convergir sem reprocessar. Retorna quantos ainda faltam.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://euktswsroqgvewzqappq.supabase.co';
const BUCKET = 'anexos-fiscais';
const MAX_PER_RUN = 4; // total entre as duas tabelas (cada NF = 1 leitura de IA; margem p/ timeout Vercel)

let _supabase = null;
function getSupabase() {
  if (_supabase) return _supabase;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY ausente');
  _supabase = createClient(SUPABASE_URL, key, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  return _supabase;
}

async function fetchAnthropic(body) {
  for (let i = 0; i < 3; i++) {
    let res;
    try {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(body)
      });
    } catch {
      await new Promise(r => setTimeout(r, 1200 * (i + 1)));
      continue;
    }
    if (res.ok) return res;
    if (res.status === 429 || res.status >= 500) {
      await new Promise(r => setTimeout(r, 1200 * (i + 1)));
      continue;
    }
    return res; // erro definitivo (4xx) — não adianta repetir
  }
  return null;
}

const INSTRUCAO = 'Extraia SOMENTE a data de emissão deste documento fiscal brasileiro. Procure por "Data de emissão", "Emissão", "Competência", "Data de competência", "Issue date". Responda APENAS com JSON, sem markdown: {"data_emissao": "YYYY-MM-DD"} — ou {"data_emissao": null} se realmente não houver.';

// NFS-e/NF-e em XML: a data está no texto puro. Regex direto (sem IA).
function emissaoDoXml(xml) {
  if (!xml) return null;
  const m = xml.match(/<[\w:]*(?:DataEmissao|DataEmissaoRps|DataCompetencia|Competencia|dhEmi|dEmi|dCompet)[^>]*>\s*(\d{4}-\d{2}-\d{2})/i);
  return m ? m[1] : null;
}

// Lê o documento e devolve só a data de emissão (YYYY-MM-DD) ou null.
async function extrairEmissao(anexo) {
  // XML: tenta regex primeiro (rápido, sem custo); senão manda o texto pra IA.
  if (anexo.isXml && anexo.text) {
    const direto = emissaoDoXml(anexo.text);
    if (direto) return direto;
  }
  let content;
  if (anexo.isXml && anexo.text) {
    content = [{ type: 'text', text: `${INSTRUCAO}\n\nXML do documento:\n${anexo.text.slice(0, 20000)}` }];
  } else {
    const isPdf = String(anexo.mime || '').includes('pdf');
    content = [
      { type: isPdf ? 'document' : 'image', source: { type: 'base64', media_type: anexo.mime || 'application/pdf', data: anexo.base64 } },
      { type: 'text', text: INSTRUCAO }
    ];
  }
  const body = { model: 'claude-sonnet-5', max_tokens: 300, thinking: { type: 'disabled' }, messages: [{ role: 'user', content }] };
  const res = await fetchAnthropic(body);
  if (!res || !res.ok) return null;
  const data = await res.json();
  const text = String(data?.content?.[0]?.text || '').trim().replace(/```json|```/g, '').trim();
  try {
    const p = JSON.parse(text);
    const d = String(p.data_emissao || '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
  } catch {
    return null;
  }
}

// Recupera o anexo: inline (data.anexo) ou do Storage (data.anexo_path).
// Para XML, também decodifica o texto pra ler a data direto.
async function getAnexo(row) {
  const mime = row.data?.anexoTipo || 'application/pdf';
  let base64 = null;
  if (row.data?.anexo) {
    base64 = row.data.anexo;
  } else if (row.data?.anexo_path) {
    const { data, error } = await getSupabase().storage.from(BUCKET).download(row.data.anexo_path);
    if (error || !data) return null;
    base64 = Buffer.from(await data.arrayBuffer()).toString('base64');
  } else {
    return null;
  }
  const isXml = /xml/i.test(mime) || String(row.data?.anexoNome || '').toLowerCase().endsWith('.xml');
  let text = null;
  if (isXml) { try { text = Buffer.from(base64, 'base64').toString('utf8'); } catch { text = null; } }
  return { base64, mime, isXml, text };
}

const precisaBackfill = d =>
  d?.anexoNome && !d?.data_competencia && d?.data_competencia_backfill !== 'tentado';

export default async function handler(req, res) {
  try {
    // CORS: só a origem própria do app (chamado do botão no front).
    const origin = req.headers.origin || '';
    const allowedOrigins = new Set([
      'https://gestao.polimatagrc.com.br',
      'https://polimata-gestao.vercel.app',
    ]);
    if (allowedOrigins.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(204).end();

    // Auth: aceita CRON_SECRET (server-to-server) ou JWT do usuário Polímata.
    const auth = req.headers.authorization || '';
    const cronSecret = process.env.CRON_SECRET;
    if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    const token = auth.slice(7);
    if (!(cronSecret && token === cronSecret)) {
      try {
        const { data: { user }, error } = await getSupabase().auth.getUser(token);
        if (error || !user) return res.status(401).json({ error: 'Unauthorized' });
        if (user.id !== process.env.POLIMATA_USER_ID) return res.status(403).json({ error: 'Forbidden' });
      } catch {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }

    const uid = process.env.POLIMATA_USER_ID;
    if (!uid) return res.status(500).json({ error: 'POLIMATA_USER_ID ausente' });
    const dry = String(req.query?.dry || '') === '1';
    const sb = getSupabase();

    const resumo = { ok: 0, sem_data: 0, sem_anexo: 0, erro: 0, detalhes: [] };
    let restantes = 0;
    let orcamento = MAX_PER_RUN;

    for (const tabela of ['receivable', 'payable']) {
      const { data: rows, error } = await sb.from(tabela).select('id, data').eq('user_id', uid);
      if (error) { resumo.erro++; continue; }
      const alvos = (rows || []).filter(r => precisaBackfill(r.data));
      restantes += alvos.length;

      for (const row of alvos) {
        if (orcamento <= 0) break;
        orcamento--;
        try {
          const anexo = await getAnexo(row);
          if (!anexo) {
            resumo.sem_anexo++;
            if (!dry) await sb.from(tabela).update({ data: { ...row.data, data_competencia_backfill: 'tentado' } }).eq('id', row.id).eq('user_id', uid);
            continue;
          }
          const emissao = await extrairEmissao(anexo);
          if (!emissao) {
            resumo.sem_data++;
            if (!dry) await sb.from(tabela).update({ data: { ...row.data, data_competencia_backfill: 'tentado' } }).eq('id', row.id).eq('user_id', uid);
            continue;
          }
          if (!dry) {
            const nova = { ...row.data, data_competencia: emissao };
            delete nova.data_competencia_backfill;
            const { error: upErr } = await sb.from(tabela).update({ data: nova }).eq('id', row.id).eq('user_id', uid);
            if (upErr) { resumo.erro++; continue; }
          }
          resumo.ok++;
          resumo.detalhes.push({ tabela, codigo: row.data?.codigo || null, emissao });
          restantes--;
        } catch (e) {
          resumo.erro++;
        }
      }
    }

    return res.status(200).json({ dry, processados_neste_run: resumo.ok + resumo.sem_data + resumo.sem_anexo, restantes: Math.max(0, restantes), resumo });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
