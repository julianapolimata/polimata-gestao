// =============================================================================
// OS TRÊS PORTÕES DE ENTRADA.
//
// Um documento que chega por e-mail responde a três perguntas antes de poder
// virar conta a pagar. Falhou numa, ele continua entrando — mas entra como
// FICHA PARA DECIDIR, e não como lançamento pronto para o "✓ Aprovar".
//
//   1. TITULARIDADE — isto é meu?
//      A dona é consultora: os clientes encaminham os documentos financeiros
//      DELES como material de trabalho, e no e-mail do financeiro ficam
//      idênticos aos dela. Já entraram dois relatórios de contas a receber de
//      cliente somando R$ 260 milhões e dois contratos de locação.
//
//   2. PAPEL — isto é desembolso, ou é prova de desembolso?
//      O recibo da DCTFWeb traz o valor do DARF impresso dentro. Quem olha o
//      valor conclui "é um DARF", e a mesma dívida vira duas despesas: os
//      R$ 932,31 de INSS entraram em três documentos do mesmo mês.
//
//   3. RECEITA — o CNPJ que a IA leu existe?
//      A leitura troca dígito. Três CNPJs inválidos viraram fornecedor, e um
//      fornecedor com CNPJ errado não casa com nada depois — nem com a nota,
//      nem com o extrato, nem com o cadastro.
//
// O QUE ESTE ARQUIVO NÃO FAZ: não descarta nada e não decide nada sozinho.
// Ele responde "passou?" e, quando não, DIZ POR QUÊ, em português, com o dado
// que sustenta a conclusão. Quem decide é ela, na fila.
//
// A regra mora em lib/ porque é decisão de negócio, pura, e tem prova própria
// em provas/portoes.mjs.
// =============================================================================
import { viraLancamento, PAPEIS } from './papelDocumento.js'

const so = v => String(v || '').replace(/\D/g, '')

/**
 * @param {object} p
 * @param {object} p.parsed         o documento lido (IA ou XML)
 * @param {string} p.cnpjEmpresa    o CNPJ da Polímata, só dígitos
 * @param {object} [p.receita]      veredito da consulta à Receita:
 *                                  { estado: 'confirmado'|'inexistente'|'nao_respondeu',
 *                                    razao_social?, situacao? }
 *                                  Ausente = a consulta não era necessária.
 * @returns {{aprovado: boolean, falhas: Array<{portao, motivo, explicacao}>}}
 *   `aprovado` = os três portões passaram, e só então a ficha nasce com valor
 *   e com destino.
 */
export function portoesDeEntrada({ parsed, cnpjEmpresa, receita } = {}) {
  const falhas = []
  const emp = so(cnpjEmpresa)
  const emit = so(parsed?.emitente_cnpj)
  const dest = so(parsed?.destinatario_cnpj)

  // ── 1. TITULARIDADE ───────────────────────────────────────────────────
  //
  // Prova de que o documento é da empresa: ela é uma das duas partes. Sem o
  // CNPJ da empresa em nenhum dos lados, o documento pode ser dela — mas o
  // sistema NÃO SABE, e tratar "não sei" como "sim" é o que trouxe os
  // R$ 260 milhões do cliente para dentro do caixa dela.
  if (!emp) {
    // Sem o CNPJ da empresa configurado não há com o que comparar. Isso é
    // falta de configuração, e não culpa do documento: ninguém é reprovado.
  } else if (emit === emp || dest === emp) {
    // Passou: a empresa é parte.
  } else if (emit || dest) {
    falhas.push({
      portao: 'titularidade',
      motivo: 'documento_de_terceiro',
      explicacao: `o documento é entre ${parsed?.emitente_nome || 'emitente não identificado'}`
        + ` e ${parsed?.destinatario_nome || 'destinatário não identificado'},`
        + ' e a empresa não é parte',
    })
  } else {
    falhas.push({
      portao: 'titularidade',
      motivo: 'titularidade_nao_comprovada',
      explicacao: 'a leitura não achou CNPJ em nenhum dos dois lados, então não há'
        + ' como provar que o documento é da empresa',
    })
  }

  // ── 2. PAPEL ──────────────────────────────────────────────────────────
  //
  // Papel não reconhecido NÃO reprova: o texto do documento não trouxe
  // marcador nenhum, e aí vale o que a IA leu, como sempre valeu. Reprovar
  // o desconhecido jogaria toda nota de fornecedor novo para a fila.
  const papel = parsed?.papel_documento || null
  if (papel && !viraLancamento(papel)) {
    falhas.push({
      portao: 'papel',
      motivo: 'nao_e_desembolso',
      explicacao: `é ${String(PAPEIS[papel] || papel).toLowerCase()} — prova ou memória de`
        + ' cálculo, não dinheiro saindo. O valor impresso dentro dele é de outro documento',
    })
  }

  // ── 3. RECEITA ────────────────────────────────────────────────────────
  //
  // Três estados, e a diferença entre os dois últimos é a que mais importa:
  //   confirmado    — a Receita respondeu e o CNPJ existe;
  //   inexistente   — a Receita respondeu e o CNPJ NÃO existe (a IA errou);
  //   nao_respondeu — a consulta não aconteceu. O sistema não sabe.
  //
  // "Não sei" não reprova o documento. Uma indisponibilidade do serviço
  // público não pode parar a entrada de notas — mas fica escrito na ficha,
  // para ninguém confundir silêncio com confirmação.
  if (receita?.estado === 'inexistente') {
    falhas.push({
      portao: 'receita',
      motivo: 'cnpj_inexistente',
      explicacao: `a Receita não reconhece o CNPJ ${receita.cnpj || ''} lido no documento,`
        + ' e o número provavelmente saiu errado da leitura',
    })
  }

  return { aprovado: falhas.length === 0, falhas }
}

/**
 * Uma linha em português com o que barrou — é o que a fila mostra.
 *
 * O separador é o ponto médio, e não o ponto e vírgula: as explicações já têm
 * vírgula dentro, e um separador que também aparece no meio da frase deixa de
 * separar.
 */
export function resumoDasFalhas(falhas) {
  if (!falhas?.length) return ''
  return falhas.map(f => f.explicacao).join(' · ')
}

export default portoesDeEntrada
