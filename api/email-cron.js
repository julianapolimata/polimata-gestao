// Serverless cron endpoint — lê emails do alias financeiro@polimatagrc.com.br,
// extrai NFs/guias dos anexos via IA, e cria lançamentos automaticamente.
// Acionado pelo GitHub Actions a cada 15 minutos com Bearer CRON_SECRET.

import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { lerXmlFiscal, notaCanceladaNoXml } from '../lib/xmlFiscal.js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://euktswsroqgvewzqappq.supabase.co';
const POLIMATA_CNPJ = '48948776000164';
// Endereço que recebe as notas. A verdade é a configuração DA EMPRESA
// (config_empresa.data.email_entrada) — cada empresa tem o seu. A variável de
// ambiente fica só como valor inicial/emergência.
const GMAIL_TARGET_ALIAS_ENV = process.env.GMAIL_TARGET_ALIAS || '';
let _aliasCache = null;
async function emailDeEntrada() {
  if (_aliasCache !== null) return _aliasCache;
  try {
    const { data } = await getSupabase()
      .from('config_empresa').select('data')
      .eq('user_id', process.env.POLIMATA_USER_ID).maybeSingle();
    _aliasCache = (data?.data?.email_entrada || GMAIL_TARGET_ALIAS_ENV || '').trim();
  } catch (e) {
    console.warn('Não consegui ler o e-mail de entrada da configuração:', e.message);
    _aliasCache = GMAIL_TARGET_ALIAS_ENV;
  }
  return _aliasCache;
}

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
const escopoDestino = alias => (GMAIL_SO_ALIAS && alias ? `to:${alias} ` : '');
// Varrer tudo sem filtro encheria a fila de apresentação, contrato e foto. O
// documento fiscal é PDF ou XML — o resto nem é lido (economiza leitura de IA).
const EMAIL_TIPOS_ARQUIVO = listaDoEnv('EMAIL_TIPOS_ARQUIVO', 'pdf,xml');
const filtroArquivo = () => (EMAIL_TIPOS_ARQUIVO.length ? `(${EMAIL_TIPOS_ARQUIVO.map(t => `filename:${t}`).join(' OR ')}) ` : '');

