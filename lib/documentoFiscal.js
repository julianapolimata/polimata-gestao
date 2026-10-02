// =============================================================================
// O QUE CONTA COMO DOCUMENTO FINANCEIRO DA EMPRESA.
//
// Esta é a porta de entrada do sistema. O que passa aqui vira conta a pagar ou
// a receber; o que não passa fica na trilha (nf_history) e não some.
//
// A regra mora em lib/ e não dentro do robô porque ela é uma decisão de
// negócio, pura, e precisa de prova própria — ver provas/documento-fiscal.mjs.
// =============================================================================

export function naoEhDocumentoFiscal(parsed) {
  const tipoDoc = String(parsed?.tipo_documento || '').trim().toLowerCase();
  const valor = parseFloat(parsed?.valor_total);
  const valorOrig = parseFloat(parsed?.valor_original);
  // valor_original entra como proteção: documento em moeda estrangeira pode vir
  // com valor_total 0 e o valor só no original — esse NÃO é descarte.
  const semValor = !(Number.isFinite(valor) && valor > 0)
                && !(Number.isFinite(valorOrig) && valorOrig > 0);
  if (tipoDoc === 'outro' && semValor) return 'outro_sem_valor';

  // ── NINGUÉM DEVE DINHEIRO A NINGUÉM ──────────────────────────────────────
  //
  // Documento que cria obrigação sempre tem contraparte: alguém cobra, alguém
  // paga. Quando a leitura não identifica NENHUM dos dois lados, aquilo não é
  // documento financeiro da empresa — é um relatório que por acaso tem números
  // dentro, e o maior número de todos vira "o valor".
  //
  // Dois casos reais, parados na caixa de entrada: "ACR 06-2025.pdf" entrou
  // valendo R$ 138.143.664 e "ACR 02-2025.pdf" R$ 122.499.985. A própria
  // leitura descreveu os dois como "Relatório gerencial de Contas a Receber
  // (Trade account receivables) - Balance Sheet": são papéis de trabalho da
  // CONSULTORIA, do cliente dela, não contas da Polímata. O que virou valor foi
  // o total de uma tabela de recebíveis.
  //
  // Um terceiro, "Conta Azul - Contas a Receber.pdf" (R$ 296.339), ela já havia
  // rejeitado à mão. Esta regra chega à mesma conclusão que ela — e é essa
  // concordância que diz que a regra está certa, e não o raciocínio dela.
  //
  // Medido contra tudo que já passou pelo sistema: a regra pega exatamente
  // esses casos e nenhum documento legítimo, nem entre os aprovados.
  const semEmitente = !String(parsed?.emitente_nome || '').trim();
  const semDestinatario = !String(parsed?.destinatario_nome || '').trim();
  if (semEmitente && semDestinatario) return 'sem_nenhuma_das_partes';

  return null;
}

export default naoEhDocumentoFiscal;
