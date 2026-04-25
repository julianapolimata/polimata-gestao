// Serverless cron endpoint — lê emails do alias financeiro@polimatagrc.com.br,
// extrai NFs/guias dos anexos via IA, e cria lançamentos automaticamente.
// Acionado pelo GitHub Actions a cada 15 minutos com Bearer CRON_SECRET.

import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://euktswsroqgvewzqappq.supabase.co';
const POLIMATA_CNPJ = '48948776000164';
const GMAIL_TARGET_ALIAS = process.env.GMAIL_TARGET_ALIAS || 'financeiro@polimatagrc.com.br';

// Limita por execução para não estourar timeout (Vercel Hobby = 60s)
const MAX_MESSAGES_PER_RUN = 3;

// Lazy init do Supabase (só cria o client na primeira chamada autenticada)
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

export default async function handler(req, res) {
  try {
    // CORS pra permitir chamada do frontend (mesma origem por padrão na Vercel)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(204).end();

    // ---- Auth: aceita CRON_SECRET ou JWT do usuário Supabase ----
    const auth = req.headers.authorization || '';
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      return res.status(500).json({ error: 'CRON_SECRET ausente no servidor' });
    }
    if (!auth.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: missing Bearer token' });
    }
    const token = auth.slice(7);

    let authedAsUser = false;
    if (token === cronSecret) {
      // OK — chamada do cron (GitHub Actions)
    } else {
      // Tenta validar como JWT de usuário Supabase
      try {
        const { data: { user }, error } = await getSupabase().auth.getUser(token);
        if (error || !user) {
          return res.status(401).json({ error: 'Unauthorized: invalid token' });
        }
        if (user.id !== process.env.POLIMATA_USER_ID) {
          return res.status(403).json({ error: 'Forbidden: user not authorized' });
        }
        authedAsUser = true;
      } catch (e) {
        return res.status(401).json({ error: 'Unauthorized: token validation failed' });
      }
    }

    // ---- Checagem de envs essenciais ----
    const missing = [];
    if (!process.env.POLIMATA_USER_ID) missing.push('POLIMATA_USER_ID');
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
    if (!process.env.ANTHROPIC_API_KEY) missing.push('ANTHROPIC_API_KEY');
    if (!process.env.GOOGLE_CLIENT_ID) missing.push('GOOGLE_CLIENT_ID');
    if (!process.env.GOOGLE_CLIENT_SECRET) missing.push('GOOGLE_CLIENT_SECRET');
    if (!process.env.GOOGLE_REFRESH_TOKEN) missing.push('GOOGLE_REFRESH_TOKEN');
    if (missing.length) {
      return res.status(500).json({ error: 'Env vars faltando', missing });
    }

    // ---- Parâmetros opcionais (apenas via query string ou body) ----
    const url = new URL(req.url, `https://${req.headers.host}`);
    const days = Math.max(1, Math.min(365, parseInt(url.searchParams.get('days') || '30')));
    const maxMsgs = Math.max(1, Math.min(10, parseInt(url.searchParams.get('max') || String(MAX_MESSAGES_PER_RUN))));

    const result = await processEmails({ days, maxMsgs, mode: authedAsUser ? 'manual' : 'cron' });
    return res.status(200).json(result);
  } catch (e) {
    console.error('Erro no email-cron:', e);
    return res.status(500).json({ error: e.message, stack: e.stack?.split('\n').slice(0, 5).join(' | ') });
  }
}

// ============================================================================
// Pipeline principal
// ============================================================================
async function processEmails(opts) {
  const days = (opts && opts.days) || 30;
  const maxMsgs = (opts && opts.maxMsgs) || MAX_MESSAGES_PER_RUN;
  const mode = (opts && opts.mode) || 'cron';
  const startedAt = new Date().toISOString();
  const accessToken = await getGoogleAccessToken();
  const labelId = await getOrCreateLabel(accessToken, 'polimata-processado');

  const query = `to:${GMAIL_TARGET_ALIAS} has:attachment -label:polimata-processado newer_than:${days}d`;
  const messages = await listMessages(accessToken, query, maxMsgs);

  const summary = {
    started_at: startedAt,
    found: messages.length,
    processed: 0,
    skipped: 0,
    errors: 0,
    details: []
  };

  for (const m of messages) {
    try {
      const result = await processMessage(accessToken, m.id, labelId);
      summary.processed += result.lancamentos;
      if (result.lancamentos === 0) summary.skipped += 1;
      summary.details.push({ id: m.id, status: 'ok', ...result });
    } catch (e) {
      summary.errors += 1;
      summary.details.push({ id: m.id, status: 'error', error: e.message });
      await persistEmailHistory({
        gmail_message_id: m.id,
        status: 'error',
        error_message: e.message,
        processed_at: new Date().toISOString().slice(0, 10)
      });
    }
  }

  return summary;
}

