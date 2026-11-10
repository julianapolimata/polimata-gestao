// =============================================================================
// AS PROPAGAÇÕES DO SISTEMA — as duas pontas de cada uma.
//
// Uma propagação é um dado que sai de uma tela e precisa chegar em outra. Ela
// quebra de um jeito só e sempre o mesmo: um lado para de escrever, ou nunca
// escreveu, e o outro continua lendo. Não dá erro. Simplesmente o número não
// aparece, e quem usa conclui que a funcionalidade não serve.
//
// Já aconteceu três vezes neste projeto:
//   • `rec_ativa`     a projeção de fluxo lia; o formulário deixou de escrever;
//   • `projeto_id`    a tela de Projetos lia; só o lançamento manual escrevia;
//   • `apelidos`      a ficha escrevia; ninguém lia.
//
// Este script não adivinha as propagações: elas são DECLARADAS abaixo, uma a
// uma, com o campo que serve de ponte. Ele confere que existe quem escreva e
// quem leia, e aponta a ponta que faltar.
//
// Rodar: node scripts/verifica-propagacoes.cjs
// =============================================================================
const fs = require('fs');
const path = require('path');

// Cada propagação: o que é, o campo-ponte, e onde cada ponta deve estar.
const PROPAGACOES = [
  { nome: 'Cadastro de pessoa → Polímata App (CI)', campo: 'webhook_entregas',
    escreve: ['supabase/migrations/20261108_e3_webhook_nao_falha_em_silencio.sql'],
    le: ['src/pages/components/AvisoSincronizacaoCI.jsx'],
    nota: 'quem envia é o gatilho no banco; a tela mostra o que não chegou' },

  { nome: 'Oportunidade ganha → projeto', campo: 'oportunidade_id',
    escreve: ['src/lib/projetoDaVenda.js'], le: ['src/pages/components/ModalProjeto.jsx'],
    nota: 'o projeto guarda de qual venda veio, e a ficha dele mostra' },
  { nome: 'Projeto gerado → volta para a oportunidade', campo: 'projeto_id',
    escreve: ['src/pages/components/ModalOportunidade.jsx'],
    le: ['src/pages/components/ModalOportunidade.jsx'],
    nota: 'a oportunidade ganha deixa de oferecer gerar projeto depois de gerar' },

  { nome: 'Projeto ← receita (faturamento)', campo: 'projeto_id',
    escreve: ['src/pages/components/ModalLancamento.jsx', 'src/pages/ImportarNFs.jsx'],
    le: ['src/pages/Catalogo.jsx', 'src/lib/projetoDaVenda.js'] },

  { nome: 'Empréstimo → parcelas em Contas a Pagar', campo: 'emprestimo_id',
    escreve: ['src/pages/Emprestimos.jsx', 'src/pages/Conciliacao.jsx'],
    le: ['src/pages/Emprestimos.jsx', 'src/pages/components/ModalParcelas.jsx'] },

  { nome: 'Credor do contrato → vínculo das parcelas', campo: 'pessoa_id',
    escreve: ['src/lib/parcelasEmprestimo.js', 'src/pages/components/ModalEmprestimo.jsx'],
    le: ['src/pages/components/ModalPessoa.jsx'] },

  { nome: 'Contrato → projeção de fluxo', campo: 'valor_mensal',
    escreve: ['src/pages/components/ModalContrato.jsx'],
    le: ['src/lib/receitaRecorrente.js'] },

  { nome: 'Portões de entrada → ficha sem valor e sem destino', campo: 'portao_aprovado',
    escreve: ['api/email-cron.js'], le: ['src/pages/ImportarNFs.jsx'] },

  { nome: 'Portão da Receita → marca na ficha', campo: 'cnpj_conferido',
    escreve: ['api/email-cron.js'], le: ['src/pages/ImportarNFs.jsx'] },

  { nome: 'Escrituração manual → regra aprendida', campo: 'escriturado_por',
    escreve: ['src/pages/ClassificarLancamentos.jsx'], le: ['src/lib/escrituracao.js'] },

  { nome: 'Regra viva → memória que sobrevive à limpeza', campo: 'lerMemoria',
    escreve: ['src/lib/memoriaRegras.js'], le: ['src/pages/ClassificarLancamentos.jsx'] },

  { nome: 'Conciliação → o sistema não aprende consigo', campo: 'conciliado_por',
    escreve: ['supabase/migrations/20261110_conciliacao_registra_quem_conciliou.sql'],
    le: ['src/lib/regrasConciliacao.js'],
    nota: 'a tela manda p_origem; quem grava conciliado_por é a função do banco' },

  { nome: 'Ajuste da conciliação → contrato do empréstimo', campo: 'ajuste_tipo',
    escreve: ['src/pages/Conciliacao.jsx'], le: ['src/lib/contratoVisao.js'] },

  { nome: 'Apelido do cartão → fornecedor da compra', campo: 'apelidos',
    escreve: ['src/pages/components/ModalPessoa.jsx'], le: ['src/lib/vinculoPessoa.js'] },

  { nome: 'Papel do documento → ação recomendada na fila', campo: 'papel_documento',
    escreve: ['api/email-cron.js'], le: ['src/pages/ImportarNFs.jsx'] },

  { nome: 'Boleto → situação fiscal em aberto', campo: 'fiscal_em_aberto',
    escreve: ['src/lib/situacaoFiscal.js'], le: ['src/pages/ClassificarLancamentos.jsx'] },

  { nome: 'Fechamento → trava do período', campo: 'fechamentos',
    escreve: ['src/pages/FechamentoMensal.jsx'], le: ['src/lib/fechamento.js'],
    nota: 'a trava que impede a escrita é o gatilho bloqueia_periodo_fechado, no banco' },

  { nome: 'Dados da empresa → corte dos documentos', campo: 'documentos_desde',
    escreve: ['src/pages/DadosEmpresa.jsx'], le: ['api/email-cron.js'] },

  { nome: 'Dados da empresa → portão de titularidade', campo: 'cnpj',
    escreve: ['src/pages/DadosEmpresa.jsx'], le: ['api/email-cron.js'] },

  { nome: 'Plano de contas → categorias das telas', campo: 'plano_contas',
    escreve: ['src/pages/PlanoContas.jsx'], le: ['src/lib/planoContas.js'] },

  { nome: 'Oportunidade → ficha da pessoa', campo: 'oportunidades',
    escreve: ['src/pages/components/ModalOportunidade.jsx'], le: ['src/pages/components/ModalPessoa.jsx'] },
];