function numeroDoEnv(nome, padrao) {
  const n = parseInt(process.env[nome] ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : padrao;
}

// ---------------------------------------------------------------------------
// Lixo que entrava na fila: ASSINATURA DE E-MAIL
// ---------------------------------------------------------------------------
// A busca do Gmail filtra por `filename:pdf OR filename:xml`, mas isso escolhe
// a MENSAGEM — não o anexo. O e-mail que traz a nota em PDF traz junto o
// logotipo do rodapé (image.png, Outlook-xxxxxxx.png), e o robô mandava cada um
// deles para a IA e criava pendência com valor R$ 0,00 e tipo "Outro".
// Regra: se a mensagem tem pdf/xml, só o pdf/xml é lido (a assinatura vem
// sempre junto do documento). Se não tem nenhum, a imagem só passa se for
// pesada — nota fotografada tem centenas de KB, logotipo de rodapé tem poucos.
const EMAIL_IMAGEM_MINIMA_BYTES = numeroDoEnv('EMAIL_IMAGEM_MINIMA_BYTES', 80000);

// Nomes com cara de assinatura/inline. Só valem para IMAGEM: um PDF chamado
// "logo-fiscal.pdf" continua sendo lido normalmente.
const NOMES_DE_ASSINATURA = [
  /^image\d*\./i,     // image.png, image001.png — inline clássico do Outlook
  /^outlook[-_]/i,    // Outlook-dqr14huu.png
  /^logo/i,
  /^assinatura/i,
];

// ---------------------------------------------------------------------------
// Orçamento de tempo (o 504 da Vercel)
// ---------------------------------------------------------------------------
// vercel.json corta esta função em 60 s e CADA anexo custa uma chamada de IA:
// um lote de 15–20 mensagens não cabe e a dona recebia "Erro: HTTP 504" sem
// nada salvo. Aqui o laço para sozinho antes do corte e devolve o lote parcial
// com sucesso; o que sobrou volta na próxima rodada (a etiqueta
// `polimata-processado` garante que o já lido não retorna).
// Tempo máximo da função na Vercel (vercel.json → functions.maxDuration).
// O orçamento tem que ser MENOR que ele, com folga para a resposta sair.
const EMAIL_LIMITE_FUNCAO_MS = numeroDoEnv('EMAIL_LIMITE_FUNCAO_MS', 300000);
const EMAIL_ORCAMENTO_MS = numeroDoEnv('EMAIL_ORCAMENTO_MS', Math.max(20000, EMAIL_LIMITE_FUNCAO_MS - 30000));
// Quanto tempo supor que uma mensagem leva, antes de ter medido alguma.
// Uma mensagem com vários anexos faz uma leitura de IA por anexo.
const EMAIL_CUSTO_MENSAGEM_MS = numeroDoEnv('EMAIL_CUSTO_MENSAGEM_MS', 25000);

// ---------------------------------------------------------------------------
// Quanto custa a leitura de IA (e o teto de gasto do mês)
// ---------------------------------------------------------------------------
// Cada anexo lido é uma chamada paga à Anthropic. A resposta traz quantos
// "tokens" entraram e saíram; aqui isso vira dinheiro, é convertido para real
// e gravado em `leituras_ia` — uma linha por leitura. Sem isso o custo fica
// invisível e só aparece na fatura do cartão no fim do mês.
//
// PREÇOS EM DÓLAR POR MILHÃO DE TOKENS. Tabela pública da Anthropic.
// >>> CONFERIR sempre que a Anthropic mudar preço ou quando o modelo usado
// >>> aqui mudar: é este número que vira o valor mostrado para a dona.
const PRECOS_IA = {
  'claude-sonnet-5':  { entrada: 3.00,  saida: 15.00 },
  'claude-haiku-4-5': { entrada: 1.00,  saida:  5.00 },
  'claude-opus-5':    { entrada: 5.00,  saida: 25.00 },
};
// Modelo que a tabela acima usa quando o modelo da resposta não está listado
// (ex.: trocamos o modelo e esquecemos de atualizar os preços). Nesse caso o
// custo é uma ESTIMATIVA e fica marcado como tal em meta.preco_estimado.
const PRECO_IA_FALLBACK = 'claude-sonnet-5';
// Modelo usado para ler os documentos.
const MODELO_IA = 'claude-sonnet-5';
// Registrado como "modelo" das leituras feitas direto do XML: aparecem no
// histórico com zero token e custo zero, que é o ponto.
const LEITOR_XML = 'leitor-xml';

// Teto de gasto do mês, em reais. Chegou no teto, a varredura para: melhor
// deixar e-mail para a próxima do que gastar sem limite. 0 (ou negativo)
// significa SEM TETO.
function tetoDoEnv() {
  const bruto = String(process.env.EMAIL_TETO_MENSAL_BRL ?? '').trim().replace(',', '.');
  if (!bruto) return 50;
  const n = Number(bruto);
  return Number.isFinite(n) ? n : 50;
}
const EMAIL_TETO_MENSAL_BRL = tetoDoEnv();
// null = sem teto (é assim que o retorno da função avisa a tela).
const TETO_MENSAL_BRL = EMAIL_TETO_MENSAL_BRL > 0 ? EMAIL_TETO_MENSAL_BRL : null;

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
  // Marco zero do orçamento de tempo: conta a partir da ENTRADA da requisição,
  // porque é daí que a Vercel conta os 60 s (auth, envs e OAuth já gastam).
  const t0 = Date.now();
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

    const result = await processEmails({ days, maxMsgs, reprocess, t0, mode: authedAsUser ? 'manual' : 'cron' });
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
  const t0 = (opts && opts.t0) || Date.now();
  const startedAt = new Date().toISOString();

  // Quanto já se gastou com leitura de IA neste mês. É o ponto de partida do
  // teto: a rodada vai somando o próprio custo aqui em cima e para quando
  // encostar no limite.
  const gasto = {
    tetoBrl: TETO_MENSAL_BRL,          // null = sem teto
    gastoMesBrl: await gastoIADoMes(),
    custoRodadaBrl: 0,
    custoRodadaUsd: 0,
    leituras: 0,
    tetoAtingido: false,
  };

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
    const alias = await emailDeEntrada();
    const query = `${escopoDestino(alias)}has:attachment ${filtroArquivo()}-label:polimata-processado newer_than:${days}d`;
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
        const queryLink = `${escopoDestino(alias)}(${fromExpr}) -label:polimata-processado newer_than:${days}d`;
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
    // Teto de tempo da rodada: o laço para sozinho antes do corte da Vercel.
    orcamento_ms: EMAIL_ORCAMENTO_MS,
    limite_funcao_ms: EMAIL_LIMITE_FUNCAO_MS,
    processadas: 0,
    interrompido_por_tempo: false,
    nao_processadas: 0,
    processed: 0,
    skipped: 0,
    // Descarte legítimo (assinatura de e-mail, "Outro" sem valor, duplicata):
    // não é erro — só não vira pendência.
    descartados: 0,
    anexos_ignorados: 0,
    errors: 0,
    details: []
  };

  // Tempo já gasto em autenticação e nas buscas do Gmail, fora do laço.
  const tEspera = Date.now() - t0;

  for (let i = 0; i < messageIds.length; i++) {
    const mid = messageIds[i];
    // TETO DE GASTO DO MÊS: chegou no limite (nesta rodada ou em rodadas
    // anteriores do mês), para a varredura aqui. O que sobrou volta quando o
    // mês virar ou quando a dona subir o teto.
    if (tetoEstourado(gasto)) {
      gasto.tetoAtingido = true;
      summary.nao_processadas = messageIds.length - i;
      console.log(`[teto] parando em ${i}/${messageIds.length}: gasto do mês R$ ${gasto.gastoMesBrl} de um teto de R$ ${gasto.tetoBrl}`);
      break;
    }
    // Orçamento de tempo: melhor devolver lote parcial com sucesso do que
    // morrer com 504 e não salvar nada. Uma vez dentro, a mensagem vai até o
    // fim (não deixamos e-mail pela metade) — por isso não basta perguntar
    // "já estourei?": é preciso caber a PRÓXIMA mensagem inteira. Sem essa
    // margem, uma mensagem iniciada perto do limite derruba a função (HTTP 504).
    const decorrido = Date.now() - t0;
    const custoEstimado = summary.processadas > 0
      ? Math.max(5000, Math.round((decorrido - tEspera) / summary.processadas))
      : EMAIL_CUSTO_MENSAGEM_MS;
    if (decorrido + custoEstimado > EMAIL_ORCAMENTO_MS) {
      summary.interrompido_por_tempo = true;
      summary.nao_processadas = messageIds.length - i;
      console.log(`[orçamento] parando em ${i}/${messageIds.length} após ${decorrido} ms (próxima custaria ~${custoEstimado} ms de ${EMAIL_ORCAMENTO_MS})`);
      break;
    }
    try {
      const result = await processMessage(accessToken, mid, labelId, gasto);
      summary.processadas += 1;
      summary.processed += result.lancamentos;
      if (result.lancamentos === 0) summary.skipped += 1;
      summary.descartados += result.descartados || 0;
      summary.anexos_ignorados += result.anexos_ignorados || 0;
      summary.details.push({ id: mid, status: 'ok', ...result });
    } catch (e) {
      summary.processadas += 1; // erro também consumiu tempo: entra na média
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

  // Parou no tempo → sempre há mais para a próxima rodada, mesmo que a busca
  // tenha trazido menos que o limite. A tela usa isto para continuar dizendo
  // "clique de novo para continuar de onde parou".
  if (summary.interrompido_por_tempo) summary.pode_ter_mais = true;
  summary.duracao_ms = Date.now() - t0;

  // ---- Quanto esta rodada custou de leitura de IA ----
  summary.leituras = gasto.leituras;              // quantas chamadas de IA aconteceram
  summary.custo_rodada_brl = gasto.custoRodadaBrl;
  summary.custo_rodada_usd = gasto.custoRodadaUsd;
  summary.gasto_mes_brl = gasto.gastoMesBrl;      // já inclui o custo desta rodada
  summary.teto_brl = gasto.tetoBrl;               // null = sem teto
  summary.teto_atingido = gasto.tetoAtingido;
  // Parou no teto → sobrou e-mail para depois, igual ao corte por tempo.
  if (gasto.tetoAtingido) summary.pode_ter_mais = true;

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
// Triagem de anexos — antes de gastar leitura de IA
// ============================================================================
function ehPdfOuXml(att) {
  const nome = String(att.filename || '').toLowerCase();
  const mime = String(att.mimeType || '').toLowerCase();
  return mime === 'application/pdf' || nome.endsWith('.pdf')
      || /xml/.test(mime) || nome.endsWith('.xml');
}

// Um anexo é XML pelo tipo declarado OU pela extensão. Vale a extensão porque
// vários emissores mandam a nota como "application/octet-stream" — e era por
// isso que a nota da prefeitura ia parar na IA mesmo tendo XML.
function ehAnexoXml(att) {
  return /xml/.test(String(att.mimeType || '').toLowerCase())
      || String(att.filename || '').toLowerCase().endsWith('.xml');
}

function ehImagem(att) {
  const nome = String(att.filename || '').toLowerCase();
  const mime = String(att.mimeType || '').toLowerCase();
  return mime.startsWith('image/') || /\.(png|jpe?g|gif|bmp|webp|tiff?)$/.test(nome);
}

function pareceAssinatura(nome) {
  const n = String(nome || '').trim();
  return NOMES_DE_ASSINATURA.some(re => re.test(n));
}

// Decide o que vai para a IA. Devolve { aceitos, ignorados } — os ignorados
// carregam o MOTIVO, que fica registrado em emails_processados para a dona
// poder conferir depois o que o robô deixou de lado e por quê.
function triarAnexos(brutos) {
  const ignorados = [];
  // O XML vem primeiro de propósito: quando o e-mail traz PDF e XML da mesma
  // nota, quem for lido primeiro cria a pendência e o outro é descartado como
  // duplicata. Lendo o XML antes, a leitura sai de graça e exata.
  const docs = brutos.filter(ehPdfOuXml).sort((a, b) => (ehAnexoXml(b) ? 1 : 0) - (ehAnexoXml(a) ? 1 : 0));

  // Tem documento de verdade: a imagem que veio junto é a assinatura.
  if (docs.length) {
    for (const a of brutos) {
      if (docs.includes(a)) continue;
      ignorados.push({
        filename: a.filename || '(sem nome)',
        bytes: Number(a.bytes || 0),
        motivo: 'imagem_em_email_com_pdf_ou_xml'
      });
    }
    return { aceitos: docs, ignorados };
  }

  // Só imagem: pode ser nota fotografada — ou só o rodapé da assinatura.
  const aceitos = [];
  for (const a of brutos) {
    const nome = a.filename || '(sem nome)';
    const bytes = Number(a.bytes || 0);
    if (!ehImagem(a)) {
      ignorados.push({ filename: nome, bytes, motivo: 'tipo_nao_fiscal' });
      continue;
    }
    if (pareceAssinatura(nome)) {
      ignorados.push({ filename: nome, bytes, motivo: 'nome_de_assinatura' });
      continue;
    }
    // bytes === 0 significa tamanho desconhecido: na dúvida, lê (perder uma
    // nota fotografada é pior do que gastar uma leitura de IA).
    if (bytes && bytes < EMAIL_IMAGEM_MINIMA_BYTES) {
      ignorados.push({ filename: nome, bytes, motivo: 'imagem_pequena' });
      continue;
    }
    aceitos.push(a);
  }
  return { aceitos, ignorados };
}

// A IA leu, mas disse que não é documento fiscal: tipo "Outro" E sem valor.
// Esse é exatamente o retrato da assinatura de e-mail ("Assinatura de e-mail
// corporativo, sem informações fiscais"). Com valor > 0 continua entrando —
// pode ser fatura que o modelo não soube classificar.
function naoEhDocumentoFiscal(parsed) {
  const tipoDoc = String(parsed?.tipo_documento || '').trim().toLowerCase();
  const valor = parseFloat(parsed?.valor_total);
  const valorOrig = parseFloat(parsed?.valor_original);
  // valor_original entra como proteção: documento em moeda estrangeira pode vir
  // com valor_total 0 e o valor só no original — esse NÃO é descarte.
  const semValor = !(Number.isFinite(valor) && valor > 0)
                && !(Number.isFinite(valorOrig) && valorOrig > 0);
  return tipoDoc === 'outro' && semValor;
}

// Trilha do que NÃO virou pendência. Sem isto o descarte seria invisível e
// ninguém saberia que o robô viu o arquivo e decidiu não criar nada.
async function registrarDescarte({ att, parsed, status, motivo, detalhe, parte, valor }) {
  const today = new Date().toISOString().slice(0, 10);
  const nfId = crypto.randomUUID();
  const { error } = await getSupabase().from('nf_history').insert({
    id: nfId, user_id: process.env.POLIMATA_USER_ID,
    data: {
      id: nfId, date: today,
      fileName: att?.filename || null,
      tipo: parsed?.tipo || null,
      tipo_documento: parsed?.tipo_documento || null,
      numero: parsed?.numero_nf || null,
      parte: parte || parsed?.emitente_nome || parsed?.destinatario_nome || null,
      valor: Number.isFinite(Number(valor)) ? Number(valor) : (parseFloat(parsed?.valor_total) || 0),
      status,
      motivo,
      detalhe: detalhe || null,
      descricao_ia: String(parsed?.descricao || '').slice(0, 300),
      origem_anexo: att?.origem === 'link' ? 'link' : 'mime',
    },
  });
  if (error) console.warn(`[descarte] nf_history falhou (${motivo}):`, error.message);
}

// ============================================================================
// Processamento de mensagem individual
// ============================================================================
async function processMessage(accessToken, messageId, labelId, gasto) {
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
  const brutos = [];
  function walk(parts) {
    if (!parts) return;
    for (const p of parts) {
      if (p.parts) walk(p.parts);
      const filename = p.filename || '';
      const mimeType = p.mimeType || '';
      const ehXml = /xml/i.test(mimeType) || filename.toLowerCase().endsWith('.xml');
      if (p.body?.attachmentId &&
          (mimeType === 'application/pdf' || mimeType.startsWith('image/') || ehXml)) {
        // O tamanho vem no próprio índice da mensagem: dá para descartar a
        // assinatura SEM baixar o anexo e sem gastar leitura de IA.
        brutos.push({ attachmentId: p.body.attachmentId, filename, mimeType, bytes: Number(p.body.size || 0) });
      }
    }
  }
  walk(msg.payload?.parts);
  // Caso especial: payload é o próprio anexo (sem parts)
  if (!brutos.length && msg.payload?.body?.attachmentId) {
    const mt = msg.payload.mimeType || '';
    const fn = msg.payload.filename || '';
    if (mt === 'application/pdf' || mt.startsWith('image/') || /xml/i.test(mt) || fn.toLowerCase().endsWith('.xml')) {
      brutos.push({
        attachmentId: msg.payload.body.attachmentId,
        filename: fn || 'anexo',
        mimeType: mt,
        bytes: Number(msg.payload.body.size || 0)
      });
    }
  }

  // Triagem ANTES da IA: a assinatura do rodapé para aqui.
  const { aceitos, ignorados: anexosIgnorados } = triarAnexos(brutos);
  const attachments = aceitos;
  if (anexosIgnorados.length) {
    console.log(`[triagem] ${messageId}: ignorados ${anexosIgnorados.map(i => `${i.filename} (${i.motivo})`).join(', ')}`);
  }

  // ---- Sem anexo MIME: tenta os LINKS do corpo (portais tipo G-Click) ----
  // Só entra aqui quando não veio anexo NENHUM; se veio e a triagem descartou
  // tudo (mensagem só com assinatura), NÃO é caso de procurar link no corpo.
  let linksVistos = 0;
  const linksRecusados = [];
  const linksBaixados = [];
  if (!brutos.length) {
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
    // Mensagem que só tinha assinatura é DESCARTE, não falha: status próprio
    // (fora da lista de FALHOS) para não voltar a cada reprocessamento.
    const soLixo = anexosIgnorados.length > 0;
    await applyLabel(accessToken, messageId, labelId);
    await persistEmailHistory({
      gmail_message_id: messageId, subject, from, date,
      status: soLixo ? 'descartado' : 'sem_anexo',
      motivo: soLixo ? 'anexos_ignorados_na_triagem' : null,
      anexos_ignorados: anexosIgnorados.length,
      anexos_ignorados_detalhe: anexosIgnorados,
      links_vistos: linksVistos,
      links_recusados: linksRecusados.length,
      links_recusas: linksRecusados,
      processed_at: new Date().toISOString().slice(0, 10)
    });
    return {
      lancamentos: 0,
      message: soLixo ? 'anexos ignorados na triagem (assinatura/imagem leve)' : 'sem anexos PDF/imagem',
      anexos_ignorados: anexosIgnorados.length,
      links_vistos: linksVistos,
      links_recusados: linksRecusados.length
    };
  }

  // Processa cada anexo
  let lancamentosCount = 0;
  let descartadosCount = 0;
  let falhaTemporaria = false;
  const lancamentoIds = [];

  for (const att of attachments) {
    // TETO DE GASTO: chegou no limite do mês, não lê mais nada. A triagem lá
    // em cima continua valendo — o teto é proteção contra VOLUME, não substituto
    // dela. O que sobrou volta na próxima rodada (sem etiqueta ainda).
    if (tetoEstourado(gasto)) {
      gasto.tetoAtingido = true;
      console.log(`[teto] gasto do mês R$ ${gasto.gastoMesBrl} atingiu o teto de R$ ${gasto.tetoBrl} — parando as leituras`);
      break;
    }

    // Preenchido assim que a leitura de IA acontece; é o que garante que o
    // consumo seja registrado mesmo quando o passo seguinte falha.
    let leituraInfo = null;
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

      let leitura;
      try {
        leitura = await lerDocumento(base64, att);
        leituraInfo = {
          modelo: leitura?.modelo || MODELO_IA,
          usage: leitura?.usage || null,
          origem: att.origem === 'link' ? 'link' : 'email',
          arquivo: att.filename,
          gmailMessageId: messageId,
          resultado: 'descartado',   // vira 'documento' se gerar pendência
          meta: null,
        };
      } catch (e) {
        // A chamada falhou: registra tokens 0 e o motivo, e segue o fluxo de erro.
        leituraInfo = {
          modelo: MODELO_IA,
          usage: null,
          origem: att.origem === 'link' ? 'link' : 'email',
          arquivo: att.filename,
          gmailMessageId: messageId,
          resultado: 'erro',
          meta: { erro: String(e.message || e).slice(0, 300) },
        };
        throw e;
      }

      const parsed = leitura.parsed;
      if (!parsed) {
        leituraInfo.meta = { motivo: leitura.motivo || 'resposta_nao_json' };
        continue;
      }

      // 2ª trava: a própria IA disse que não é documento fiscal ("Outro" sem
      // valor). Não vira pendência — vira trilha em nf_history.
      if (naoEhDocumentoFiscal(parsed)) {
        descartadosCount++;
        leituraInfo.meta = { motivo: 'nao_e_documento_fiscal' };
        console.log(`[descarte] ${att.filename}: nao_e_documento_fiscal (${parsed.tipo_documento || 'sem tipo'}, R$ ${parsed.valor_total || 0})`);
        await registrarDescarte({
          att, parsed,
          status: 'descartado',
          motivo: 'nao_e_documento_fiscal',
          detalhe: `tipo_documento="${parsed.tipo_documento || ''}" e valor 0`
        });
        continue;
      }

      const lancamentoId = await createLancamento(parsed, att, base64);
      if (lancamentoId) {
        lancamentosCount++;
        lancamentoIds.push(lancamentoId);
        leituraInfo.resultado = 'documento';
      } else {
        // Documento era, mas já existia (duplicata) — não virou pendência nova.
        leituraInfo.meta = { motivo: 'duplicata_ou_ja_vinculado' };
      }
    } catch (e) {
      if (ehFalhaTemporaria(e.message)) falhaTemporaria = true;
      console.warn(`Falha em anexo ${att.filename}:`, e.message);
    } finally {
      // Houve chamada de IA → o gasto entra na conta, deu certo ou não.
      if (leituraInfo) await contabilizarLeitura(gasto, leituraInfo);
    }
  }

  // Só falhou porque o serviço de leitura estava fora: nada foi concluído
  // sobre este e-mail. Sem etiqueta, ele volta na próxima rodada por conta
  // própria — em vez de ficar parado esperando alguém mandar reprocessar.
  const soFalhouPorServico = falhaTemporaria && lancamentosCount === 0 && descartadosCount === 0;
  if (soFalhouPorServico) {
    console.log(`[tentar de novo] ${messageId} fica sem etiqueta: a leitura falhou por indisponibilidade, não pelo documento`);
  } else {
    await applyLabel(accessToken, messageId, labelId);
  }

  // Nada criado MAS houve descarte legítimo → 'descartado', não 'sem_lancamento'
  // (que está na lista de FALHOS e voltaria a cada reprocessamento).
  const statusMsg = soFalhouPorServico
    ? 'error'
    : lancamentosCount > 0
      ? 'ok'
      : (descartadosCount || anexosIgnorados.length) ? 'descartado' : 'sem_lancamento';

  await persistEmailHistory({
    gmail_message_id: messageId, subject, from, date,
    status: statusMsg,
    lancamentos_ids: lancamentoIds,
    n_anexos: attachments.length,
    n_anexos_link: linksBaixados.length,
    anexos_ignorados: anexosIgnorados.length,
    anexos_ignorados_detalhe: anexosIgnorados,
    anexos_descartados: descartadosCount,
    links_vistos: linksVistos,
    links_recusados: linksRecusados.length,
    links_recusas: linksRecusados,
    processed_at: new Date().toISOString().slice(0, 10)
  });

  return {
    lancamentos: lancamentosCount,
    lancamentoIds,
    descartados: descartadosCount,
    anexos_ignorados: anexosIgnorados.length,
    ...(linksVistos ? { links_vistos: linksVistos, links_baixados: linksBaixados.length, links_recusados: linksRecusados.length } : {})
  };
}

// ============================================================================
// Anthropic — parse do documento (com retry em overload)
// ============================================================================
// A falha foi do SERVIÇO, não do documento? Sem saldo, sobrecarga, limite de
// uso, tempo esgotado ou rede caída — em todos esses casos o documento nunca
// chegou a ser lido, e desistir dele seria perder a nota por um problema que
// já passou.
function ehFalhaTemporaria(mensagem) {
  const m = String(mensagem || '').toLowerCase();
  return /credit balance|insufficient|overloaded|rate.?limit|too many requests|timeout|timed out|socket|econn|enotfound|fetch failed|502|503|504|529/.test(m);
}

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

// Lê o documento — XML primeiro, IA depois.
//
// Nota fiscal em XML já traz cada dado em um campo com nome próprio. Ler
// direto é exato e não custa nada; mandar para a IA é pagar para ela adivinhar
// o que já está escrito. A IA continua entrando quando o arquivo não é XML, ou
// quando o XML não entrega tudo com segurança — aí lerXmlFiscal devolve null
// de propósito, e nada muda em relação a antes.
async function lerDocumento(base64, att) {
  const mimeType = att?.mimeType || '';
  if (ehAnexoXml(att || {})) {
    let texto = '';
    try {
      const bytes = Buffer.from(base64, 'base64');
      texto = bytes.toString('utf8');
      // O XML diz no cabeçalho em que codificação foi escrito. Ler um arquivo
      // ISO-8859-1 como UTF-8 estraga todo acento — e é assim que nome de
      // fornecedor chega picotado no sistema.
      if (/encoding=["']?(iso-8859-1|latin1|windows-1252)/i.test(texto.slice(0, 300))) {
        texto = bytes.toString('latin1');
      }
    } catch { texto = ''; }
    if (texto && notaCanceladaNoXml(texto)) {
      console.log('[xml] nota CANCELADA — não vira lançamento e não vai para a IA');
      return { parsed: null, usage: null, modelo: LEITOR_XML, motivo: 'nota_cancelada' };
    }
    const parsed = texto ? lerXmlFiscal(texto, { cnpjEmpresa: POLIMATA_CNPJ }) : null;
    if (parsed) {
      console.log(`[xml] ${parsed.tipo_documento} ${parsed.numero_nf} lida direto do XML — sem IA, custo zero`);
      return { parsed, usage: null, modelo: LEITOR_XML };
    }
    console.log('[xml] o XML não entregou todos os campos com segurança — lendo com IA');
    // Vai para a IA como texto, mesmo que o emissor tenha declarado o arquivo
    // como binário — senão ela recebe um borrão em vez do conteúdo.
    return parseDocumentWithAI(base64, 'application/xml');
  }
  return parseDocumentWithAI(base64, mimeType);
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
      model: MODELO_IA,
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
  // O consumo vem na própria resposta (quantos tokens entraram e saíram).
  // Antes era descartado — é dele que sai o custo em reais.
  const usage = data.usage || null;
  const modelo = data.model || MODELO_IA;
  const text = data.content[0].text.trim().replace(/```json|```/g, '').trim();
  try {
    return { parsed: JSON.parse(text), usage, modelo };
  } catch (e) {
    console.warn('Resposta não-JSON da IA:', text.slice(0, 200));
    // A leitura ACONTECEU e foi cobrada mesmo sem JSON válido: devolve o
    // consumo do mesmo jeito, senão esse gasto sumiria da conta.
    return { parsed: null, usage, modelo };
  }
}

// ============================================================================
// Custo da leitura de IA — cálculo, conversão para real e registro
// ============================================================================

// Tokens → dólares, pela tabela PRECOS_IA.
function calcularCustoUSD(modelo, inputTokens, outputTokens) {
  const conhecido = Object.prototype.hasOwnProperty.call(PRECOS_IA, modelo);
  const preco = conhecido ? PRECOS_IA[modelo] : PRECOS_IA[PRECO_IA_FALLBACK];
  const usd = (inputTokens / 1e6) * preco.entrada + (outputTokens / 1e6) * preco.saida;
  return { custoUsd: +usd.toFixed(6), precoEstimado: !conhecido };
}

// Grava UMA linha em leituras_ia. Nunca derruba o processamento: se o registro
// do consumo falhar, o e-mail continua sendo processado e a falha só vai para
// o console (a tabela é histórico de gasto, não parte do fluxo do documento).
async function registrarConsumoIA({ modelo, usage, origem, arquivo, gmailMessageId, resultado, meta }) {
  const vazio = { custoUsd: 0, custoBrl: 0 };
  try {
    const inputTokens = Math.max(0, Number(usage?.input_tokens) || 0);
    const outputTokens = Math.max(0, Number(usage?.output_tokens) || 0);
    const modeloUsado = modelo || MODELO_IA;
    const { custoUsd, precoEstimado } = calcularCustoUSD(modeloUsado, inputTokens, outputTokens);

    const metaFinal = { ...(meta || {}) };
    // Sem token não houve cobrança: não há preço a estimar (é o caso do XML
    // lido direto, que entra no histórico com custo zero de verdade).
    const houveTokens = inputTokens > 0 || outputTokens > 0;
    if (precoEstimado && houveTokens) metaFinal.preco_estimado = true;

    // Dólar do dia pela PTAX (mesma função das notas em moeda estrangeira, com
    // cache). Gasto nosso é despesa → taxa de VENDA.
    let cotacaoUsd = null;
    let custoBrl = 0;
    if (custoUsd > 0) {
      try {
        const ptax = await fetchPTAX('USD', new Date().toISOString().slice(0, 10));
        const taxa = Number(ptax?.venda ?? ptax?.compra);
        if (Number.isFinite(taxa) && taxa > 0) {
          cotacaoUsd = +taxa.toFixed(4);
          custoBrl = +(custoUsd * taxa).toFixed(4);
        } else {
          metaFinal.sem_cotacao = true;
        }
      } catch (e) {
        // Sem cotação o custo em dólar é gravado assim mesmo — nunca deixamos
        // a falta de cotação derrubar (ou apagar) a leitura.
        metaFinal.sem_cotacao = true;
        metaFinal.motivo_sem_cotacao = String(e.message || e).slice(0, 200);
      }
    }

    const { error } = await getSupabase().from('leituras_ia').insert({
      user_id: process.env.POLIMATA_USER_ID,
      modelo: modeloUsado,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      custo_usd: custoUsd,
      cotacao_usd: cotacaoUsd,
      custo_brl: custoBrl,
      origem: origem === 'link' ? 'link' : 'email',
      arquivo: arquivo || null,
      gmail_message_id: gmailMessageId || null,
      resultado,
      meta: Object.keys(metaFinal).length ? metaFinal : null,
    });
    if (error) console.warn('[custo-ia] não consegui gravar a leitura:', error.message);

    // Mesmo se a gravação falhou, o gasto EXISTIU: devolve para o teto contar.
    return { custoUsd, custoBrl };
  } catch (e) {
    console.warn('[custo-ia] falha ao registrar consumo:', e.message);
    return vazio;
  }
}

// Registra o consumo e soma no acumulado da rodada (é o que faz o teto valer
// também no meio da própria execução, não só entre execuções).
async function contabilizarLeitura(gasto, dados) {
  const { custoUsd, custoBrl } = await registrarConsumoIA(dados);
  if (!gasto) return;
  gasto.leituras += 1;
  gasto.custoRodadaUsd = +(gasto.custoRodadaUsd + custoUsd).toFixed(6);
  gasto.custoRodadaBrl = +(gasto.custoRodadaBrl + custoBrl).toFixed(4);
  gasto.gastoMesBrl = +(gasto.gastoMesBrl + custoBrl).toFixed(4);
}

// Já chegou no teto? (teto null = sem teto)
function tetoEstourado(gasto) {
  return !!(gasto && gasto.tetoBrl !== null && gasto.gastoMesBrl >= gasto.tetoBrl);
}

// Quanto já foi gasto com leitura de IA no mês corrente (consulta direta,
// somando em memória). Se a consulta falhar, assume 0 e avisa no console —
// não é motivo para a rodada inteira parar.
async function gastoIADoMes() {
  const agora = new Date();
  const inicioMes = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1)).toISOString();
  try {
    const { data, error } = await getSupabase()
      .from('leituras_ia')
      .select('custo_brl')
      .eq('user_id', process.env.POLIMATA_USER_ID)
      .gte('created_at', inicioMes);
    if (error) throw new Error(error.message);
    const total = (data || []).reduce((s, r) => s + (Number(r.custo_brl) || 0), 0);
    return +total.toFixed(4);
  } catch (e) {
    console.warn('[custo-ia] não consegui somar o gasto do mês:', e.message);
    return 0;
  }
}

