// =============================================================================
// Reconhece o PAPEL dos documentos que JÁ estão na caixa de entrada.
//
// O reconhecedor por marcadores (lib/papelDocumento.js) entrou no robô, mas só
// age no que chega daqui pra frente. Os documentos que já estavam na fila
// continuariam todos iguais — e são exatamente eles que estão na tela hoje,
// incluindo os três de R$ 932,31 e os três de R$ 10.319,71.
//
// CUSTO ZERO: nenhuma chamada de IA. O texto é extraído do PDF aqui mesmo
// (lib/peneiraPdf.js → extrairDoPdf) e os marcadores são lidos desse texto.
// Por isso o lote pode ser grande — o limite é o tempo da Vercel, não dinheiro.
//
// POR QUE PELO TEXTO E NÃO PELO NOME: nestes próprios documentos há a prova de
// que o nome não serve. "Recibo_1201_062026.pdf" é o recibo da DCTFWeb (prova),
// e "1201_Recibo_mensal_ 202604.pdf" é o recibo de pró-labore (desembolso de
// verdade). Os dois nomes têm as mesmas palavras em ordem diferente.
//
// Acionado manualmente com Bearer CRON_SECRET, ou pelo app com o JWT da usuária.
// Re-executável: por padrão só mexe em quem ainda não tem papel; com ?tudo=1
// refaz todos (útil quando um marcador novo é acrescentado).
//
// MODO SECO (?seco=1): relata o que reconheceria e NÃO grava nada. É assim que
// se confere o reconhecedor contra os documentos de verdade antes de deixá-lo
// escrever — os PDFs do contador vêm comprimidos, então nenhuma inspeção por
// fora do código diz se os marcadores estão sendo achados.
// =============================================================================

import { createClient } from '@supabase/supabase-js';
import { extrairDoPdf } from '../lib/peneiraPdf.js';
import { reconhecerPapel } from '../lib/papelDocumento.js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://euktswsroqgvewzqappq.supabase.co';
// Sem IA no caminho, o gargalo é só baixar os base64. 25 por chamada cabe
// folgado nos 60 s da Vercel; o retorno diz quantos ainda faltam.
const MAX_POR_RODADA = 25;

/**
 * O texto reduzido às PALAVRAS, para a amostra ser legível por um humano.
 *
 * Num PDF o começo do arquivo é cabeçalho e bytes comprimidos; uma amostra
 * tirada dali sai ilegível mesmo quando a leitura funcionou perfeitamente —
 * foi assim que a primeira amostra enganou. Guardando só as sequências de
 * letras, a amostra mostra o que o documento DIZ, e o silêncio passa a
 * significar de verdade que não há texto nenhum.
 */
