import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import AppLayout from '../components/AppLayout'

import { fmtMoney, flatten, ehOperacional } from '../lib/finance'
import { showToast } from '../components/Toast'
import { proximoCodigoPayable } from '../lib/codigos'
import { fetchPlanoContas } from '../lib/planoContas'
import {
  descobrirFaixa, calcularAliquotaEfetiva,
  projetarDAS, compor, vencimentoDAS, ultimoDiaDoMes,
  calcularFatorR, anexoPorFatorR, folhaMinimaParaAnexoIII,
  percentualIssDaFaixa, proporcionalizarRBT12, FATOR_R_LIMITE,
} from '../lib/simplesNacional'

// =====================================================================
// SIMPLES NACIONAL — Calculadora + projeção do DAS do mês seguinte.
//
// Consultoria em gestão (CNAE 70.20-4) é serviço do art. 18, §5º-I, IX da
// LC 123/2006: nasce no ANEXO V e só vai para o ANEXO III quando o Fator R
// (folha 12 meses ÷ receita 12 meses) chega a 28% (§§5º-J e 5º-M). O anexo
// NÃO é fixo no código: é recalculado todo mês a partir dos lançamentos.
// =====================================================================

const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

// --- Folha de salários do Fator R (LC 123/2006 art. 18 §§24 a 26; Resolução
// CGSN 140/2018 art. 26 §§1º a 3º): entra o montante pago a PESSOAS FÍSICAS a
// título de trabalho e pró-labore, mais a CPP e o FGTS efetivamente recolhidos.
// Não entram: pagamentos a pessoa jurídica, aluguéis e distribuição de lucros.
const CAT_FOLHA = 'Pessoal / Mão de Obra'
const CAT_IMPOSTOS_FOLHA = 'Impostos sobre Folha'
// Subcategorias de "Pessoal / Mão de Obra" que a lei NÃO deixa somar:
//  - Prestadores PJ: pessoa jurídica, não é remuneração a pessoa física;
//  - Estagiários: bolsa de estágio não é remuneração do trabalho nem entra na
//    base da contribuição previdenciária (Lei 11.788/2008, art. 3º).
//  - Antecipação de Lucro: distribuição de lucro não é remuneração do trabalho
//    e não tem contribuição previdenciária — a lei conta folha, não retirada de
//    sócio (LC 123/2006, art. 18 §24; Resolução CGSN 140/2018, art. 26 §1º).
const SUBCAT_FOLHA_FORA = ['Prestadores PJ', 'Estagiários', 'Estagiarios', 'Antecipação de Lucro', 'Antecipacao de Lucro']
// Trava adicional: qualquer lançamento cuja CLASSIFICAÇÃO no plano de contas
// seja distribuição de lucro fica fora, mesmo que a subcategoria mude de nome.
const CLASSIF_FOLHA_FORA = ['Antecipação de Lucro']
// De "Impostos sobre Folha" só entram CPP e FGTS efetivamente recolhidos.
const SUBCAT_IMPOSTOS_FOLHA_DENTRO = ['FGTS', 'INSS - Pró Labore', 'INSS - Pro Labore', 'INSS - Fopag']

const AJUSTES_RETENCAO_INDEVIDA = {
  irrf: 'IRRF retido',
  pcc: 'PIS/COFINS/CSLL retido',
  inss: 'INSS retido',
}

const RBT12_ORIGEM = {
  calculada: 'calculada pelas notas emitidas',
  informada: 'informada na configuração (base curta)',
  proporcionalizada: 'proporcionalizada (início de atividade)',
}

function fmtPct(v) { return (v * 100).toFixed(2) + '%' }
function fmtDataBR(s) {
  if (!s) return '—'
  const [y, m, d] = s.split('-')
  return `${d}/${m}/${y}`
}

