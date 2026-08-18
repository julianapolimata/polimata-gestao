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

// Lê o documento e devolve só a data de emissão (YYYY-MM-DD) ou null.
async function extrairEmissao(base64, mimeType) {
  const isPdf = String(mimeType || '').includes('pdf');
  const body = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: 300,
    messages: [{
      role: 'user',
      content: [
        { type: isPdf ? 'document' : 'image', source: { type: 'base64', media_type: mimeType || 'application/pdf', data: base64 } },
        { type: 'text', text: 'Leia este documento fiscal brasileiro (NF-e, NFS-e, DAS, boleto, fatura) e extraia SOMENTE a data de emissão. Procure por "Data de emissão", "Emissão", "Competência", "Data de competência", "Issue date". Responda APENAS com JSON, sem markdown: {"data_emissao": "YYYY-MM-DD"} — ou {"data_emissao": null} se realmente não houver.' }
      ]
    }]
  };
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

// Recupera o base64 do anexo: inline (data.anexo) ou do Storage (data.anexo_path).
async function getBase64(row) {
  if (row.data?.anexo) return { base64: row.data.anexo, mime: row.data.anexoTipo || 'application/pdf' };
  if (row.data?.anexo_path) {
    const { data, error } = await getSupabase().storage.from(BUCKET).download(row.data.anexo_path);
    if (error || !data) return null;
    const buf = Buffer.from(await data.arrayBuffer());
    return { base64: buf.toString('base64'), mime: row.data.anexoTipo || 'application/pdf' };
  }
  return null;
}

const precisaBackfill = d =>
  d?.anexoNome && !d?.data_competencia && d?.data_competencia_backfill !== 'tentado';

export default async function handler(req, res) {
  try {
    const auth = req.headers.authorization || '';
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) return res.status(500).json({ error: 'CRON_SECRET ausente no servidor' });
    if (auth !== `Bearer ${cronSecret}`) return res.status(401).json({ error: 'Unauthorized' });

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
          const anexo = await getBase64(row);
          if (!anexo) {
            resumo.sem_anexo++;
            if (!dry) await sb.from(tabela).update({ data: { ...row.data, data_competencia_backfill: 'tentado' } }).eq('id', row.id).eq('user_id', uid);
            continue;
          }
          const emissao = await extrairEmissao(anexo.base64, anexo.mime);
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