const palavrasDe = texto =>
  (String(texto || '').match(/[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'-]{2,}/g) || []).join(' ');

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

export default async function handler(req, res) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) return res.status(500).json({ error: 'CRON_SECRET ausente no servidor' });
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    const token = auth.slice(7);
    if (token !== cronSecret) {
      // Também aceita o JWT da usuária, para a tela poder acionar.
      const { data: u } = await getSupabase().auth.getUser(token);
      if (!u?.user) return res.status(401).json({ error: 'Unauthorized' });
    }

    const refazerTudo = String(req.query?.tudo || '') === '1';
    const seco = String(req.query?.seco || '') === '1';
    // Só o que está na fila: documento já aprovado virou lançamento e o papel
    // dele não muda mais nada. Rejeitado, menos ainda.
    const { data: linhas, error } = await getSupabase()
      .from('nf_pending')
      .select('id, data')
      .eq('status', 'pendente')
      .order('created_at', { ascending: true });
    if (error) throw new Error(`Leitura nf_pending: ${error.message}`);

    const candidatas = (linhas || []).filter(l => {
      const d = l.data || {};
      if (!d.anexo) return false;                       // sem arquivo não há texto para ler
      if (!refazerTudo && d.papel_documento) return false;
      // Já tentado e não reconhecido (tem amostra guardada): não entra de novo,
      // senão o lote reprocessaria sempre os mesmos 25 e nunca chegaria no fim.
      // Quando marcadores novos forem acrescentados, é o ?tudo=1 que relê estes.
      if (!refazerTudo && d.papel_amostra !== undefined) return false;
      return true;
    });

    const lote = candidatas.slice(0, MAX_POR_RODADA);
    const decididos = [];
    const semMarcador = [];

    for (const linha of lote) {
      const d = linha.data || {};
      const nome = d.anexoNome || d.fileName || '';
      let papel = null;
      let leitura = null;

      if (/\.xml$/i.test(nome) || String(d.anexoTipo || '').includes('xml')) {
        // Nota em XML: foi o leitor de XML que a validou (número, valor, partes
        // e CNPJ da empresa). Não há o que reconhecer — é nota fiscal.
        papel = { papel: 'documento_fiscal', marcadores: null, origem: 'xml' };
      } else {
        try { leitura = extrairDoPdf(Buffer.from(d.anexo, 'base64')); } catch { leitura = null; }
        // Só o texto VISÍVEL da página: procurar marcador no arquivo inteiro
        // casa por acaso dentro dos blocos binários (ver lib/peneiraPdf.js).
        const r = leitura?.visivel ? reconhecerPapel(leitura.visivel, nome) : null;
        if (r) papel = { papel: r.papel, marcadores: r.marcadores, origem: 'marcadores' };
      }

      if (!papel) {
        // Não reconheceu: fica como está. Um papel chutado é pior que nenhum,
        // porque erra com a autoridade de quem é determinístico.
        //
        // Mas guarda uma AMOSTRA do que leu. A primeira lista de marcadores
        // foi escrita de cabeça, a partir do que se supõe que um documento do
        // eSocial diga — e acertou 7 de 43 PDFs. A amostra é o que troca esse
        // chute por medição: a lista definitiva sai dos documentos reais do
        // contador, não da suposição de quem escreveu o código.
        //
        // Ela também separa as duas falhas possíveis, que pedem consertos
        // opostos: amostra ilegível = a EXTRAÇÃO falhou; amostra em português
        // legível = a extração foi bem e falta o MARCADOR.
        if (!seco) {
          await getSupabase().rpc('gravar_amostra_papel', {
            p_id: linha.id,
            // A amostra é feita de PALAVRAS, não dos primeiros caracteres: num
            // PDF o começo do arquivo é cabeçalho e bytes comprimidos, e uma
            // amostra tirada dali sai ilegível mesmo quando a leitura deu certo.
            // Juntando só as sequências de letras eu vejo o que o documento diz
            // — ou vejo que ele não diz nada, que é a outra resposta possível.
            p_amostra: palavrasDe(leitura?.visivel).slice(0, 600),
            p_chars: leitura?.visivel?.length || 0,
            p_diag: leitura
              ? { bytes: leitura.bytes, blocos: leitura.blocos, inflados: leitura.inflados, falhos: leitura.falhos }
              : null,          });
        }
        semMarcador.push({
          arquivo: nome,
          tipo_da_ia: d.tipo_documento || null,
          valor: d.valor ?? null,
          chars_lidos: leitura?.visivel?.length || 0,
          leitura: leitura ? leitura.inflados + "/" + leitura.blocos + " blocos abertos" : "nao li",
          amostra: palavrasDe(leitura?.visivel).slice(0, 200),
        });
        continue;
      }

      // A escrita passa pela função do banco, que faz o merge no jsonb. Ler a
      // linha, mexer no objeto e gravar de volta foi o que já destruiu 26
      // anexos neste sistema — aqui o anexo nunca é reescrito.
      if (!seco) {
        const { error: errGrav } = await getSupabase().rpc('gravar_papel_documento', {
          p_id: linha.id,
          p_papel: papel.papel,
          p_origem: papel.origem,
          p_marcadores: papel.marcadores,
        });
        if (errGrav) throw new Error(`gravar_papel_documento(${linha.id}): ${errGrav.message}`);
      }

      decididos.push({
        arquivo: nome,
        valor: d.valor ?? null,
        tipo_da_ia: d.tipo_documento || null,
        papel: papel.papel,
        vira_lancamento: !['comprovante', 'base_de_calculo', 'declaracao'].includes(papel.papel),
        marcadores: papel.marcadores,
      });
      console.log(`[papel] ${nome}: ${papel.papel} (${papel.origem}${papel.marcadores ? ': ' + papel.marcadores.join(', ') : ''})`);
    }

    return res.status(200).json({
      ok: true,
      gravou: !seco,
      modo: seco ? 'SECO — nada foi gravado' : 'gravando',
      custo_ia: 'zero — o papel sai do texto do próprio documento',
      na_fila_com_anexo: candidatas.length,
      processados: lote.length,
      reconhecidos: decididos.length,
      faltam: seco ? 0 : Math.max(0, candidatas.length - lote.length),
      decididos,
      // Os que o reconhecedor não decidiu aparecem de propósito: é a lista de
      // marcadores que ainda faltam ensinar.
      sem_marcador: semMarcador,
    });
  } catch (e) {
    console.error('[backfill-papel]', e);
    return res.status(500).json({ error: String(e.message || e) });
  }
}
