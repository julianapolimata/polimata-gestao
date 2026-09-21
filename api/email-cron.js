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

// ---------------------------------------------------------------------------
// Anexos que chegam como LINK (portais de contabilidade, ex.: G-Click)
// ---------------------------------------------------------------------------
// O escritório manda a guia de imposto pelo portal: o e-mail NÃO tem anexo MIME,
// o corpo HTML traz <a href="...arquivo.pdf">. A busca padrão do Gmail exige
// has:attachment, então esses e-mails nem apareciam — nenhuma DAS/DARF entrava.
//
// SEGURANÇA — por que isto é sensível: baixar uma URL escrita dentro de um
// e-mail é o vetor clássico de phishing/SSRF, e este código roda no servidor
// com a SERVICE_ROLE_KEY. Por isso o download é preso a uma ALLOWLIST de hosts,
// só https, com teto de redirects, timeout, teto de tamanho e lista fechada de
// content-types. Nada fora disso é baixado — na dúvida, recusa e registra.

// Remetentes cujos e-mails devem ser varridos MESMO sem anexo MIME.
function listaDoEnv(nome, padrao) {
  return String(process.env[nome] || padrao)
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}
const EMAIL_REMETENTES_LINK = listaDoEnv('EMAIL_REMETENTES_LINK', 'gclick.com.br');
// Remetentes de confiança (escritório de contabilidade). Deles, vale o anexo
// mandado para QUALQUER caixa da empresa, não só o alias financeiro: quando
// alguém do escritório responde direto (folha, esclarecimento de guia), o
// e-mail costuma ir só para a caixa pessoal e ficava invisível para o robô.
const EMAIL_REMETENTES_CONFIAVEIS = listaDoEnv('EMAIL_REMETENTES_CONFIAVEIS', 'jlramos.com.br,gclick.com.br');
// ESCOPO DA BUSCA. Por padrão o robô varre TODAS as caixas da conta conectada
// (nota fiscal e guia chegam em qualquer endereço, não só no alias financeiro).
// GMAIL_SO_ALIAS=true volta a estreitar para GMAIL_TARGET_ALIAS.
const GMAIL_SO_ALIAS = String(process.env.GMAIL_SO_ALIAS || 'false').toLowerCase() === 'true';
const escopoDestino = () => (GMAIL_SO_ALIAS && GMAIL_TARGET_ALIAS ? `to:${GMAIL_TARGET_ALIAS} ` : '');
// Varrer tudo sem filtro encheria a fila de apresentação, contrato e foto. O
// documento fiscal é PDF ou XML — o resto nem é lido (economiza leitura de IA).
const EMAIL_TIPOS_ARQUIVO = listaDoEnv('EMAIL_TIPOS_ARQUIVO', 'pdf,xml');
const filtroArquivo = () => (EMAIL_TIPOS_ARQUIVO.length ? `(${EMAIL_TIPOS_ARQUIVO.map(t => `filename:${t}`).join(' OR ')}) ` : '');

// Hosts de onde é permitido baixar. Comparação EXATA (nunca "termina com"):
// "endsWith('gclick.com.br')" aceitaria app.gclick.com.br.evil.tld, que é
// justamente o truque usado em phishing. Quem precisar de outro host, põe na env.
const EMAIL_LINKS_DOMINIOS = listaDoEnv(
  'EMAIL_LINKS_DOMINIOS',
  'app.gclick.com.br,innubem-prod.s3.amazonaws.com'
);

const MAX_LINKS_POR_EMAIL = 5;          // teto de arquivos baixados por e-mail
const MAX_LINKS_CANDIDATOS = 20;        // teto de hrefs analisados por e-mail
const MAX_LINK_BYTES = 10 * 1024 * 1024; // 10 MB — guia fiscal tem ~200 KB
const MAX_LINK_REDIRECTS = 3;           // o G-Click faz 1 salto (302 → S3 assinado)
const LINK_TIMEOUT_MS = 30000;
const LINK_EXTENSOES = ['.pdf', '.xml', '.png', '.jpg', '.jpeg'];
const LINK_MIMES_ACEITOS = new Set([
  'application/pdf', 'text/xml', 'application/xml', 'image/png', 'image/jpeg'
]);
const EXT_PARA_MIME = {
  '.pdf': 'application/pdf',
  '.xml': 'application/xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg'
};

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
    // CORS: só a origem própria do app. O cron do GitHub Actions é
    // server-to-server (sem header Origin), então não depende disto.
    const origin = req.headers.origin || '';
    const allowedOrigins = new Set([
      'https://gestao.polimatagrc.com.br',
      'https://polimata-gestao.vercel.app',
    ]);
    if (allowedOrigins.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
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
    const reprocess = url.searchParams.get('reprocess') === '1';

    const result = await processEmails({ days, maxMsgs, reprocess, mode: authedAsUser ? 'manual' : 'cron' });
    return res.status(200).json(result);
  } catch (e) {
    console.error('Erro no email-cron:', e);
    return res.status(500).json({ error: 'Erro interno no processamento' });
  }
}