const cache = new Map();
function texto(arquivo) {
  if (!cache.has(arquivo)) {
    cache.set(arquivo, fs.existsSync(arquivo) ? fs.readFileSync(arquivo, 'utf8') : null);
  }
  return cache.get(arquivo);
}

// A ponta existe quando o campo aparece FORA de comentário em algum dos arquivos.
function temCampo(arquivos, campo) {
  for (const a of arquivos) {
    const t = texto(a);
    if (t === null) return { ok: false, motivo: `arquivo não existe: ${a}` };
    const util = t.split('\n')
      .filter(l => !/^\s*(\/\/|\*|--)/.test(l))
      .join('\n');
    if (util.includes(campo)) return { ok: true, onde: a };
  }
  return { ok: false, motivo: `não encontrado em ${arquivos.join(', ')}` };
}

let quebradas = 0;
console.log(`${PROPAGACOES.length} propagações declaradas\n`);
for (const p of PROPAGACOES) {
  const e = temCampo(p.escreve, p.campo);
  const l = temCampo(p.le, p.campo);
  const ok = e.ok && l.ok;
  if (!ok) quebradas++;
  console.log(`${ok ? '  OK  ' : ' FALHA'} ${p.nome}`);
  console.log(`        ponte: ${p.campo}`);
  if (!e.ok) console.log(`        ESCRITA: ${e.motivo}`);
  if (!l.ok) console.log(`        LEITURA: ${l.motivo}`);
  if (p.nota) console.log(`        nota: ${p.nota}`);
}
console.log(quebradas
  ? `\n${quebradas} propagação(ões) com uma ponta faltando.`
  : '\nTodas as propagações têm as duas pontas.');
process.exit(quebradas ? 1 : 0);