// ============================================================================
// Cria entrada em nf_pending (humano aprova depois). v2 — antes criava
// lançamento direto em receivable/payable; agora passa por fila de aprovação
// pra evitar fornecedores fragmentados, categoria errada, número faltando.
// ============================================================================
// Troca o XML guardado pelo PDF do mesmo documento. O XML é ótimo para ler
// e péssimo para olhar; o PDF é a cara da nota. Só acontece quando a pendência
// ainda não foi decidida e o arquivo que chegou é mesmo um PDF.
async function preferirPdfNoAnexo(pendente, att, base64) {
  const atual = String(pendente?.data?.anexoNome || '').toLowerCase();
  const chegouPdf = String(att.mimeType || '').toLowerCase() === 'application/pdf'
    || String(att.filename || '').toLowerCase().endsWith('.pdf');
  if (!chegouPdf || !atual.endsWith('.xml')) return;
  const { error } = await getSupabase().from('nf_pending').update({
    data: {
      ...(pendente.data || {}),
      anexo: base64,
      anexoNome: att.filename,
      anexoTipo: att.mimeType,
      // Fica registrado de onde saíram os dados, que não é o arquivo guardado.
      lido_do_xml: pendente.data?.anexoNome || null,
    },
  }).eq('id', pendente.id);
  if (error) console.warn('[anexo] não consegui trocar o XML pelo PDF:', error.message);
  else console.log(`[anexo] ${att.filename} passou a ser o anexo da pendência ${pendente.id} (leitura veio do XML)`);
}

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

  // ── Dedup do MESMO documento chegando em DOIS FORMATOS ───────────────────
  // A NFS-e veio como "...-nfse.pdf" e "...-nfse.xml" no mesmo e-mail e virou
  // duas pendências. O `dupPend` abaixo casa por PARTE, e parte depende da
  // direção que a IA deduziu — a leitura do PDF e a do XML podem divergir no
  // nome (e até na direção), e aí o dedup não pegava. Aqui a chave é a
  // identidade do documento, independente de direção: número + valor (±0,02) +
  // emitente. Mesmo padrão do dedup de guia acima, reaproveitando as MESMAS
  // consultas (`pendentes` e `candidates`) — nenhuma query nova.
  const numeroDigitos = numeroLower.replace(/\D/g, '');
  const emitNomeLower = String(parsed.emitente_nome || '').toLowerCase().trim();
  if (numeroLower) {
    const mesmoDocumento = (d) => {
      if (!d) return false;
      const dn = String(d.numero ?? d.numero_nf ?? '').trim().toLowerCase();
      const numeroBate = (!!dn && dn === numeroLower)
        || (!!numeroDigitos && dn.replace(/\D/g, '') === numeroDigitos);
      if (!numeroBate) return false;
      if (Math.abs(Number(d.valor ?? d.value ?? 0) - val) > 0.02) return false;
      const dCnpj = String(d.emitente_cnpj || d.cnpj || '').replace(/\D/g, '');
      const dNome = String(d.emitente_nome || '').toLowerCase().trim();
      if (emitCnpj && dCnpj) return dCnpj === emitCnpj;            // CNPJ manda
      if (emitNomeLower && dNome) return dNome === emitNomeLower;  // senão, nome
      return !emitCnpj && !emitNomeLower;  // sem emitente dos dois lados: nº+valor bastam
    };
    const docPend = (pendentes || []).find(p => mesmoDocumento(p.data));
    const docLanc = (candidates || []).find(c => {
      const item = c.data || {};
      if (mesmoDocumento(item)) return true;
      // Lançamento já aprovado guarda o número dentro da descrição. Exige
      // número razoavelmente longo + valor idêntico pra não casar por acaso.
      if (numeroLower.length < 4) return false;
      if (!String(item.desc || '').toLowerCase().includes(numeroLower)) return false;
      return Math.abs(Number(item.value ?? item.valor ?? 0) - val) <= 0.02;
    });
    if (docPend || docLanc) {
      // A leitura veio do XML, mas quem abre a pendência precisa VER a nota.
      if (docPend) await preferirPdfNoAnexo(docPend, att, base64);
      const onde = docPend ? `nf_pending ${docPend.id}` : `${targetTable} ${docLanc.id}`;
      console.log(`[dedup-formato] ${tipoDoc} ${numero} (R$ ${val}) já registrada (${onde}) — pulando ${att.filename}`);
      await registrarDescarte({
        att, parsed, parte, valor: val,
        status: 'duplicado',
        motivo: 'duplicado_mesmo_documento',
        detalhe: `mesmo número + valor + emitente já em ${onde}`
      });
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