// ============================================================================
// OAuth Google
// ============================================================================
async function getGoogleAccessToken() {
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token'
    })
  });
  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    throw new Error(`Falha ao renovar token Google: ${err}`);
  }
  const json = await tokenRes.json();
  return json.access_token;
}

// ============================================================================
// Gmail API
// ============================================================================
async function getOrCreateLabel(accessToken, name) {
  const listRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const { labels = [] } = await listRes.json();
  const existing = labels.find(l => l.name === name);
  if (existing) return existing.id;

  const createRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      labelListVisibility: 'labelShow',
      messageListVisibility: 'show'
    })
  });
  const created = await createRes.json();
  return created.id;
}

async function listMessages(accessToken, query, max = 10) {
  const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
  url.searchParams.set('q', query);
  url.searchParams.set('maxResults', String(max));
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Gmail list falhou: ${res.status}`);
  const { messages = [] } = await res.json();
  return messages;
}

async function applyLabel(accessToken, messageId, labelId) {
  await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ addLabelIds: [labelId] })
  });
}

// ============================================================================
// Processamento de mensagem individual
// ============================================================================
async function processMessage(accessToken, messageId, labelId) {
  const msgRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!msgRes.ok) throw new Error(`Gmail get falhou: ${msgRes.status}`);
  const msg = await msgRes.json();

  const headers = msg.payload?.headers || [];
  const subject = headers.find(h => h.name === 'Subject')?.value || '';
  const from = headers.find(h => h.name === 'From')?.value || '';
  const date = headers.find(h => h.name === 'Date')?.value || '';

  // Coletar anexos PDF/imagem (walk recursivo nas parts)
  const attachments = [];
  function walk(parts) {
    if (!parts) return;
    for (const p of parts) {
      if (p.parts) walk(p.parts);
      const filename = p.filename || '';
      const mimeType = p.mimeType || '';
      if (p.body?.attachmentId &&
          (mimeType === 'application/pdf' || mimeType.startsWith('image/'))) {
        attachments.push({ attachmentId: p.body.attachmentId, filename, mimeType });
      }
    }
  }
  walk(msg.payload?.parts);
  // Caso especial: payload é o próprio anexo (sem parts)
  if (!attachments.length && msg.payload?.body?.attachmentId) {
    const mt = msg.payload.mimeType || '';
    if (mt === 'application/pdf' || mt.startsWith('image/')) {
      attachments.push({
        attachmentId: msg.payload.body.attachmentId,
        filename: msg.payload.filename || 'anexo',
        mimeType: mt
      });
    }
  }

  if (!attachments.length) {
    await applyLabel(accessToken, messageId, labelId);
    await persistEmailHistory({
      gmail_message_id: messageId, subject, from, date,
      status: 'sem_anexo',
      processed_at: new Date().toISOString().slice(0, 10)
    });
    return { lancamentos: 0, message: 'sem anexos PDF/imagem' };
  }

  // Processa cada anexo
  let lancamentosCount = 0;
  const lancamentoIds = [];

  for (const att of attachments) {
    try {
      const attRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${att.attachmentId}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const { data } = await attRes.json();
      const base64 = data.replace(/-/g, '+').replace(/_/g, '/');

      const parsed = await parseDocumentWithAI(base64, att.mimeType);
      if (!parsed) continue;

      const lancamentoId = await createLancamento(parsed, att, base64);
      if (lancamentoId) {
        lancamentosCount++;
        lancamentoIds.push(lancamentoId);
      }
    } catch (e) {
      console.warn(`Falha em anexo ${att.filename}:`, e.message);
    }
  }

  await applyLabel(accessToken, messageId, labelId);

  await persistEmailHistory({
    gmail_message_id: messageId, subject, from, date,
    status: lancamentosCount > 0 ? 'ok' : 'sem_lancamento',
    lancamentos_ids: lancamentoIds,
    n_anexos: attachments.length,
    processed_at: new Date().toISOString().slice(0, 10)
  });

  return { lancamentos: lancamentosCount, lancamentoIds };
}

// ============================================================================
// Anthropic — parse do documento (com retry em overload)
// ============================================================================
async function fetchAnthropicWithRetry(url, options, maxAttempts = 4) {
  const backoffs = [0, 2000, 5000, 10000];
  let lastErr = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, backoffs[attempt]));
    try {
      const r = await fetch(url, options);
      if (r.ok) return r;
      if ([429, 503, 504, 529].includes(r.status)) {
        lastErr = new Error(`Anthropic HTTP ${r.status} (tentativa ${attempt + 1}/${maxAttempts})`);
        console.warn(lastErr.message);
        continue;
      }
      return r;
    } catch (e) {
      lastErr = e;
      if (attempt === maxAttempts - 1) throw e;
    }
  }
  throw lastErr || new Error('Anthropic falhou após múltiplas tentativas');
}

async function parseDocumentWithAI(base64, mimeType) {
  const isPdf = mimeType === 'application/pdf';
  const messages = [{
    role: 'user',
    content: [
      {
        type: isPdf ? 'document' : 'image',
        source: { type: 'base64', media_type: mimeType, data: base64 }
      },
      {
        type: 'text',
        text: `Você é um leitor especialista em documentos fiscais e financeiros brasileiros. Identifique se este documento é NF-e, NFS-e, DAS, DARF, GPS, GNRE, Boleto ou Fatura.

CNPJ da Polímata: ${POLIMATA_CNPJ}

REGRAS PARA DETERMINAR O TIPO:
- DAS, DARF, GPS, GNRE, ou guias de imposto → tipo "entrada" (Conta a Pagar) e parte = nome do órgão emissor
- NF/NFS com EMITENTE = ${POLIMATA_CNPJ} → "saida" (Conta a Receber)
- NF/NFS com DESTINATÁRIO = ${POLIMATA_CNPJ} → "entrada" (Conta a Pagar)
- Boleto/Fatura recebido → "entrada"

Responda APENAS com JSON válido, sem markdown:
{
  "tipo": "entrada" ou "saida",
  "tipo_documento": "NF-e"|"NFS-e"|"DAS"|"DARF"|"GPS"|"GNRE"|"Boleto"|"Fatura"|"Outro",
  "numero_nf": "número do documento",
  "emitente_nome": "...",
  "emitente_cnpj": "...",
  "destinatario_nome": "...",
  "destinatario_cnpj": "...",
  "descricao": "resumo curto",
  "valor_total": 0.00,
  "moeda": "BRL"|"USD"|"EUR"|"GBP",
  "valor_original": 0.00,
  "data_emissao": "YYYY-MM-DD",
  "data_vencimento": "YYYY-MM-DD ou null",
  "parte": "...",
  "categoria": "Impostos" se for guia, senão "Operacional"
}`
      }
    ]
  }];

  const aiRes = await fetchAnthropicWithRetry('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages
    })
  });

  if (!aiRes.ok) {
    const err = await aiRes.text();
    throw new Error(`Anthropic API: ${err}`);
  }

  const data = await aiRes.json();
  const text = data.content[0].text.trim().replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(text);
  } catch (e) {
    console.warn('Resposta não-JSON da IA:', text.slice(0, 200));
    return null;
  }
}

// ============================================================================
// Cria Lançamento (com auto-vinculação reversa em "sem_documento")
// ============================================================================
async function createLancamento(parsed, att, base64) {
  const today = new Date().toISOString().slice(0, 10);
  const due = (parsed.data_vencimento || parsed.data_emissao || today).slice(0, 10);
  const desc = String(parsed.descricao || 'Documento Fiscal').trim();
  const numero = parsed.numero_nf || '';
  const tipoDoc = parsed.tipo_documento || 'NF';
  const isSaida = parsed.tipo === 'saida';
  let val = parseFloat(parsed.valor_total) || 0;
  const moeda = (parsed.moeda || 'BRL').toUpperCase();
  const valorOrig = parseFloat(parsed.valor_original || parsed.valor_total) || 0;

  let cotacao = null;
  if (moeda !== 'BRL' && valorOrig > 0) {
    try {
      const dataRef = (parsed.data_emissao || today).slice(0, 10);
      cotacao = await fetchPTAX(moeda, dataRef);
      const taxa = isSaida ? cotacao.compra : cotacao.venda;
      val = +(valorOrig * taxa).toFixed(2);
    } catch (e) {
      console.warn('PTAX falhou:', e.message);
      val = valorOrig;
    }
  }

  const parte = isSaida
    ? String(parsed.destinatario_nome || parsed.parte || 'Não identificado').trim()
    : String(parsed.emitente_nome || parsed.parte || 'Não identificado').trim();

  const descFull = numero ? `${tipoDoc} ${numero} — ${desc}` : `${tipoDoc} — ${desc}`;

  // Auto-cadastro pessoa
  await ensurePessoa(parsed, isSaida);

  const targetTable = isSaida ? 'receivable' : 'payable';

  // ── Detecção de duplicata: bate por numero_nf + parte ou valor+parte+data ±3 dias?
  const { data: candidates } = await getSupabase()
    .from(targetTable)
    .select('id, data')
    .eq('user_id', process.env.POLIMATA_USER_ID);

  const numeroLower = String(numero || '').trim().toLowerCase();
  const dupExato = (candidates || []).find(c => {
    const item = c.data || {};
    const itemDesc = String(item.desc || '').toLowerCase();
    const itemParte = isSaida ? (item.client || '') : (item.supplier || '');
    if(!numeroLower) return false;
    if(!itemDesc.includes(numeroLower)) return false;
    if(itemParte.toLowerCase().trim() !== parte.toLowerCase().trim()) return false;
    return true;
  });

  if (dupExato) {
    console.log(`[dedup] NF ${numero} já existe (id ${dupExato.id}) — pulando`);
    return null; // Não cria duplicata
  }

  const matchSemDoc = (candidates || []).find(c => {
    const item = c.data || {};
    if (!item.sem_documento) return false;
    if (Math.abs(Number(item.value || 0) - val) > 0.02) return false;
    const partyMatch = isSaida
      ? (item.client || '').toLowerCase() === (parte || '').toLowerCase()
      : (item.supplier || '').toLowerCase() === (parte || '').toLowerCase();
    if (!partyMatch) {
      const itemDate = new Date((item.due || item.created || today) + 'T12:00:00');
      const txDate = new Date(due + 'T12:00:00');
      const diffDays = Math.abs(itemDate - txDate) / (1000 * 60 * 60 * 24);
      if (diffDays > 10) return false;
    }
    return true;
  });

  if (matchSemDoc) {
    const updated = {
      ...matchSemDoc.data,
      desc: descFull,
      anexo: base64,
      anexoNome: att.filename,
      anexoTipo: att.mimeType,
      sem_documento: false,
      notes: (matchSemDoc.data.notes || '') + ` · Doc anexado em ${today} via email automático`
    };
    const { error: updErr } = await getSupabase()
      .from(targetTable)
      .update({ data: updated })
      .eq('id', matchSemDoc.id)
      .eq('user_id', process.env.POLIMATA_USER_ID);
    if (updErr) throw new Error(`Update ${targetTable}: ${updErr.message}`);
    console.log(`[auto-vínculo] NF anexada ao lançamento existente ${matchSemDoc.id}`);
    return matchSemDoc.id;
  }

  // Sem match → cria novo lançamento
  const lancamentoId = crypto.randomUUID();
  const reg = {
    id: lancamentoId,
    created: today,
    [isSaida ? 'client' : 'supplier']: parte,
    desc: descFull,
    value: val,
    due,
    status: 'Pendente',
    cat: isSaida ? '' : mapNFCategoria(parsed),
    subcat: isSaida ? '' : desc,
    notes: 'Importado via email automaticamente',
    moeda,
    valor_original: valorOrig,
    cotacao_ptax: cotacao ? (isSaida ? cotacao.compra : cotacao.venda) : null,
    cotacao_tipo: cotacao ? (isSaida ? 'compra' : 'venda') : null,
    data_cotacao: cotacao ? cotacao.dataCotacao : null,
    conciliado: false,
    sem_documento: false,
    anexo: base64,
    anexoNome: att.filename,
    anexoTipo: att.mimeType
  };

  const { error } = await getSupabase().from(targetTable).insert({
    id: lancamentoId, user_id: process.env.POLIMATA_USER_ID, data: reg
  });
  if (error) throw new Error(`Insert ${targetTable}: ${error.message}`);

  // nf_history
  const nfId = crypto.randomUUID();
  await getSupabase().from('nf_history').insert({
    id: nfId, user_id: process.env.POLIMATA_USER_ID,
    data: {
      id: nfId, date: today,
      fileName: att.filename,
      tipo: parsed.tipo,
      tipo_documento: tipoDoc,
      parte, valor: val,
      status: 'Importado via email'
    }
  });

  return lancamentoId;
}

async function ensurePessoa(parsed, isSaida) {
  const cnpjRaw = isSaida ? parsed.destinatario_cnpj : parsed.emitente_cnpj;
  const nome = isSaida ? parsed.destinatario_nome : parsed.emitente_nome;
  if (!nome) return;

  const cnpj = String(cnpjRaw || '').replace(/\D/g, '');

  const { data: existing } = await getSupabase()
    .from('pessoas').select('id, data').eq('user_id', process.env.POLIMATA_USER_ID);

  const jaExiste = (existing || []).some(p => {
    const pData = p.data || {};
    const pDoc = String(pData.doc || '').replace(/\D/g, '');
    return (cnpj && pDoc === cnpj) ||
           (pData.nome || '').toLowerCase() === (nome || '').toLowerCase();
  });
  if (jaExiste) return;

  const td = (parsed.tipo_documento || '').toUpperCase();
  const isGuia = ['DAS', 'DARF', 'GPS', 'GNRE'].includes(td) ||
                 (parsed.categoria || '').toLowerCase().includes('imposto');
  const tipoPessoa = isSaida ? 'Cliente' : (isGuia ? 'Órgão Público' : 'Fornecedor');

  const today = new Date().toISOString().slice(0, 10);
  const novoId = crypto.randomUUID();
  const novo = {
    id: novoId, created: today,
    tipo: tipoPessoa,
    pjpf: cnpj.length === 14 ? 'PJ' : (cnpj.length === 11 ? 'PF' : 'PJ'),
    status: 'Ativo', nome,
    doc: cnpj.length === 14
      ? cnpj.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
      : cnpj.length === 11
        ? cnpj.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
        : cnpj,
    fantasia: '', segmento: '', porte: '', situacao: 'Não verificada',
    email: '', telefone: '', contato: '',
    logradouro: '', bairro: '', cidade: '', uf: '', cep: '',
    banco: '', agencia: '', conta: '',
    notes: `Auto-cadastrado via importação por email em ${today}`
  };

  await getSupabase().from('pessoas').insert({
    id: novoId, user_id: process.env.POLIMATA_USER_ID, data: novo
  });
}

function mapNFCategoria(nf) {
  const td = (nf.tipo_documento || '').toUpperCase();
  if (['DAS', 'DARF', 'GPS', 'GNRE'].includes(td)) return 'Impostos';
  return nf.categoria || 'Operacional';
}

// ============================================================================
// PTAX BCB
// ============================================================================
const _ptaxCache = {};
async function fetchPTAX(moeda, dataYYYYMMDD) {
  const moedaUpper = (moeda || 'USD').toUpperCase();
  if (moedaUpper === 'BRL') return null;
  const cacheKey = `${moedaUpper}|${dataYYYYMMDD}`;
  if (_ptaxCache[cacheKey]) return _ptaxCache[cacheKey];

  const startDate = new Date(dataYYYYMMDD + 'T12:00:00');
  for (let i = 0; i < 10; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() - i);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const yyyy = d.getFullYear();
    const dataStr = `${mm}-${dd}-${yyyy}`;

    const url = moedaUpper === 'USD'
      ? `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarDia(dataCotacao=@dataCotacao)?@dataCotacao='${dataStr}'&$format=json`
      : `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoMoedaDia(moeda=@moeda,dataCotacao=@dataCotacao)?@moeda='${moedaUpper}'&@dataCotacao='${dataStr}'&$format=json`;

    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      const j = await r.json();
      if (j.value?.length) {
        const v = j.value[0];
        const result = {
          compra: v.cotacaoCompra,
          venda: v.cotacaoVenda,
          dataCotacao: `${yyyy}-${mm}-${dd}`,
          moeda: moedaUpper
        };
        _ptaxCache[cacheKey] = result;
        return result;
      }
    } catch (e) {
      console.warn('PTAX erro:', e.message);
    }
  }
  throw new Error(`PTAX nao encontrada para ${moedaUpper} em ${dataYYYYMMDD}`);
}

// ============================================================================
// Persistência do histórico de processamento
// ============================================================================
async function persistEmailHistory(data) {
  await getSupabase().from('emails_processados').insert({
    id: crypto.randomUUID(),
    user_id: process.env.POLIMATA_USER_ID,
    data
  });
}