// ============================================================================
// Pipeline principal
// ============================================================================
async function processEmails(opts) {
  const days = (opts && opts.days) || 30;
  const maxMsgs = (opts && opts.maxMsgs) || MAX_MESSAGES_PER_RUN;
  const mode = (opts && opts.mode) || 'cron';
  const reprocess = !!(opts && opts.reprocess);
  const startedAt = new Date().toISOString();
  const accessToken = await getGoogleAccessToken();
  const labelId = await getOrCreateLabel(accessToken, 'polimata-processado');

  // Monta a lista de mensagens a processar.
  //  - Normal: busca no Gmail (não-lidos, com anexo, janela de N dias).
  //  - Reprocess: relê e-mails que FALHARAM (pelo gmail_message_id guardado),
  //    ignorando a label — recupera o que a queda do modelo deixou passar.
  let messageIds = [];
  let falhosRows = [];
  if (reprocess) {
    const { data: rows } = await getSupabase()
      .from('emails_processados').select('id, data')
      .eq('user_id', process.env.POLIMATA_USER_ID);
    falhosRows = rows || [];
    const FALHOS = ['sem_lancamento', 'sem_anexo', 'error'];
    const byMsg = {};
    for (const r of falhosRows) {
      const mid = r.data?.gmail_message_id;
      if (!mid) continue;
      const s = (byMsg[mid] = byMsg[mid] || { falho: false, reproc: false, ok: false });
      if (r.data?.reprocessed_at) s.reproc = true;
      if (r.data?.status === 'ok') s.ok = true;
      if (FALHOS.includes(r.data?.status)) s.falho = true;
    }
    messageIds = Object.entries(byMsg)
      .filter(([, s]) => s.falho && !s.reproc && !s.ok)
      .map(([mid]) => mid)
      .slice(0, maxMsgs);
  } else {
    const query = `${escopoDestino()}has:attachment ${filtroArquivo()}-label:polimata-processado newer_than:${days}d`;
    const messages = await listMessages(accessToken, query, maxMsgs);
    messageIds = messages.map(m => m.id);

    // 2ª varredura: remetentes que mandam o arquivo como LINK, sem anexo MIME.
    // Aqui a busca NÃO pode ter has:attachment (senão o e-mail some), então
    // continua restrita aos remetentes configurados — sem isso viraria "ler
    // todo e-mail da conta".
    const restante = Math.max(0, maxMsgs - messageIds.length);
    if (restante > 0 && EMAIL_REMETENTES_LINK.length) {
      try {
        const fromExpr = EMAIL_REMETENTES_LINK.map(d => `from:${d}`).join(' OR ');
        const queryLink = `${escopoDestino()}(${fromExpr}) -label:polimata-processado newer_than:${days}d`;
        const msgsLink = await listMessages(accessToken, queryLink, restante);
        const vistos = new Set(messageIds);
        for (const m of msgsLink) {
          if (vistos.has(m.id)) continue; // não duplica o que a 1ª busca já trouxe
          vistos.add(m.id);
          messageIds.push(m.id);
        }
      } catch (e) {
        console.warn('Varredura de remetentes-link falhou:', e.message);
      }
    }

    // 3ª varredura: ANEXO de verdade vindo de remetente de confiança, sem exigir
    // que tenha sido endereçado ao alias financeiro. Continua estreita (só esses
    // remetentes + has:attachment), então não vira varredura da caixa inteira.
    const restante2 = Math.max(0, maxMsgs - messageIds.length);
    if (restante2 > 0 && EMAIL_REMETENTES_CONFIAVEIS.length) {
      try {
        const fromExpr2 = EMAIL_REMETENTES_CONFIAVEIS.map(d => `from:${d}`).join(' OR ');
        const queryConf = `(${fromExpr2}) has:attachment -label:polimata-processado newer_than:${days}d`;
        const msgsConf = await listMessages(accessToken, queryConf, restante2);
        const vistos2 = new Set(messageIds);
        for (const m of msgsConf) {
          if (vistos2.has(m.id)) continue;
          vistos2.add(m.id);
          messageIds.push(m.id);
        }
      } catch (e) {
        console.warn('Varredura de remetentes confiáveis falhou:', e.message);
      }
    }
  }

  const summary = {
    started_at: startedAt,
    reprocess,
    found: messageIds.length,
    // teto por execução: a Vercel corta a função em 60 s, então a rodada pega
    // um lote e o resto fica para a próxima (o que já passou ganha etiqueta).
    limite_por_rodada: maxMsgs,
    pode_ter_mais: messageIds.length >= maxMsgs,
    processed: 0,
    skipped: 0,
    errors: 0,
    details: []
  };

  for (const mid of messageIds) {
    try {
      const result = await processMessage(accessToken, mid, labelId);
      summary.processed += result.lancamentos;
      if (result.lancamentos === 0) summary.skipped += 1;
      summary.details.push({ id: mid, status: 'ok', ...result });
    } catch (e) {
      summary.errors += 1;
      summary.details.push({ id: mid, status: 'error', error: e.message });
      await persistEmailHistory({
        gmail_message_id: mid,
        status: 'error',
        error_message: e.message,
        processed_at: new Date().toISOString().slice(0, 10)
      });
    }
    // No reprocess, marca as linhas antigas desse e-mail pra não repetir na próxima rodada.
    if (reprocess) {
      const hoje = new Date().toISOString().slice(0, 10);
      for (const r of falhosRows.filter(r => r.data?.gmail_message_id === mid && !r.data?.reprocessed_at)) {
        await getSupabase().from('emails_processados').update({ data: { ...r.data, reprocessed_at: hoje } }).eq('id', r.id);
      }
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
// Anexos por LINK (corpo HTML) — extração e download com allowlist
// ============================================================================

// Host autorizado? Comparação exata contra a allowlist, sem sufixo e sem
// curinga. É a única porta de entrada: tanto o link do e-mail quanto CADA
// redirect passam por aqui.
function hostPermitido(host) {
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  if (!h) return false;
  return EMAIL_LINKS_DOMINIOS.includes(h);
}

function decodeSeguro(s) {
  try { return decodeURIComponent(String(s || '')); } catch { return String(s || ''); }
}

// Entidades HTML mínimas que aparecem em href (&amp; é o caso real do G-Click).
function decodeEntidadesHtml(s) {
  return String(s || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function extensaoDe(caminho) {
  const limpo = String(caminho || '').split('?')[0].split('#')[0];
  const i = limpo.lastIndexOf('.');
  return i === -1 ? '' : limpo.slice(i).toLowerCase();
}

// Nome de arquivo saneado: o nome vem de dentro do e-mail, então não pode
// carregar caminho ("../", "/", "\") nem caractere de controle.
function sanitizarNome(bruto, fallback = 'anexo-link.pdf') {
  const soNome = String(bruto || '').split('?')[0].split('#')[0].split(/[/\\]/).pop();
  const limpo = soNome
    .replace(/\p{Cc}/gu, '')
    .replace(/[^\p{L}\p{N}. _()-]/gu, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120);
  return limpo || fallback;
}

// Extrai do corpo HTML os <a href> que apontam para arquivo baixável.
// Devolve { url, host, filename, permitido } — quem não está na allowlist vem
// marcado como permitido:false para virar estatística de recusa, não download.
function extrairLinksDeAnexo(html) {
  const achados = [];
  if (!html) return achados;
  const vistos = new Set();
  const re = /<a\b[^>]*?href\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (achados.length >= MAX_LINKS_CANDIDATOS) break;
    const bruto = decodeEntidadesHtml(m[1].trim());
    let u;
    try { u = new URL(bruto); } catch { continue; }
    // Só https: http permitiria interceptar/trocar o arquivo no caminho.
    if (u.protocol !== 'https:') continue;
    // O alvo pode estar no parâmetro (?arquivo=...%2Fguia.pdf) ou no caminho.
    const paramArquivo = decodeSeguro(u.searchParams.get('arquivo') || '');
    const alvo = paramArquivo || decodeSeguro(u.pathname);
    if (!LINK_EXTENSOES.includes(extensaoDe(alvo))) continue;
    const chave = u.toString();
    if (vistos.has(chave)) continue; // o mesmo link aparece no ícone e no texto
    vistos.add(chave);
    achados.push({
      url: chave,
      host: u.hostname.toLowerCase(),
      filename: sanitizarNome(alvo),
      permitido: hostPermitido(u.hostname)
    });
  }
  return achados;
}

// Corpo HTML da mensagem (walk nas parts; Gmail entrega em base64url).
function extrairCorpoHtml(payload) {
  let html = '';
  function walk(p) {
    if (!p || html) return;
    if (p.mimeType === 'text/html' && p.body?.data) {
      try {
        html = Buffer.from(String(p.body.data).replace(/-/g, '+').replace(/_/g, '/'), 'base64')
          .toString('utf8')
          .slice(0, 500000);
      } catch { html = ''; }
    }
    if (p.parts) for (const filho of p.parts) walk(filho);
  }
  walk(payload);
  return html;
}

// Baixa o arquivo do link com todas as travas. Devolve
// { ok:true, base64, mimeType, filename } — mesmo formato dos anexos MIME,
// pra cair no pipeline existente sem mudança — ou { ok:false, motivo }.
async function baixarAnexoDeLink(linkUrl, nomeSugerido) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LINK_TIMEOUT_MS);
  try {
    let atual = linkUrl;
    let res = null;
    // redirect:'manual' é proposital: com 'follow' o fetch iria para onde o
    // servidor mandasse SEM passar pela allowlist. Aqui cada salto é validado.
    for (let salto = 0; salto <= MAX_LINK_REDIRECTS; salto++) {
      let u;
      try { u = new URL(atual); } catch { return { ok: false, motivo: 'url_invalida' }; }
      if (u.protocol !== 'https:') return { ok: false, motivo: 'protocolo_nao_https', host: u.hostname };
      if (!hostPermitido(u.hostname)) return { ok: false, motivo: 'dominio_nao_autorizado', host: u.hostname };

      const r = await fetch(u.toString(), {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': 'polimata-email-cron/1' }
      });

      if ([301, 302, 303, 307, 308].includes(r.status)) {
        const loc = r.headers.get('location');
        if (!loc) return { ok: false, motivo: 'redirect_sem_destino', host: u.hostname };
        try { await r.body?.cancel(); } catch { /* corpo do 302 não interessa */ }
        atual = new URL(loc, u).toString(); // relativo resolve contra o host atual
        continue;
      }
      res = r;
      break;
    }
    if (!res) return { ok: false, motivo: 'redirects_demais' };
    if (!res.ok) return { ok: false, motivo: `http_${res.status}` };

    const hostFinal = new URL(res.url || atual).hostname.toLowerCase();

    // Nome: content-disposition manda; senão o que veio do link.
    let filename = sanitizarNome(nomeSugerido);
    const cd = res.headers.get('content-disposition') || '';
    const mCd = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(cd);
    if (mCd) filename = sanitizarNome(decodeSeguro(mCd[1].trim()), filename);

    // Tamanho declarado: recusa antes de abrir o stream quando o servidor avisa.
    const declarado = parseInt(res.headers.get('content-length') || '0', 10);
    if (declarado && declarado > MAX_LINK_BYTES) {
      try { await res.body?.cancel(); } catch { /* ignora */ }
      return { ok: false, motivo: 'tamanho_excedido', host: hostFinal };
    }

    // Tipo: lista fechada. octet-stream (S3 costuma mandar) só passa se a
    // extensão do nome disser qual é; sem isso, descarta.
    const ct = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    let mimeType = ct;
    if (!LINK_MIMES_ACEITOS.has(mimeType)) {
      if (ct === 'application/octet-stream' || ct === 'binary/octet-stream' || ct === '') {
        mimeType = EXT_PARA_MIME[extensaoDe(filename)] || '';
      } else {
        mimeType = '';
      }
      if (!mimeType) {
        try { await res.body?.cancel(); } catch { /* ignora */ }
        return { ok: false, motivo: `tipo_nao_aceito:${ct || 'sem-tipo'}`, host: hostFinal };
      }
    }

    // Leitura com corte no stream: content-length pode mentir ou faltar, então
    // o teto de 10 MB é aplicado de novo enquanto os bytes chegam.
    const partes = [];
    let total = 0;
    if (res.body && typeof res.body.getReader === 'function') {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > MAX_LINK_BYTES) {
          try { await reader.cancel(); } catch { /* ignora */ }
          return { ok: false, motivo: 'tamanho_excedido', host: hostFinal };
        }
        partes.push(Buffer.from(value));
      }
    } else {
      const buf = Buffer.from(await res.arrayBuffer());
      total = buf.length;
      if (total > MAX_LINK_BYTES) return { ok: false, motivo: 'tamanho_excedido', host: hostFinal };
      partes.push(buf);
    }
    if (!total) return { ok: false, motivo: 'arquivo_vazio', host: hostFinal };

    return {
      ok: true,
      base64: Buffer.concat(partes).toString('base64'),
      mimeType,
      filename,
      bytes: total,
      host: hostFinal
    };
  } catch (e) {
    const abortou = e.name === 'AbortError';
    return { ok: false, motivo: abortou ? 'timeout' : `falha_download:${e.message}` };
  } finally {
    clearTimeout(timer);
  }
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
      const ehXml = /xml/i.test(mimeType) || filename.toLowerCase().endsWith('.xml');
      if (p.body?.attachmentId &&
          (mimeType === 'application/pdf' || mimeType.startsWith('image/') || ehXml)) {
        attachments.push({ attachmentId: p.body.attachmentId, filename, mimeType });
      }
    }
  }
  walk(msg.payload?.parts);
  // Caso especial: payload é o próprio anexo (sem parts)
  if (!attachments.length && msg.payload?.body?.attachmentId) {
    const mt = msg.payload.mimeType || '';
    const fn = msg.payload.filename || '';
    if (mt === 'application/pdf' || mt.startsWith('image/') || /xml/i.test(mt) || fn.toLowerCase().endsWith('.xml')) {
      attachments.push({
        attachmentId: msg.payload.body.attachmentId,
        filename: fn || 'anexo',
        mimeType: mt
      });
    }
  }

  // ---- Sem anexo MIME: tenta os LINKS do corpo (portais tipo G-Click) ----
  // Só entra aqui quando não veio anexo de verdade; e-mail com anexo segue
  // pelo caminho de sempre, sem tocar em link nenhum.
  let linksVistos = 0;
  const linksRecusados = [];
  const linksBaixados = [];
  if (!attachments.length) {
    const candidatos = extrairLinksDeAnexo(extrairCorpoHtml(msg.payload));
    linksVistos = candidatos.length;
    for (const c of candidatos) {
      if (!c.permitido) linksRecusados.push({ host: c.host, motivo: 'dominio_nao_autorizado' });
    }
    const permitidos = candidatos.filter(c => c.permitido).slice(0, MAX_LINKS_POR_EMAIL);
    for (const link of permitidos) {
      const baixado = await baixarAnexoDeLink(link.url, link.filename);
      if (!baixado.ok) {
        console.warn(`[link] recusado ${link.host}: ${baixado.motivo}`);
        linksRecusados.push({ host: baixado.host || link.host, motivo: baixado.motivo });
        continue;
      }
      linksBaixados.push(link.url);
      attachments.push({
        filename: baixado.filename,
        mimeType: baixado.mimeType,
        base64: baixado.base64,   // já em base64 — não passa pela Gmail API
        origem: 'link',
        url: link.url
      });
    }
  }

  if (!attachments.length) {
    await applyLabel(accessToken, messageId, labelId);
    await persistEmailHistory({
      gmail_message_id: messageId, subject, from, date,
      status: 'sem_anexo',
      links_vistos: linksVistos,
      links_recusados: linksRecusados.length,
      links_recusas: linksRecusados,
      processed_at: new Date().toISOString().slice(0, 10)
    });
    return {
      lancamentos: 0,
      message: 'sem anexos PDF/imagem',
      links_vistos: linksVistos,
      links_recusados: linksRecusados.length
    };
  }

  // Processa cada anexo
  let lancamentosCount = 0;
  const lancamentoIds = [];

  for (const att of attachments) {
    try {
      // Anexo vindo de link já chega em base64; o MIME ainda vem do Gmail.
      let base64 = att.base64 || null;
      if (!base64) {
        const attRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${att.attachmentId}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        const { data } = await attRes.json();
        base64 = data.replace(/-/g, '+').replace(/_/g, '/');
      }

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
    n_anexos_link: linksBaixados.length,
    links_vistos: linksVistos,
    links_recusados: linksRecusados.length,
    links_recusas: linksRecusados,
    processed_at: new Date().toISOString().slice(0, 10)
  });

  return {
    lancamentos: lancamentosCount,
    lancamentoIds,
    ...(linksVistos ? { links_vistos: linksVistos, links_baixados: linksBaixados.length, links_recusados: linksRecusados.length } : {})
  };
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
  const isXml = /xml/i.test(mimeType || '');
  const isPdf = mimeType === 'application/pdf';
  // NFS-e/NF-e chegam em XML — mandar como TEXTO (não como imagem, que a IA não lê).
  let docBlock;
  if (isXml) {
    let xml = '';
    try { xml = Buffer.from(base64, 'base64').toString('utf8').slice(0, 30000); } catch { xml = ''; }
    docBlock = { type: 'text', text: `Documento fiscal em XML (conteúdo abaixo):\n\n${xml}` };
  } else {
    docBlock = { type: isPdf ? 'document' : 'image', source: { type: 'base64', media_type: mimeType, data: base64 } };
  }
  const messages = [{
    role: 'user',
    content: [
      docBlock,
      {
        type: 'text',
        text: `Você é um leitor especialista em documentos fiscais e financeiros brasileiros. Identifique se este documento é NF-e, NFS-e, DAS, DARF, GPS, GNRE, Boleto ou Fatura.

CNPJ da Polímata: ${POLIMATA_CNPJ}

REGRAS PARA DETERMINAR O TIPO:
- DAS, DARF, GPS, GNRE, ou guias de imposto → tipo "entrada" (Conta a Pagar) e parte = nome do órgão emissor
- NF/NFS com EMITENTE = ${POLIMATA_CNPJ} → "saida" (Conta a Receber)
- NF/NFS com DESTINATÁRIO = ${POLIMATA_CNPJ} → "entrada" (Conta a Pagar)
- Boleto/Fatura recebido → "entrada"

CAMPOS OBRIGATÓRIOS (extraia com muito cuidado, mesmo se aparecem em rodapé/cabeçalho):
- numero_nf: procure por "NF", "NFS-e", "Nº", "Numero", "Number". Se não achar, deixe string vazia.
- data_emissao: procure por "Data de emissão", "Emissão", "Issue date", "Issued on". Formato YYYY-MM-DD obrigatório.
- emitente_cnpj e destinatario_cnpj: extraia mesmo de rodapé. Format 14 dígitos.

SE FOR GUIA DE IMPOSTO (DAS, DARF, GPS, GNRE), extraia também:
- periodo_apuracao: o campo "Período de Apuração" (ou "PA", "Competência"), SEMPRE no formato "YYYY-MM". Ex.: "agosto/2026" → "2026-08"; "08/2026" → "2026-08". Se não achar, string vazia.
- numero_documento: o campo "Número do Documento" (ou "Nº do Documento", "Documento de Arrecadação"), exatamente como impresso. Se não achar, string vazia.
Para documentos que não são guia, devolva os dois como string vazia.

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
  "periodo_apuracao": "YYYY-MM (só guia, senão \\"\\")",
  "numero_documento": "número do documento de arrecadação (só guia, senão \\"\\")",
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
      model: 'claude-sonnet-5',
      max_tokens: 1500,
      thinking: { type: 'disabled' },
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
// Cria entrada em nf_pending (humano aprova depois). v2 — antes criava
// lançamento direto em receivable/payable; agora passa por fila de aprovação
// pra evitar fornecedores fragmentados, categoria errada, número faltando.
// ============================================================================
async function createLancamento(parsed, att, base64) {
  const today = new Date().toISOString().slice(0, 10);
  const due = (parsed.data_vencimento || parsed.data_emissao || today).slice(0, 10);
  const desc = String(parsed.descricao || 'Documento Fiscal').trim();
  const numero = parsed.numero_nf || '';
  const tipoDoc = parsed.tipo_documento || 'NF';
  // Guias de imposto têm identidade própria: número do documento de arrecadação
  // e período de apuração. É por eles que se reconhece o mesmo DAS chegando duas
  // vezes (o contador manda pra dois endereços e reenvia dias seguidos).
  const tipoDocUp = String(tipoDoc).toUpperCase();
  const ehGuia = ['DAS', 'DARF', 'GPS', 'GNRE'].includes(tipoDocUp);
  const numeroDoc = String(parsed.numero_documento || '').trim();
  const periodoApuracao = normalizarPeriodo(parsed.periodo_apuracao);
  // Direção DETERMINÍSTICA pelo CNPJ da Polímata — não confia só no "tipo" da IA
  // (que às vezes erra, ex.: NFS-e de compra classificada como receita).
  // Emitente = Polímata → saída (receita/Receber); destinatário = Polímata →
  // entrada (despesa/Pagar). Sem CNPJ reconhecível, cai no palpite da IA.
  const emitCnpjDir = String(parsed.emitente_cnpj || '').replace(/\D/g, '');
  const destCnpjDir = String(parsed.destinatario_cnpj || '').replace(/\D/g, '');
  let isSaida;
  if (emitCnpjDir === POLIMATA_CNPJ) isSaida = true;
  else if (destCnpjDir === POLIMATA_CNPJ) isSaida = false;
  else isSaida = parsed.tipo === 'saida';
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
    // Bloco 1: a NF só se anexa a um lançamento da MESMA parte (nome ou CNPJ).
    // Antes bastava valor + data ±10d, e a nota podia ir parar no fornecedor errado.
    const partyMatch = isSaida
      ? (item.client || '').toLowerCase().trim() === (parte || '').toLowerCase().trim()
      : (item.supplier || '').toLowerCase().trim() === (parte || '').toLowerCase().trim();
    const cnpjItem = String(item.cnpj || item.emitente_cnpj || '').replace(/\D/g, '');
    const cnpjNF = String(parsed.emitente_cnpj || '').replace(/\D/g, '');
    const cnpjMatch = !!(cnpjItem && cnpjNF && cnpjItem === cnpjNF);
    if (!partyMatch && !cnpjMatch) return false;
    const itemDate = new Date((item.due || item.created || today) + 'T12:00:00');
    const txDate = new Date(due + 'T12:00:00');
    const diffDays = Math.abs(itemDate - txDate) / (1000 * 60 * 60 * 24);
    return diffDays <= 45;
  });

  if (matchSemDoc) {
    const updated = {
      ...matchSemDoc.data,
      desc: descFull,
      // NOTE: Base64 stored server-side; frontend migra pro Storage on-demand (transparent)
      anexo: base64,
      anexoNome: att.filename,
      anexoTipo: att.mimeType,
      sem_documento: false,
      doc_status: 'vinculado', // a nota chegou: situação fiscal passa a "Com NF"
      // competência (data de emissão) vem da NF anexada — salvo se já foi preenchida à mão
      data_competencia: matchSemDoc.data.data_competencia || (parsed.data_emissao || '').slice(0, 10) || null,
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

  // ── Dedup contra a FILA de pendentes ──────────────────────────────────
  // O mesmo e-mail de NFS-e costuma trazer PDF + XML da mesma nota; sem isso,
  // cada anexo viraria uma pendência. Trava por fornecedor + número + valor
  // (+ data, quando o número falta). Empata o just-inserted da mesma rodada.
  const emitCnpj = String(parsed.emitente_cnpj || '').replace(/\D/g, '');
  const dataEmis = String(parsed.data_emissao || '').slice(0, 10);
  const { data: pendentes } = await getSupabase()
    .from('nf_pending')
    .select('id, data')
    .eq('user_id', process.env.POLIMATA_USER_ID)
    .eq('status', 'pendente');
  // ── Dedup de GUIA (DAS/DARF/GPS/GNRE) ────────────────────────────────
  // O mesmo e-mail vai para dois endereços e o contador reenvia o mesmo
  // assunto dias seguidos. A guia é a mesma quando o número do documento
  // bate; sem número, quando período + tipo + valor batem.
  if (ehGuia && (numeroDoc || periodoApuracao)) {
    const numDocDigitos = numeroDoc.replace(/\D/g, '');
    const mesmaGuia = (d) => {
      if (!d) return false;
      if (numDocDigitos) {
        const dn = String(d.numero_documento || d.numero || '').replace(/\D/g, '');
        if (dn && dn === numDocDigitos) return true;
      }
      if (periodoApuracao
          && String(d.periodo_apuracao || '') === periodoApuracao
          && String(d.tipo_documento || '').toUpperCase() === tipoDocUp
          && Math.abs(Number(d.valor ?? d.value ?? 0) - val) <= 0.02) return true;
      return false;
    };
    const guiaPend = (pendentes || []).find(p => mesmaGuia(p.data));
    const guiaLanc = (candidates || []).find(c => {
      const item = c.data || {};
      if (mesmaGuia(item)) return true;
      // Lançamento já aprovado guarda o número dentro da descrição.
      return !!(numeroDoc && String(item.desc || '').includes(numeroDoc));
    });
    if (guiaPend || guiaLanc) {
      console.log(`[dedup-guia] ${tipoDocUp} ${numeroDoc || periodoApuracao} (R$ ${val}) já registrada (${guiaPend ? 'nf_pending ' + guiaPend.id : targetTable + ' ' + guiaLanc.id}) — pulando ${att.filename}`);
      return null;
    }
  }

  const dupPend = (pendentes || []).find(p => {
    const d = p.data || {};
    const mesmoValor = Math.abs(Number(d.valor || 0) - val) <= 0.02;
    if (!mesmoValor) return false;
    const mesmaParte = String(d.parte || '').toLowerCase().trim() === parte.toLowerCase().trim()
      || (emitCnpj && String(d.emitente_cnpj || '').replace(/\D/g, '') === emitCnpj);
    if (!mesmaParte) return false;
    const mesmoNumero = numeroLower && String(d.numero || '').trim().toLowerCase() === numeroLower;
    if (numeroLower) return mesmoNumero;                       // tem número → tem que bater
    return dataEmis && String(d.data_emissao || '').slice(0, 10) === dataEmis; // sem número → mesma data
  });
  if (dupPend) {
    console.log(`[dedup-pending] NF ${numero} (R$ ${val}) já está na fila (id ${dupPend.id}) — pulando anexo ${att.filename}`);
    return null;
  }

  // v2: em vez de criar lançamento direto, cria entrada em nf_pending pra
  // humano revisar/aprovar. Mantém auto-vinculação a 'sem_documento' acima.
  const pendingId = crypto.randomUUID();
  const pendingData = {
    fileName: att.filename,
    tipo: parsed.tipo,
    tipo_documento: tipoDoc,
    numero: numero,
    numero_documento: numeroDoc || null,
    periodo_apuracao: periodoApuracao || null,
    data_emissao: parsed.data_emissao || null,
    data_vencimento: due,
    emitente_nome: parsed.emitente_nome || '',
    emitente_cnpj: String(parsed.emitente_cnpj || '').replace(/\D/g, ''),
    destinatario_nome: parsed.destinatario_nome || '',
    destinatario_cnpj: String(parsed.destinatario_cnpj || '').replace(/\D/g, ''),
    parte,
    descricao: desc,
    desc_full: descFull,
    valor: val,
    moeda,
    valor_original: valorOrig,
    cotacao_ptax: cotacao ? (isSaida ? cotacao.compra : cotacao.venda) : null,
    cotacao_tipo: cotacao ? (isSaida ? 'compra' : 'venda') : null,
    data_cotacao: cotacao ? cotacao.dataCotacao : null,
    categoria_sugerida: isSaida ? '' : await mapNFCategoria(parsed, isSaida),
    target_table: targetTable,
    is_saida: isSaida,
    anexo: base64,
    anexoNome: att.filename,
    anexoTipo: att.mimeType,
    // Rastreabilidade: dá pra saber depois se o arquivo veio de anexo MIME ou
    // foi baixado de um link do corpo, e de qual URL.
    origem_anexo: att.origem === 'link' ? 'link' : 'mime',
    origem_url: att.origem === 'link' ? att.url : null,
  };
  const { error } = await getSupabase().from('nf_pending').insert({
    id: pendingId,
    user_id: process.env.POLIMATA_USER_ID,
    status: 'pendente',
    origem: 'email',
    data: pendingData,
  });
  if (error) throw new Error(`Insert nf_pending: ${error.message}`);

  // Log em nf_history pra auditoria
  const nfId = crypto.randomUUID();
  await getSupabase().from('nf_history').insert({
    id: nfId, user_id: process.env.POLIMATA_USER_ID,
    data: {
      id: nfId, date: today,
      fileName: att.filename,
      tipo: parsed.tipo,
      tipo_documento: tipoDoc,
      numero: numero || null,
      numero_documento: numeroDoc || null,
      periodo_apuracao: periodoApuracao || null,
      origem_anexo: att.origem === 'link' ? 'link' : 'mime',
      parte, valor: val,
      status: 'Aguardando aprovação (nf_pending)',
      pending_id: pendingId,
    },
  });

  return pendingId;
}

// Período de apuração sempre em YYYY-MM. A IA às vezes devolve "08/2026" ou a
// data cheia; o que não vier reconhecível vira string vazia (melhor sem campo
// do que com campo errado, que estragaria o dedup).
function normalizarPeriodo(valor) {
  const s = String(valor || '').trim();
  const formatos = [
    /^(\d{4})-(\d{2})$/,          // 2026-08
    /^(\d{4})-(\d{2})-\d{2}$/,    // 2026-08-31
    /^(\d{4})\/(\d{2})$/,         // 2026/08
  ];
  for (const re of formatos) {
    const m = re.exec(s);
    if (m) return mesValido(m[1], m[2]);
  }
  const mBr = /^(\d{1,2})[/-](\d{4})$/.exec(s); // 08/2026
  if (mBr) return mesValido(mBr[2], mBr[1]);
  // "agosto/2026", "agosto de 2026" — rede de segurança caso a IA não converta.
  const semAcento = s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const mNome = /^([a-z]{3,})\s*(?:\/|-|\s+de\s+|\s+)\s*(\d{4})$/.exec(semAcento);
  if (mNome) {
    const meses = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    const idx = meses.indexOf(mNome[1].slice(0, 3));
    if (idx >= 0) return mesValido(mNome[2], String(idx + 1));
  }
  return '';
}
function mesValido(ano, mes) {
  const n = parseInt(mes, 10);
  return n >= 1 && n <= 12 ? `${ano}-${String(n).padStart(2, '0')}` : '';
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

// Categorias do plano de contas (lidas uma vez por execução). Só sugerimos
// categoria que EXISTE lá: sugestão inventada vira lançamento fora do plano,
// que some da DRE sem ninguém perceber.
let _catsPlano = null;
async function categoriasDoPlano() {
  if (_catsPlano) return _catsPlano;
  const { data } = await getSupabase().from('plano_contas').select('tipo,categoria');
  _catsPlano = new Map();
  for (const r of data || []) _catsPlano.set(`${r.tipo}|${(r.categoria || '').toLowerCase()}`, r.categoria);
  return _catsPlano;
}

// Sugere categoria para a NF. Guias de imposto têm destino conhecido; o resto
// depende do que o modelo leu. Nada que não esteja no plano passa — sem
// sugestão, o lançamento nasce sem categoria e vai para a Escrituração.
async function mapNFCategoria(nf, isSaida) {
  const cats = await categoriasDoPlano();
  const tipo = isSaida ? 'Entrada' : 'Saída';
  const ok = (nome) => cats.get(`${tipo}|${String(nome || '').toLowerCase()}`) || '';
  const td = (nf.tipo_documento || '').toUpperCase();
  if (td === 'DAS') return ok('Impostos sobre Receita');
  if (['DARF', 'GPS'].includes(td)) return ok('Impostos sobre Folha');
  return ok(nf.categoria);
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