export default function SimplesNacional() {
  const { user } = useAuth()
  const [config, setConfig] = useState(null)
  const [dasHist, setDasHist] = useState([])
  const [receivable, setReceivable] = useState([])
  const [payable, setPayable] = useState([])       // linhas cruas {id, codigo, data}
  const [nfseCfg, setNfseCfg] = useState(null)     // nfse_config.data — fonte única do município do ISS
  const [plano, setPlano] = useState([])           // classificação de cada categoria (quem é distribuição de lucro)
  const [gerandoDAS, setGerandoDAS] = useState(false)
  const [loading, setLoading] = useState(true)
  const [editando, setEditando] = useState(false)
  const [formRbt12, setFormRbt12] = useState('')
  const [salvando, setSalvando] = useState(false)

  const carregar = useCallback(() => {
    if (!user) return
    setLoading(true)
    Promise.all([
      supabase.from('simples_nacional_config').select('*').limit(1),
      supabase.from('simples_nacional_das').select('*').order('periodo_apuracao', { ascending: false }).limit(13),
      supabase.from('receivable').select('*'),
      // extrato_id é COLUNA (não vive no jsonb) — é ela que amarra o ajuste de
      // ISS da Conciliação ao recebível que sofreu a retenção.
      supabase.from('payable').select('id,codigo,extrato_id,data'),
      supabase.from('nfse_config').select('*').limit(1),
    ]).then(([rC, rD, rR, rP, rN]) => {
      setConfig(rC.data?.[0] || null)
      setDasHist(rD.data || [])
      // flatten() não carrega extrato_id — preservamos à mão.
      setReceivable((rR.data || []).map(r => ({ ...flatten(r), extrato_id: r.extrato_id })))
      setPayable(rP.data || [])
      setNfseCfg(rN.data?.[0]?.data || null)
      setLoading(false)
    })
  }, [user])

  useEffect(() => { carregar() }, [carregar])
  useEffect(() => { fetchPlanoContas().then(p => setPlano(p || [])) }, [])

  const cfg = config?.data || {}
  // Município do ISS: fonte única = Configurações › NFS-e (nfse_config.data.municipio_incidencia).
  // O antigo cfg.municipio_iss era um segundo cadastro do mesmo dado — não é mais lido nem gravado.
  const municipioIss = (nfseCfg?.municipio_incidencia || '').trim()

  function abrirEditor() {
    setFormRbt12(cfg.rbt12_estimada != null ? String(cfg.rbt12_estimada) : '')
    setEditando(true)
  }
  // Prévia ao vivo enquanto digita a RBT12 — o anexo sai do Fator R (mais abaixo).
  const rbt12Form = Number(String(formRbt12).replace(/\./g, '').replace(',', '.')) || 0

  async function salvarConfig() {
    if (rbt12Form <= 0) { showToast('Informe a RBT12 estimada (receita dos últimos 12 meses).', 'warning'); return }
    // municipio_iss sai do jsonb: o dado vive só em nfse_config (evita cadastro duplicado).
    const { municipio_iss: _descartado, ...cfgSem } = cfg || {}
    const novo = {
      ...cfgSem,
      // Não existe mais anexo fixo: grava o que o Fator R indica para a RBT12 digitada.
      anexo: anexoForm,
      rbt12_estimada: rbt12Form,
      aliquota_efetiva: aliquotaForm,
      atualizado_em: new Date().toISOString().slice(0, 10),
    }
    setSalvando(true)
    try {
      if (config?.id) {
        const { error } = await supabase.from('simples_nacional_config').update({ data: novo }).eq('id', config.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('simples_nacional_config').insert({ user_id: user.id, data: novo })
        if (error) throw error
      }
      showToast('Configuração do Simples salva.', 'success')
      setEditando(false); carregar()
    } catch (e) { showToast('Erro ao salvar: ' + e.message, 'error') }
    finally { setSalvando(false) }
  }

  // Mês corrente — vamos projetar o DAS deste mês (vence dia 20 do próximo)
  const hoje = new Date()
  // mesAtualISO removido — não usado
  const mesAnteriorISO = `${hoje.getMonth() === 0 ? hoje.getFullYear() - 1 : hoje.getFullYear()}-${String(hoje.getMonth() === 0 ? 12 : hoje.getMonth()).padStart(2, '0')}`

  // Faturamento do mês: receivable cuja data_competencia (ou due) cai no mês selecionado
  const [mesSelecionado, setMesSelecionado] = useState(mesAnteriorISO)

  // Base do DAS = NFS-e EMITIDAS: exclui Provisão (previsão, sem NF) e captação
  // de empréstimo (financiamento, não é faturamento).
  // Base do DAS = NFS-e EMITIDA (prova fiscal), não qualquer recebível: juros,
  // reembolso e crédito não são faturamento (bench: Omie/OneFlow apura por documento).
  const ehNfEmitida = r => r.data?.doc_status === 'vinculado' || !!r.data?.numero_nf
  const ehFaturamentoEm = (r, mesISO) => {
    const ref = r.data?.data_competencia || r.due
    return ref && ref.startsWith(mesISO) && ehOperacional(r) && ehNfEmitida(r)
  }
  const ehFaturamento = r => ehFaturamentoEm(r, mesSelecionado)
  const faturamentoMes = useMemo(() => {
    return receivable.filter(ehFaturamento).reduce((s, r) => s + Number(r.value || 0), 0)
  }, [receivable, mesSelecionado])

  // Lançamentos do mês pra mostrar detalhe
  const lancamentosDoMes = useMemo(() => {
    return receivable.filter(ehFaturamento).sort((a, b) => (a.due || '').localeCompare(b.due || ''))
  }, [receivable, mesSelecionado])

  // ------------------------------------------------------------------
  // RBT12 — receita bruta dos 12 meses ANTERIORES ao período de apuração
  // (LC 123/2006, art. 18, §1º). Regra: manda a CALCULADA sempre que houver 12
  // meses de histórico de notas. O valor digitado só vale com base curta, e a
  // tela avisa. Sem valor digitado e com base curta, proporcionaliza como
  // empresa em início de atividade (art. 18, §2º / CGSN 140/2018, art. 22).
  // ------------------------------------------------------------------
  const janela12 = useMemo(() => {
    const [y0, m0] = mesSelecionado.split('-').map(Number)
    const out = []
    for (let i = 1; i <= 12; i++) {
      const d = new Date(y0, m0 - 1 - i, 1)
      out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }
    return out.reverse() // do mais antigo para o mais recente
  }, [mesSelecionado])

  // Primeiro mês com NFS-e emitida em todo o histórico = início da base.
  const primeiroMesComNf = useMemo(() => {
    let min = null
    for (const r of receivable) {
      if (!ehOperacional(r) || !ehNfEmitida(r)) continue
      const ref = r.data?.data_competencia || r.due
      if (!ref) continue
      const ym = ref.slice(0, 7)
      if (!min || ym < min) min = ym
    }
    return min
  }, [receivable])

  const rbt12Info = useMemo(() => {
    const porMes = janela12.map(iso => ({
      iso,
      valor: receivable.filter(r => ehFaturamentoEm(r, iso)).reduce((s, r) => s + Number(r.value || 0), 0),
    }))
    const soma = porMes.reduce((s, m) => s + m.valor, 0)
    // Meses de base = meses da janela que já existiam depois da 1ª nota emitida.
    const mesesDeBase = primeiroMesComNf ? porMes.filter(m => m.iso >= primeiroMesComNf).length : 0
    const baseCompleta = mesesDeBase >= 12
    const informada = Number(cfg.rbt12_estimada) || 0
    const proporcionalizada = proporcionalizarRBT12(soma, mesesDeBase)

    if (baseCompleta) {
      return { valor: soma, origem: 'calculada', soma, mesesDeBase, proporcionalizada, informada, porMes }
    }
    if (informada > 0) {
      return { valor: informada, origem: 'informada', soma, mesesDeBase, proporcionalizada, informada, porMes }
    }
    return { valor: proporcionalizada, origem: 'proporcionalizada', soma, mesesDeBase, proporcionalizada, informada, porMes }
  }, [receivable, janela12, primeiroMesComNf, cfg.rbt12_estimada])

  const rbt12 = rbt12Info.valor

  // ------------------------------------------------------------------
  // FATOR R — folha de salários dos 12 meses anteriores ÷ receita bruta dos
  // mesmos 12 meses (LC 123/2006, art. 18, §§5º-J, 5º-K, 5º-M e 24 a 26).
  // ------------------------------------------------------------------
  // O plano de contas é quem diz o que é distribuição de lucro. Usar a
  // classificação (e não só o nome da subcategoria) mantém a regra de pé se
  // alguém renomear a conta depois.
  const foraPorClassificacao = useMemo(() => {
    const set = new Set()
    for (const l of plano || []) {
      if (CLASSIF_FOLHA_FORA.includes(l.classificacao)) set.add(l.categoria + "|" + (l.subcategoria || ""))
    }
    return set
  }, [plano])

  const ehFolhaEm = (p, mesISO) => {
    const d = p.data || {}
    if (d.status === 'Provisão') return false
    const ref = d.data_competencia || d.due
    if (!ref || !ref.startsWith(mesISO)) return false
    const cat = d.cat || ''
    const sub = (d.subcat || '').trim()
    if (foraPorClassificacao.has(cat + "|" + sub)) return false
    if (cat === CAT_FOLHA) return !SUBCAT_FOLHA_FORA.includes(sub)
    if (cat === CAT_IMPOSTOS_FOLHA) return SUBCAT_IMPOSTOS_FOLHA_DENTRO.includes(sub)
    return false
  }

  const folhaInfo = useMemo(() => {
    const itens = []
    let total = 0
    for (const iso of janela12) {
      for (const p of payable) {
        if (!ehFolhaEm(p, iso)) continue
        const v = Number(p.data?.value || 0)
        total += v
        itens.push({ cat: p.data?.cat || '', sub: (p.data?.subcat || '').trim() || '(sem subcategoria)', valor: v })
      }
    }
    // Agrupa por subcategoria só para explicar na tela o que entrou.
    const porSub = []
    for (const it of itens) {
      const chave = `${it.cat} › ${it.sub}`
      const achou = porSub.find(x => x.chave === chave)
      if (achou) { achou.valor += it.valor; achou.qtd += 1 }
      else porSub.push({ chave, valor: it.valor, qtd: 1 })
    }
    porSub.sort((a, b) => b.valor - a.valor)
    return { total, porSub }
  }, [payable, janela12, foraPorClassificacao])

  const folha12 = folhaInfo.total
  const fatorR = useMemo(() => calcularFatorR({ folha12, rbt12 }), [folha12, rbt12])
  const anexoCalculado = anexoPorFatorR(fatorR)
  const anexoGravado = (cfg.anexo || '').toUpperCase() || null
  const anexoDivergente = !!anexoGravado && anexoGravado !== anexoCalculado
  // O cálculo usa SEMPRE o anexo calculado — o gravado é só histórico.
  const anexoEfetivo = anexoCalculado
  const folhaMinima = folhaMinimaParaAnexoIII(rbt12)
  const distanciaFatorR = folha12 - folhaMinima   // > 0 = folga; < 0 = falta folha

  // Prévia do editor (depende do Fator R, por isso vem depois).
  const anexoForm = anexoPorFatorR(calcularFatorR({ folha12, rbt12: rbt12Form }))
  const faixaForm = descobrirFaixa(rbt12Form, anexoForm)
  const aliquotaForm = calcularAliquotaEfetiva(rbt12Form, faixaForm)

  // ------------------------------------------------------------------
  // Faixa + alíquota efetiva do período
  // ------------------------------------------------------------------
  const faixaInfo = useMemo(() => descobrirFaixa(rbt12, anexoEfetivo), [rbt12, anexoEfetivo])
  // Alíquota efetiva recalculada na leitura (a gravada ficava congelada ao trocar de faixa).
  const aliquotaEf = useMemo(() => {
    const calc = calcularAliquotaEfetiva(rbt12, faixaInfo)
    return Number.isFinite(calc) && calc > 0 ? calc : Number(cfg.aliquota_efetiva || 0)
  }, [rbt12, faixaInfo, cfg.aliquota_efetiva])

  // ------------------------------------------------------------------
  // ISS retido na fonte — receita SEGREGADA (LC 123/2006, art. 18, §4º-A, II e
  // art. 21, §4º, VII). Sobre a receita que sofreu retenção não há ISS a
  // recolher no DAS: o que sai é a PARCELA DO ISS dentro da alíquota efetiva,
  // não o valor que o tomador reteve.
  // ------------------------------------------------------------------
  const ehIssRetidoEm = (p, mesISO) => {
    const d = p.data || {}
    if (d.criado_via_conciliacao_ajuste !== true || d.ajuste_tipo !== 'iss') return false
    const ref = d.data_competencia || d.due
    return !!ref && ref.startsWith(mesISO)
  }
  const ajustesIssMes = useMemo(() => payable.filter(p => ehIssRetidoEm(p, mesSelecionado)), [payable, mesSelecionado])
  const retencaoIssMes = useMemo(() => ajustesIssMes.reduce((s, p) => s + Number(p.data?.value || 0), 0), [ajustesIssMes])

  const issInfo = useMemo(() => {
    const idsExtrato = new Set()
    let semVinculo = 0
    const orfaos = []
    for (const a of ajustesIssMes) {
      if (a.extrato_id) idsExtrato.add(a.extrato_id)
      else { semVinculo += Number(a.data?.value || 0); orfaos.push(a) }
    }
    // Recebíveis do mês que dividem a linha de extrato com um ajuste de ISS.
    const comRetencao = lancamentosDoMes.filter(r => r.extrato_id && idsExtrato.has(r.extrato_id))
    const casados = new Set(comRetencao.map(r => r.extrato_id))
    // Ajuste com extrato_id que não casou com nenhum recebível → método antigo.
    for (const a of ajustesIssMes) {
      if (a.extrato_id && !casados.has(a.extrato_id)) {
        semVinculo += Number(a.data?.value || 0)
        orfaos.push(a)
      }
    }
    const receitaComRetencao = comRetencao.reduce((s, r) => s + Number(r.value || 0), 0)
    return { receitaComRetencao, comRetencao, estimado: semVinculo, orfaos }
  }, [ajustesIssMes, lancamentosDoMes])

  const pctIssFaixa = useMemo(
    () => percentualIssDaFaixa(faixaInfo.faixa, aliquotaEf, anexoEfetivo),
    [faixaInfo.faixa, aliquotaEf, anexoEfetivo],
  )

  const projecao = useMemo(() => projetarDAS({
    faturamentoMes,
    aliquotaEfetiva: aliquotaEf,
    retencaoIssTotal: retencaoIssMes,
    receitaComRetencaoIss: issInfo.receitaComRetencao,
    percentualIssFaixa: pctIssFaixa,
    retencaoIssEstimadaTotal: issInfo.estimado,
  }), [faturamentoMes, aliquotaEf, retencaoIssMes, issInfo, pctIssFaixa])

  const composicao = useMemo(
    () => compor(projecao.dasLiquido, faixaInfo.faixa, anexoEfetivo, aliquotaEf),
    [projecao.dasLiquido, faixaInfo.faixa, anexoEfetivo, aliquotaEf],
  )

  // ------------------------------------------------------------------
  // Retenções que a optante do Simples normalmente NÃO deveria sofrer.
  // ------------------------------------------------------------------
  const retencoesIndevidas = useMemo(() => {
    const itens = payable.filter(p => {
      const d = p.data || {}
      if (d.criado_via_conciliacao_ajuste !== true) return false
      if (!AJUSTES_RETENCAO_INDEVIDA[d.ajuste_tipo]) return false
      const ref = d.data_competencia || d.due
      return !!ref && ref.startsWith(mesSelecionado)
    })
    const total = itens.reduce((s, p) => s + Number(p.data?.value || 0), 0)
    return { itens, total }
  }, [payable, mesSelecionado])
  const vencimento = vencimentoDAS(mesSelecionado)
  const labelMes = `${MESES[parseInt(mesSelecionado.split('-')[1], 10) - 1]}/${mesSelecionado.split('-')[0]}`
  const competenciaMMAAAA = `${mesSelecionado.split('-')[1]}/${mesSelecionado.split('-')[0]}`
  // Conta a pagar do DAS já gerada para este período? (uma por período: periodo_apuracao + criado_via_simples)
  const dasLancado = useMemo(() => payable.find(p => p.data?.criado_via_simples === true && p.data?.periodo_apuracao === mesSelecionado) || null, [payable, mesSelecionado])

  async function gerarContaDAS() {
    if (!user || dasLancado || gerandoDAS) return
    const valor = Math.round(projecao.dasLiquido * 100) / 100
    if (valor <= 0) return
    const ok = window.confirm(
      `Gerar conta a pagar do DAS de ${labelMes}?\n\n`
      + `Valor: ${fmtMoney(valor)}\n`
      + `Anexo ${anexoEfetivo} · Faixa ${faixaInfo.faixa} · alíquota efetiva ${fmtPct(aliquotaEf)}\n`
      + (issInfo.receitaComRetencao > 0
        ? `Receita com ISS retido: ${fmtMoney(issInfo.receitaComRetencao)} — já sem a parcela de ISS (${fmtPct(pctIssFaixa)} da alíquota)\n`
        : '')
      + (issInfo.estimado > 0 ? `Abatimento estimado (ISS retido sem vínculo): ${fmtMoney(issInfo.estimado)}\n` : '')
      + `Vencimento: ${fmtDataBR(vencimento)}\n\n`
      + 'Entra em Contas a Pagar como Pendente, já escriturada (guia DAS, sem NF). Se o PGDAS-D fechar outro valor, ajuste a conta lá.'
    )
    if (!ok) return
    setGerandoDAS(true)
    try {
      // Reconfere no banco antes de criar (outra aba pode ter gerado).
      const { data: existentes, error: errChk } = await supabase.from('payable').select('id,codigo,data')
        .eq('data->>criado_via_simples', 'true').eq('data->>periodo_apuracao', mesSelecionado).limit(1)
      if (errChk) throw errChk
      if (existentes?.length) { showToast(`O DAS de ${labelMes} já está lançado (código ${existentes[0].codigo}).`, 'warning'); carregar(); return }
      const codigo = await proximoCodigoPayable()
      const data = {
        supplier: 'Receita Federal — DAS Simples Nacional',
        desc: `DAS Simples Nacional · competência ${competenciaMMAAAA}`,
        value: valor,
        due: vencimento,
        data_competencia: ultimoDiaDoMes(mesSelecionado),
        status: 'Pendente',
        cat: 'Impostos sobre Receita',
        subcat: 'Simples Nacional / DAS',
        forma_pagamento: '',
        doc_status: 'dispensado',
        doc_motivo_dispensa: 'Guia DAS (PGDAS-D)',
        sem_documento: false,
        escriturado: true,
        escriturado_em: new Date().toISOString(),
        escriturado_por: 'sistema',
        criado_via_simples: true,
        periodo_apuracao: mesSelecionado,
        created: new Date().toISOString().slice(0, 10),
      }
      const { error } = await supabase.from('payable').insert({ user_id: user.id, codigo, data })
      if (error) throw error
      showToast(`DAS de ${labelMes} lançado em Contas a Pagar (código ${codigo}).`, 'success')
      carregar()
    } catch (e) { showToast('Erro ao gerar a conta a pagar: ' + e.message, 'error') }
    finally { setGerandoDAS(false) }
  }

  // Tendência: comparar com último DAS pago
  const dasUltimo = dasHist[0]
  const tendencia = useMemo(() => {
    if (!dasUltimo) return null
    const dif = projecao.dasLiquido - Number(dasUltimo.valor_total)
    const pct = dif / Number(dasUltimo.valor_total)
    return { dif, pct, valor_anterior: Number(dasUltimo.valor_total), periodo_anterior: dasUltimo.periodo_apuracao }
  }, [projecao.dasLiquido, dasUltimo])

  // Lista de meses dos últimos 12
  const mesesDisponiveis = useMemo(() => {
    const out = []
    for (let i = 0; i < 12; i++) {
      const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1)
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      out.push({ iso, label: `${MESES[d.getMonth()]}/${d.getFullYear()}` })
    }
    return out
  }, [hoje])

  const formEditor = (
    <div style={parametrosBox}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--navy)', marginBottom: 12 }}>⚙️ Configuração do Simples Nacional</div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={campo}>
            <span style={campoLabel}>RBT12 estimada (receita bruta dos últimos 12 meses)</span>
            <input value={formRbt12} onChange={e => setFormRbt12(e.target.value)} placeholder="ex.: 240000" inputMode="decimal" style={input} />
          </label>
          <div style={{ ...campo, justifyContent: 'flex-end' }}>
            <span style={campoLabel}>Município do ISS</span>
            <div style={{ fontSize: 12, color: 'var(--navy)', padding: '9px 0' }}>
              <strong>{municipioIss || 'não definido'}</strong>{' '}
              <span style={{ color: 'var(--text-mid)' }}>(definido em <Link to="/nfse-config" style={{ color: 'var(--gold-dark)' }}>Configurações › NFS-e</Link>)</span>
            </div>
          </div>
        </div>
        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-mid)' }}>
          Anexo <strong>{anexoForm}</strong> · Faixa <strong>{faixaForm.faixa}</strong> (até {fmtMoney(faixaForm.ate)}) · Alíquota efetiva calculada: <strong style={{ color: 'var(--gold-dark)' }}>{fmtPct(aliquotaForm)}</strong>
        </div>
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-mid)', lineHeight: 1.6 }}>
          O anexo não é escolhido: ele sai do <strong>Fator R</strong>. Com folha de {fmtMoney(folha12)} nos 12 meses
          e receita de {fmtMoney(rbt12Form)}, o Fator R fica em <strong>{rbt12Form > 0 ? fmtPct(folha12 / rbt12Form) : '—'}</strong>
          {' '}— {rbt12Form > 0 && folha12 / rbt12Form >= FATOR_R_LIMITE ? 'igual ou acima' : 'abaixo'} dos 28% da lei, então vale o Anexo {anexoForm}.
        </div>
        <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-mid)', fontStyle: 'italic' }}>
          A RBT12 digitada só é usada enquanto o sistema não tiver 12 meses de notas emitidas. Depois disso, manda a calculada.
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button onClick={salvarConfig} disabled={salvando} style={btnPrimary}>{salvando ? 'Salvando…' : 'Salvar configuração'}</button>
          {config && <button onClick={() => setEditando(false)} style={btnGhost}>Cancelar</button>}
        </div>
      </div>
    </div>
  )

  if (loading) return <AppLayout title="Simples Nacional"><div style={emptyState}>Carregando…</div></AppLayout>

  if (!config && !editando) {
    return (
      <AppLayout title="Simples Nacional">
        <div style={{ fontSize: 13, color: 'var(--text-mid)', marginBottom: 14, lineHeight: 1.6 }}>
          Configure a calculadora do Simples Nacional pra eu projetar o DAS do mês. Informe a RBT12 (receita dos últimos 12 meses) — a faixa e a alíquota efetiva saem automaticamente.
        </div>
        {formEditor}
      </AppLayout>
    )
  }
  if (editando) {
    return <AppLayout title="Simples Nacional">{formEditor}</AppLayout>
  }

  return (
    <AppLayout title="Simples Nacional">
      {/* Banner parâmetros fiscais */}
      <div style={parametrosBox}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 10, color: 'var(--text-mid)', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>Configuração Polímata{cfg.atualizado_em ? ` · atualizada em ${fmtDataBR(cfg.atualizado_em)}` : ''}</div>
            <button onClick={abrirEditor} style={btnGhost}>⚙️ Editar</button>
          </div>
          <div style={{ display: 'flex', gap: 24, marginTop: 8, flexWrap: 'wrap' }}>
            <Param label="Anexo" valor={`Anexo ${anexoEfetivo} (serviços)`} sub={anexoDivergente ? `configuração gravada: Anexo ${anexoGravado}` : 'pelo Fator R do período'} />
            <Param label="Faixa" valor={`Faixa ${faixaInfo.faixa}`} sub={`até ${fmtMoney(faixaInfo.ate)}`} />
            <Param label="RBT12 em uso" valor={fmtMoney(rbt12)} sub={RBT12_ORIGEM[rbt12Info.origem]} />
            <Param label="Alíquota efetiva" valor={fmtPct(aliquotaEf)} />
            <Param label="Município do ISS" valor={municipioIss || 'não definido'} sub={<>definido em <Link to="/nfse-config" style={{ color: 'var(--gold-dark)' }}>Configurações › NFS-e</Link></>} />
          </div>
        </div>
      </div>

      {anexoDivergente && (
        <Aviso tom="alerta" titulo={`O anexo mudou: a configuração diz Anexo ${anexoGravado}, o Fator R deste período dá Anexo ${anexoEfetivo}.`}>
          O cálculo abaixo usa o <strong>Anexo {anexoEfetivo}</strong> (o calculado), porque é ele que a lei manda aplicar.
          Se o Anexo {anexoGravado} é que está certo, o que precisa ser corrigido são os lançamentos de folha ou de faturamento — não o cadastro.
        </Aviso>
      )}

      {rbt12Info.origem === 'informada' && (
        <Aviso tom="alerta" titulo="Usando a RBT12 informada — o sistema ainda não tem 12 meses de notas.">
          Há {rbt12Info.mesesDeBase} mês(es) de histórico de NFS-e emitidas na janela dos 12 meses anteriores a {labelMes},
          somando {fmtMoney(rbt12Info.soma)}. Enquanto a base for curta, vale o valor digitado na configuração ({fmtMoney(rbt12Info.informada)}).
          Como referência, a regra de início de atividade (média dos meses existentes × 12) daria <strong>{fmtMoney(rbt12Info.proporcionalizada)}</strong>.
          Assim que houver 12 meses de notas, a calculada passa a mandar sozinha.
        </Aviso>
      )}
      {rbt12Info.origem === 'proporcionalizada' && (
        <Aviso tom="info" titulo="RBT12 proporcionalizada (empresa em início de atividade).">
          Com {rbt12Info.mesesDeBase} mês(es) de notas emitidas somando {fmtMoney(rbt12Info.soma)}, a lei manda usar a média dos meses
          existentes multiplicada por 12 — dá <strong>{fmtMoney(rbt12Info.proporcionalizada)}</strong>. Nenhuma RBT12 foi digitada na configuração.
        </Aviso>
      )}

      {/* Fator R — decide o anexo */}
      <div style={projecaoCard}>
        <div style={{ fontSize: 11, color: 'var(--text-mid)', fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 10 }}>Fator R</div>
        <div style={{ fontSize: 12, color: 'var(--text-mid)', lineHeight: 1.7, marginBottom: 14 }}>
          Consultoria em gestão é serviço intelectual: começa no <strong>Anexo V</strong> e só vai para o <strong>Anexo III</strong> (mais barato)
          quando a folha dos 12 meses anteriores chega a <strong>28% da receita</strong> dos mesmos 12 meses.
        </div>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 14 }}>
          <Param label="Folha 12 meses" valor={fmtMoney(folha12)} sub={`até ${labelMes}, exclusive`} />
          <Param label="Receita 12 meses" valor={fmtMoney(rbt12)} sub={RBT12_ORIGEM[rbt12Info.origem]} />
          <Param label="Fator R" valor={fatorR == null ? '—' : fmtPct(fatorR)} sub={`limite legal: ${fmtPct(FATOR_R_LIMITE)}`} />
          <Param label="Anexo que vale" valor={`Anexo ${anexoEfetivo}`} sub={fatorR == null ? 'sem receita para calcular' : (fatorR >= FATOR_R_LIMITE ? 'Fator R ≥ 28%' : 'Fator R < 28%')} />
        </div>
        <div style={formulaBox}>
          {fatorR == null ? (
            <div style={{ fontSize: 12, color: 'var(--navy)' }}>
              Sem receita nos 12 meses anteriores não dá para calcular o Fator R. Na dúvida vale o <strong>Anexo V</strong>,
              que é a regra geral da consultoria — o Anexo III é a exceção, e precisa da folha para ser provada.
            </div>
          ) : anexoEfetivo === 'V' ? (
            <div style={{ fontSize: 12, color: 'var(--navy)' }}>
              Faltam <strong style={{ color: 'var(--gold-dark)' }}>{fmtMoney(Math.abs(distanciaFatorR))}</strong> de folha nos 12 meses para cair no Anexo III
              {' '}(a folha precisaria chegar a {fmtMoney(folhaMinima)}).
            </div>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--navy)' }}>
              Sobram <strong style={{ color: 'var(--green)' }}>{fmtMoney(Math.abs(distanciaFatorR))}</strong> de folga: a folha poderia cair até {fmtMoney(folhaMinima)} sem sair do Anexo III.
            </div>
          )}
        </div>
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 10, color: 'var(--text-mid)', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>O que entrou na folha</div>
          {folhaInfo.porSub.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--text-mid)', fontStyle: 'italic' }}>
              Nenhum lançamento de folha encontrado nos 12 meses anteriores. Sem folha lançada, o Fator R fica em zero e o sistema aplica o Anexo V — confira se a folha está toda registrada.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {folhaInfo.porSub.map(s => (
                <div key={s.chave} style={{ fontSize: 11, color: 'var(--text-mid)', display: 'flex', justifyContent: 'space-between', gap: 12, maxWidth: 520 }}>
                  <span>{s.chave} <span style={{ opacity: 0.7 }}>({s.qtd})</span></span>
                  <strong style={{ color: 'var(--navy)' }}>{fmtMoney(s.valor)}</strong>
                </div>
              ))}
            </div>
          )}
          <div style={{ fontSize: 10, color: 'var(--text-mid)', marginTop: 8, lineHeight: 1.6, maxWidth: 720 }}>
            A lei conta o que foi pago a <strong>pessoas físicas</strong> pelo trabalho, mais pró-labore, mais o INSS patronal e o FGTS efetivamente recolhidos.
            Ficam de fora <strong>Prestadores PJ</strong> (pessoa jurídica), <strong>Estagiários</strong> (bolsa de estágio não é remuneração do trabalho),
            aluguéis, distribuição de lucros e tudo que estiver como <strong>Provisão</strong>.
            Se algum lançamento de “Freelancers” for pessoa jurídica, ele está somando aqui indevidamente — vale conferir.
          </div>
        </div>
      </div>

      {/* Seletor de mês + projeção */}
      <div style={projecaoCard}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16, marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-mid)', fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6 }}>Projeção DAS</div>
            <div style={{ fontSize: 13, color: 'var(--navy)' }}>
              Período de apuração:{' '}
              <select value={mesSelecionado} onChange={e => setMesSelecionado(e.target.value)} style={select}>
                {mesesDisponiveis.map(m => <option key={m.iso} value={m.iso}>{m.label}</option>)}
              </select>
              {' '}· Vencimento: <strong>{fmtDataBR(vencimento)}</strong>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 36, fontWeight: 700, color: 'var(--gold-dark)', fontFamily: 'var(--body)' }}>{fmtMoney(projecao.dasLiquido)}</div>
            {tendencia && (
              <div style={{ fontSize: 11, color: tendencia.dif >= 0 ? 'var(--red)' : 'var(--green)', fontWeight: 600 }}>
                {tendencia.dif >= 0 ? '↑' : '↓'} {fmtMoney(Math.abs(tendencia.dif))} vs {tendencia.periodo_anterior} ({fmtPct(Math.abs(tendencia.pct))})
              </div>
            )}
          </div>
        </div>

        {/* Fórmula — conta aberta, com a receita segregada pela retenção de ISS */}
        <div style={formulaBox}>
          <div style={{ fontSize: 11, color: 'var(--text-mid)' }}>
            Faturamento de {labelMes}: <strong>{fmtMoney(faturamentoMes)}</strong> · Anexo {anexoEfetivo}, faixa {faixaInfo.faixa}, alíquota efetiva <strong>{fmtPct(aliquotaEf)}</strong>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-mid)' }}>
            Receita <strong>sem</strong> retenção de ISS: <strong>{fmtMoney(projecao.receitaSemRetencao)}</strong> × {fmtPct(aliquotaEf)} = <strong>{fmtMoney(projecao.receitaSemRetencao * aliquotaEf)}</strong>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-mid)' }}>
            Receita <strong>com</strong> retenção de ISS: <strong>{fmtMoney(projecao.receitaComRetencao)}</strong> × {fmtPct(aliquotaEf)} × (1 − {fmtPct(pctIssFaixa)} de ISS) = <strong>{fmtMoney(projecao.receitaComRetencao * aliquotaEf * (1 - pctIssFaixa))}</strong>
            <span style={{ display: 'block', fontSize: 10, fontStyle: 'italic' }}>
              sobre essa receita o ISS não é recolhido no DAS: sai a parcela de ISS da faixa ({fmtMoney(projecao.abatimentoIss)}), não o valor retido pelo tomador
            </span>
          </div>
          {projecao.abatimentoEstimado > 0 && (
            <div style={{ fontSize: 11, color: 'var(--text-mid)' }}>
              (−) Abatimento <strong>estimado</strong>: <strong>{fmtMoney(projecao.abatimentoEstimado)}</strong>
              <span style={{ display: 'block', fontSize: 10, fontStyle: 'italic' }}>
                ajuste(s) de ISS sem vínculo com uma nota — usei o método antigo só para esse valor
              </span>
            </div>
          )}
          <div style={{ fontSize: 11, color: 'var(--text-mid)' }}>
            = DAS a pagar: <strong style={{ color: 'var(--gold-dark)' }}>{fmtMoney(projecao.dasLiquido)}</strong>
            <span style={{ display: 'block', fontSize: 10, fontStyle: 'italic' }}>
              DAS sem nenhuma retenção seria {fmtMoney(projecao.dasNominal)} · ISS retido registrado no mês: {retencaoIssMes > 0 ? fmtMoney(retencaoIssMes) : 'nenhum'}
            </span>
          </div>
        </div>

        {projecao.abatimentoEstimado > 0 && (
          <div style={{ marginTop: 12 }}>
            <Aviso tom="alerta" titulo="Parte do abatimento de ISS foi estimada." compacto>
              {issInfo.orfaos.length} ajuste(s) de ISS retido não puderam ser ligados a uma NFS-e deste mês (sem linha de extrato em comum),
              somando {fmtMoney(projecao.abatimentoEstimado)}. Para esse valor usei o método antigo — abater o que foi retido.
              É uma aproximação: o número certo sai quando o ajuste estiver conciliado junto com o recebível da nota.
            </Aviso>
          </div>
        )}

        {retencoesIndevidas.itens.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <Aviso tom="alerta" titulo={`Retenção que optante do Simples normalmente não deveria sofrer: ${fmtMoney(retencoesIndevidas.total)} em ${labelMes}.`}>
              <div style={{ marginBottom: 8 }}>
                {retencoesIndevidas.itens.map(p => (
                  <div key={p.id} style={{ fontSize: 11 }}>
                    • {AJUSTES_RETENCAO_INDEVIDA[p.data?.ajuste_tipo]} — {fmtMoney(p.data?.value)}
                    {p.codigo ? <span style={{ opacity: 0.7 }}> (código {p.codigo})</span> : null}
                  </div>
                ))}
              </div>
              Empresa do Simples Nacional é dispensada da retenção de IRRF e de PIS/COFINS/CSLL na fonte nos pagamentos que recebe
              (IN RFB 765/2007 e IN SRF 459/2004, art. 3º, II). A retenção de INSS só cabe em cessão de mão de obra ou empreitada
              (serviços do Anexo IV) — não é o caso de consultoria.
              <div style={{ marginTop: 8 }}>
                Na prática: isso costuma ser <strong>erro do tomador</strong>. O valor retido <strong>não é despesa</strong> e <strong>não compensa no DAS</strong> —
                some do caixa sem virar crédito. O caminho é falar com o cliente para corrigir a nota e devolver o valor, ou pedir restituição do que foi recolhido a mais.
                Não mexi em nenhum lançamento: isto é só um aviso.
              </div>
            </Aviso>
          </div>
        )}

        {/* DAS vira conta a pagar */}
        <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {dasLancado ? (
            <div style={{ fontSize: 12, color: 'var(--green)', fontWeight: 600 }}>
              ✓ DAS lançado (código {dasLancado.codigo || '—'} · {fmtMoney(dasLancado.data?.value)}){' '}
              <Link to="/pagar" style={{ color: 'var(--gold-dark)', fontWeight: 600 }}>ver em Contas a Pagar →</Link>
            </div>
          ) : (
            <button onClick={gerarContaDAS} disabled={gerandoDAS || projecao.dasLiquido <= 0}
              style={{ ...btnPrimary, opacity: projecao.dasLiquido <= 0 ? 0.5 : 1, cursor: projecao.dasLiquido <= 0 ? 'not-allowed' : 'pointer' }}
              title={projecao.dasLiquido <= 0 ? 'DAS projetado é zero: não há o que lançar neste período.' : `Cria a conta a pagar de ${fmtMoney(projecao.dasLiquido)} com vencimento ${fmtDataBR(vencimento)}`}>
              {gerandoDAS ? 'Gerando…' : `＋ Gerar conta a pagar do DAS de ${labelMes}`}
            </button>
          )}
          <span style={{ fontSize: 10, color: 'var(--text-mid)' }}>Uma conta por período de apuração · Impostos sobre Receita › Simples Nacional / DAS</span>
        </div>

        {/* Composição por tributo */}
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 10, color: 'var(--text-mid)', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>Composição estimada</div>
          <div style={composicaoGrid}>
            <Tributo label="IRPJ" valor={composicao.irpj} cor="var(--navy)" />
            <Tributo label="CSLL" valor={composicao.csll} cor="var(--navy)" />
            <Tributo label="COFINS" valor={composicao.cofins} cor="var(--navy)" />
            <Tributo label="PIS" valor={composicao.pis} cor="var(--navy)" />
            <Tributo label="CPP (INSS)" valor={composicao.cpp} cor="var(--gold)" sub="o maior" />
            <Tributo label={`ISS${municipioIss ? ` ${municipioIss}` : ''}`} valor={composicao.iss} cor="var(--gold)" />
          </div>
        </div>
      </div>

      {/* Lançamentos que entraram na conta */}
      <div style={tableCard}>
        <div style={{ padding: '18px 24px 14px', borderBottom: '1px solid var(--cream-dark)' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--navy)' }}>NFS-e emitidas no período</div>
          <div style={{ fontSize: 11, color: 'var(--text-mid)', marginTop: 2 }}>
            Base do cálculo do DAS. {lancamentosDoMes.length} lançamento(s).
            {issInfo.comRetencao.length > 0 && <> {issInfo.comRetencao.length} com ISS retido na fonte (marcadas abaixo) — essas entram no DAS sem a parcela do ISS.</>}
          </div>
        </div>
        {lancamentosDoMes.length === 0 ? (
          <div style={emptyState}>Nenhuma NFS-e emitida neste período.</div>
        ) : (
          <table style={tbl}>
            <thead>
              <tr>
                <th style={th}>Cód.</th>
                <th style={th}>Cliente</th>
                <th style={{ ...th, width: 110 }}>Emissão</th>
                <th style={{ ...th, width: 110 }}>Vencimento</th>
                <th style={{ ...th, width: 130, textAlign: 'right' }}>Valor</th>
              </tr>
            </thead>
            <tbody>
              {lancamentosDoMes.map(r => (
                <tr key={r.id}>
                  <td style={{ ...td, fontFamily: 'monospace', color: 'var(--text-mid)' }}>{r.codigo || '—'}</td>
                  <td style={td}>
                    {r.client || r.data?.client || '—'}
                    {issInfo.comRetencao.some(x => x.id === r.id) && (
                      <span style={tagIss} title="Esta nota teve ISS retido na fonte: o DAS sai sem a parcela de ISS sobre ela.">ISS retido</span>
                    )}
                  </td>
                  <td style={{ ...td, color: 'var(--text-mid)' }}>{fmtDataBR(r.data?.data_competencia)}</td>
                  <td style={{ ...td, color: 'var(--text-mid)' }}>{fmtDataBR(r.due)}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{fmtMoney(r.value)}</td>
                </tr>
              ))}
              <tr style={{ background: 'var(--cream)' }}>
                <td style={{ ...td, fontWeight: 700 }} colSpan={4}>Total</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: 'var(--navy)' }}>{fmtMoney(faturamentoMes)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      {/* Histórico de DAS pagos */}
      {dasHist.length > 0 && (
        <div style={tableCard}>
          <div style={{ padding: '18px 24px 14px', borderBottom: '1px solid var(--cream-dark)' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--navy)' }}>Histórico de DAS</div>
          </div>
          <table style={tbl}>
            <thead>
              <tr>
                <th style={th}>Período</th>
                <th style={{ ...th, width: 110 }}>Venc.</th>
                <th style={th}>Nº Documento</th>
                <th style={{ ...th, width: 130, textAlign: 'right' }}>Valor</th>
              </tr>
            </thead>
            <tbody>
              {dasHist.map(d => (
                <tr key={d.id}>
                  <td style={{ ...td, fontWeight: 600 }}>{d.periodo_apuracao}</td>
                  <td style={{ ...td, color: 'var(--text-mid)' }}>{fmtDataBR(d.data_vencimento)}</td>
                  <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>{d.data?.numero_documento || '—'}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{fmtMoney(d.valor_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppLayout>
  )
}

function Param({ label, valor, sub }) {
  return (
    <div>
      <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-mid)', letterSpacing: 1, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--navy)', marginTop: 3 }}>{valor}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--text-mid)' }}>{sub}</div>}
    </div>
  )
}

function Aviso({ tom = 'info', titulo, compacto = false, children }) {
  const cor = tom === 'alerta' ? 'var(--red)' : 'var(--gold-dark)'
  const fundo = tom === 'alerta' ? 'rgba(200,60,60,0.06)' : 'rgba(204,145,94,0.08)'
  return (
    <div style={{
      background: fundo, borderLeft: `3px solid ${cor}`, borderRadius: 6,
      padding: compacto ? '10px 14px' : '14px 16px',
      marginBottom: compacto ? 0 : 18, fontFamily: 'var(--body)',
    }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: cor, marginBottom: 5 }}>{titulo}</div>
      <div style={{ fontSize: 11, color: 'var(--navy)', lineHeight: 1.7 }}>{children}</div>
    </div>
  )
}

function Tributo({ label, valor, cor, sub }) {
  return (
    <div style={{ background: 'var(--white)', borderRadius: 8, padding: 12, border: '1px solid var(--cream-dark)' }}>
      <div style={{ fontSize: 10, color: 'var(--text-mid)', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: cor, marginTop: 4 }}>{fmtMoney(valor)}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--text-mid)', fontStyle: 'italic' }}>{sub}</div>}
    </div>
  )
}

const parametrosBox = { background: 'var(--white)', borderRadius: 10, padding: 18, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)', marginBottom: 18, display: 'flex', gap: 16, alignItems: 'flex-start' }
const projecaoCard = { background: 'var(--white)', borderRadius: 12, padding: 24, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)', marginBottom: 18 }
const formulaBox = { background: 'rgba(204,145,94,0.06)', borderLeft: '3px solid var(--gold)', padding: 14, borderRadius: 6, fontSize: 12, color: 'var(--navy)', display: 'flex', flexDirection: 'column', gap: 4 }
const composicaoGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }
const tagIss = { marginLeft: 8, padding: '1px 7px', borderRadius: 10, background: 'rgba(204,145,94,0.16)', color: 'var(--gold-dark)', fontSize: 9, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', whiteSpace: 'nowrap' }
const select = { padding: '6px 10px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 13, color: 'var(--navy)', background: 'var(--white)', outline: 'none' }
const campo = { display: 'flex', flexDirection: 'column', gap: 5, flex: '1 1 240px', minWidth: 200 }
const campoLabel = { fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--text-mid)' }
const input = { padding: '9px 11px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 13, color: 'var(--navy)', background: 'var(--white)', outline: 'none' }
const btnPrimary = { padding: '9px 18px', border: 'none', borderRadius: 6, background: 'var(--gold)', color: '#fff', fontFamily: 'var(--body)', fontSize: 12, fontWeight: 700, letterSpacing: 0.5, cursor: 'pointer' }
const btnGhost = { padding: '7px 14px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, background: 'var(--white)', color: 'var(--navy)', fontFamily: 'var(--body)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }
const tableCard = { background: 'var(--white)', borderRadius: 12, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)', overflow: 'clip', marginBottom: 18 }
const tbl = { width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--body)' }
const th = { textAlign: 'left', padding: '12px 14px', fontSize: 9, fontWeight: 700, letterSpacing: 1.5, color: '#fff', textTransform: 'uppercase', background: 'var(--navy)', borderBottom: '2px solid var(--gold)' }
const td = { padding: '12px 14px', fontSize: 12, color: 'var(--navy)', borderBottom: '1px solid var(--cream-dark)' }
const emptyState = { padding: '60px 24px', textAlign: 'center', fontFamily: 'var(--body)', color: 'var(--text-mid)', fontSize: 13, background: 'var(--white)', borderRadius: 12, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)' }
