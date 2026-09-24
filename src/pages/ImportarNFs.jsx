import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import AppLayout from '../components/AppLayout'
import { showToast } from '../components/Toast'
import { fmtMoney } from '../lib/finance'
import { proximoCodigoReceivable, proximoCodigoPayable, proximoCodigoPessoa } from '../lib/codigos'
import { anexoDaNF } from '../lib/vincularNF'
import { fetchPlanoContas, categoriasDe } from '../lib/planoContas'
import SeletorLancamento from './components/SeletorLancamento'
import { useConfirm } from '../components/ConfirmDialog'
import { msgErro } from '../lib/erros'

// O endereço que recebe as notas é configuração DA EMPRESA (tabela
// config_empresa), não do build: num sistema usado por várias empresas, cada
// uma tem o seu. A variável de ambiente só serve de sugestão inicial.
const EMAIL_SUGERIDO = import.meta.env.VITE_EMAIL_NOTAS || ''

// =====================================================================
// CAIXA DE ENTRADA · NFs — tela de governança das NFs processadas pelo
// cron (api/email-cron.js) + upload manual.
//
// Princípio (bloco 5): a nota só sai da caixa por DECISÃO humana —
// Aprovar (vira lançamento novo), Anexar (prova de lançamento que já
// existe) ou Rejeitar. Nada some sozinho.
//
// 3 abas:
//  - Na caixa de entrada: nf_pending status=pendente — revisão humana
//    antes de virar lançamento oficial ou ser anexada a um existente.
//  - Histórico: nf_history — auditoria do que já passou pelo cron.
//  - Upload Manual: dropzone pra documentos que não vieram pelo email.
// =====================================================================

function fmtData(s) {
  if (!s) return '—'
  const [y, m, d] = s.split('-')
  return `${d}/${m}/${y}`
}

export default function ImportarNFs() {
  const { user } = useAuth()
  const [aba, setAba] = useState('aguardando')
  const [pendentes, setPendentes] = useState([])
  const [historico, setHistorico] = useState([])
  const [loading, setLoading] = useState(true)
  const [confirmando, setConfirmando] = useState(null) // id do que está sendo processado
  const [rodandoCron, setRodandoCron] = useState(false)
  const [ultimoResultado, setUltimoResultado] = useState(null)
  const [anexando, setAnexando] = useState(null) // nf_pending sendo anexada a lançamento existente
  const [plano, setPlano] = useState([])
  // Quanto a leitura automática custou neste mês. Custo variável invisível é
  // como margem que some sem ninguém ver.
  const [consumo, setConsumo] = useState(null)
  const [decisoes, setDecisoes] = useState([])
  const [emailEntrada, setEmailEntrada] = useState('')
  const [editandoEmail, setEditandoEmail] = useState(false)
  const [emailForm, setEmailForm] = useState('')
  const [salvandoEmail, setSalvandoEmail] = useState(false)
  const [confirmar, dialogoConfirmacao] = useConfirm()
  // Quais notas estão marcadas, e o andamento quando se decide várias de uma vez.
  const [selecionados, setSelecionados] = useState(() => new Set())
  const [lote, setLote] = useState(null)
  // Quanto tempo para trás procurar no e-mail. 7 dias é o dia a dia; janelas
  // maiores servem para trazer o histórico (ex.: guias de imposto de meses
  // anteriores que nunca entraram).
  const [diasBusca, setDiasBusca] = useState(7)

  useEffect(() => { fetchPlanoContas().then(p => setPlano(p || [])) }, [])

  async function rodarCron() {
    setRodandoCron(true)
    setUltimoResultado(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { showToast('Sessão expirada — faça login novamente.', 'error'); return }
      // Teto por rodada: a função do servidor é cortada em 60 s e cada documento
      // passa por leitura de IA. Lote pequeno e, se sobrar, a usuária roda de novo
      // (o que já foi lido fica etiquetado e não volta).
      const maxMsgs = diasBusca <= 7 ? 10 : diasBusca <= 30 ? 15 : 20
      const r = await fetch(`/api/email-cron?days=${diasBusca}&max=${maxMsgs}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      })
      const txt = await r.text()
      let j = null
      try { j = JSON.parse(txt) } catch { j = { raw: txt } }
      if (!r.ok) {
        const msg = j?.error || `HTTP ${r.status}`
        setUltimoResultado({ ok: false, msg })
        showToast('Erro: ' + msg, 'error')
        return
      }
      const found = j?.found ?? 0
      const novas = j?.processed ?? j?.nfsCriadas ?? 0
      const errs = j?.errors ?? 0
      let msg
      if (found === 0) {
        msg = 'Nenhuma nota nova no e-mail — está tudo em dia.'
      } else {
        msg = `Procurei no e-mail: ${found} documento(s) lido(s), ${novas} nova(s) esperando sua decisão abaixo.`
        if (errs > 0) msg += ` ${errs} com erro — veja no Histórico.`
        // Quando a rodada bate no teto, quase sempre há mais para trás.
        if (j?.pode_ter_mais) msg += ' Pode haver mais: clique de novo para continuar de onde parou.'
        // O teto existe para o robô não gastar sem limite. Avisar é obrigatório:
        // senão a usuária acha que acabou quando na verdade foi interrompido.
        if (j?.teto_atingido) {
          msg += ` Parei aqui: a leitura automática já custou ${(Number(j.gasto_mes_brl)||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})} neste mês, que é o limite combinado. Ela recomeça no mês que vem, ou você pode aumentar o limite.`
        }
      }
      setUltimoResultado({ ok: errs === 0, msg, data: j })
      showToast(novas > 0 ? `${novas} nova(s) NF(s) na fila` : 'Robô rodou — nada novo no e-mail', errs > 0 ? 'warning' : 'success')
      carregar()
    } catch (e) {
      console.error(e)
      setUltimoResultado({ ok: false, msg: e.message })
      showToast('Falha: ' + e.message, 'error')
    } finally {
      setRodandoCron(false)
    }
  }

  // Backfill one-time: relê anexos dos lançamentos antigos sem data de emissão
  // e preenche a competência. Roda em lotes até zerar.
  const carregar = useCallback(() => {
    if (!user) return
    setLoading(true)
    Promise.all([
      // Visão sem o arquivo em base64: desenhar a lista não precisa dele.
      supabase.from('nf_pending_lista').select('*').eq('status', 'pendente').order('created_at', { ascending: false }),
      supabase.from('nf_history').select('*').order('created_at', { ascending: false }).limit(200),
      supabase.rpc('custo_ia_do_mes'),
      // Decisões já tomadas: é onde vive o motivo de uma rejeição.
      supabase.from('nf_pending_lista').select('*').neq('status', 'pendente').order('created_at', { ascending: false }).limit(200),
      supabase.from('config_empresa').select('data').limit(1),
    ]).then(([rP, rH, rC, rD, rE]) => {
      setPendentes(rP.data || [])
      setHistorico(rH.data || [])
      setConsumo(Array.isArray(rC?.data) ? rC.data[0] : rC?.data || null)
      setDecisoes(rD.data || [])
      setEmailEntrada(rE.data?.[0]?.data?.email_entrada || '')
      setLoading(false)
    })
  }, [user])

  useEffect(() => { carregar() }, [carregar])

  // Tira a nota da caixa de entrada e põe no histórico, na hora. Recarregar a
  // tela inteira a cada decisão era o que fazia aprovar parecer lento: eram
  // cinco consultas, duas delas trazendo todos os arquivos de novo.
  function baixarDaLista(pending, status) {
    const agora = new Date().toISOString()
    setPendentes(prev => prev.filter(p => p.id !== pending.id))
    setDecisoes(prev => [
      { ...pending, status, [status === 'aprovado' ? 'approved_at' : 'rejected_at']: agora },
      ...prev,
    ])
  }

  // ── Auto-cadastra pessoa via CNPJ (se não existir) ────────────────────
  async function ensurePessoaPorCnpj({ cnpj, nome, isSaida, tipoDoc }) {
    if (!user) return null
    const cnpjClean = String(cnpj || '').replace(/\D/g, '')
    if (!cnpjClean && !nome) return null
    // Busca existente
    const { data: todas } = await supabase.from('pessoas').select('id,codigo,data')
    const existe = (todas || []).find(p => {
      const pDoc = String(p.data?.doc || '').replace(/\D/g, '')
      if (cnpjClean && pDoc === cnpjClean) return true
      return (p.data?.nome || '').toLowerCase().trim() === (nome || '').toLowerCase().trim()
    })
    if (existe) return existe
    // Cria
    const isGuia = ['DAS','DARF','GPS','GNRE'].includes(String(tipoDoc || '').toUpperCase())
    const tipo = isSaida ? 'Cliente' : (isGuia ? 'Órgão Público' : 'Fornecedor')
    const codigo = await proximoCodigoPessoa(tipo)
    const novo = {
      tipo,
      pjpf: cnpjClean.length === 14 ? 'PJ' : (cnpjClean.length === 11 ? 'PF' : 'PJ'),
      status: 'Ativo', nome: nome || '(sem nome)',
      doc: cnpjClean.length === 14
        ? cnpjClean.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
        : cnpjClean.length === 11
          ? cnpjClean.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
          : cnpjClean,
      fantasia: '', segmento: '', porte: '', situacao: '',
      email: '', telefone: '', contato_nome: '',
      logradouro: '', bairro: '', cidade: '', uf: '', cep: '',
      banco: '', agencia: '', conta: '',
      notes: 'Auto-cadastrado via Importar NFs',
      created: new Date().toISOString().slice(0, 10),
    }
    const { data: inserted, error } = await supabase.from('pessoas').insert({
      user_id: user.id, codigo, data: novo,
    }).select('id,codigo,data').single()
    if (error) { console.warn('Falha ao criar pessoa:', error); return null }
    return inserted
  }

  // ── Aprovar uma NF: gera lançamento em receivable/payable ─────────────
  async function aprovar(pending, opcoes = {}) {
    if (!user) return
    setConfirmando(pending.id)
    try {
      const d = pending.data || {}
      const isSaida = d.is_saida || d.tipo === 'saida'
      const target = d.target_table || (isSaida ? 'receivable' : 'payable')
      // 1. Garante pessoa (auto-cadastra se preciso)
      await ensurePessoaPorCnpj({
        cnpj: isSaida ? d.destinatario_cnpj : d.emitente_cnpj,
        nome: d.parte || (isSaida ? d.destinatario_nome : d.emitente_nome),
        isSaida,
        tipoDoc: d.tipo_documento,
      })
      // 2. Cria lançamento
      const cats = categoriasDe(plano, isSaida ? 'Entrada' : 'Saída')
      const sugerida = String(d.categoria_sugerida || '').trim()
      const catSugeridaValida = cats.find(c => c.toLowerCase() === sugerida.toLowerCase()) || ''
      const codigo = isSaida ? await proximoCodigoReceivable() : await proximoCodigoPayable()
      const novoLanc = {
        [isSaida ? 'client' : 'supplier']: d.parte || '(sem nome)',
        desc: d.desc_full || d.descricao,
        value: Number(d.valor || 0),
        due: d.data_vencimento || new Date().toISOString().slice(0, 10),
        data_competencia: d.data_emissao || null,
        data_pagamento: null,
        status: 'Pendente',
        forma: '',
        // Só aceita a sugestão se a categoria existir no plano de contas. Uma
        // categoria inventada faz o lançamento sumir da DRE sem aviso — melhor
        // nascer sem categoria e passar pela Escrituração.
        cat: catSugeridaValida,
        cat_sugerida: (!catSugeridaValida && d.categoria_sugerida) ? d.categoria_sugerida : undefined,
        subcat: '',
        notes: `NF importada via cron (origem: ${pending.origem || 'email'})`,
        doc_status: 'vinculado',
        sem_documento: false,
        moeda: d.moeda || 'BRL',
        valor_original: d.valor_original,
        cotacao_ptax: d.cotacao_ptax,
        numero_nf: d.numero,
        created: new Date().toISOString().slice(0, 10),
      }
      // 3. Cria o lançamento e baixa a pendência numa transação atômica (RPC).
      // Antes, se a baixa falhasse, a NF podia ser aprovada de novo → duplicata.
      const { data: novoId, error: errAprovar } = await supabase.rpc('aprovar_nf', {
        p_pending_id: pending.id, p_target: target, p_codigo: codigo, p_lanc: novoLanc,
      })
      if (errAprovar) throw errAprovar
      // 4. O arquivo da nota (base64 do robô) vai pro Storage e vira a PROVA do
      //    lançamento. Antes o lançamento nascia "Com NF" sem o documento.
      //    A lista não traz esse arquivo — ele é buscado agora, só deste
      //    documento, que é quando ele realmente serve para alguma coisa.
      let anexoB64 = null
      try {
        const { data: linha } = await supabase.from('nf_pending').select('data').eq('id', pending.id).maybeSingle()
        anexoB64 = linha?.data?.anexo || null
      } catch (eBusca) { console.warn('não consegui buscar o arquivo da nota:', eBusca) }
      if (novoId && anexoB64) {
        try {
          const path = await anexoDaNF({ ...d, anexo: anexoB64 }, { tabela: target, lancamentoId: novoId, userId: user.id })
          if (path) await supabase.from(target).update({ anexo_path: path }).eq('id', novoId)
        } catch (eAnx) { console.warn('anexo da NF não subiu:', eAnx); showToast('Lançado, mas o arquivo da nota não foi anexado — anexe pela edição.', 'warning') }
      }

      if (!opcoes.emLote) showToast(`${codigo} aprovado e lançado.`, 'success')
      baixarDaLista(pending, 'aprovado')
      return codigo
    } catch (e) {
      console.error(e)
      // Em lote, quem conta as falhas é o laço — aqui só repassa.
      if (opcoes.emLote) throw e
      showToast('Erro ao aprovar: ' + e.message, 'error')
    } finally {
      setConfirmando(null)
    }
  }

  async function salvarEmailEntrada() {
    const valor = emailForm.trim()
    if (valor && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor)) {
      showToast('Esse endereço não parece um e-mail válido.', 'warning'); return
    }
    setSalvandoEmail(true)
    try {
      const { data: atual } = await supabase.from('config_empresa').select('id, data').limit(1)
      const linha = atual?.[0]
      const novo = { ...(linha?.data || {}), email_entrada: valor || null }
      const { error } = linha
        ? await supabase.from('config_empresa').update({ data: novo }).eq('id', linha.id)
        : await supabase.from('config_empresa').insert({ user_id: user.id, data: novo })
      if (error) throw error
      setEmailEntrada(valor)
      setEditandoEmail(false)
      showToast('Endereço salvo.', 'success')
    } catch (e) {
      showToast(msgErro(e, 'Não consegui salvar o endereço.'), 'error')
    } finally { setSalvandoEmail(false) }
  }

  async function rejeitar(pending, opcoes = {}) {
    const d = pending.data || {}
    const quem = d.parte || d.emitente_nome || 'documento sem nome'
    // No lote o motivo é perguntado uma vez só, para todas.
    if (opcoes.motivo) return rejeitarComMotivo(pending, opcoes.motivo, opcoes)
    // Rejeitar é uma decisão: fica registrada com o motivo, que é o que explica
    // a escolha meses depois (e para quem audita).
    const motivo = await confirmar({
      titulo: 'Rejeitar este documento?',
      texto: `${quem}${d.valor ? ' · ' + fmtMoney(d.valor) : ''}`,
      consequencias: [
        'O documento sai da caixa de entrada e vai para o histórico.',
        'Nenhum lançamento é criado nas suas contas.',
        'O motivo abaixo fica registrado junto com a decisão.',
      ],
      exigeTexto: {
        label: 'Por que está rejeitando?',
        minimo: 3,
        placeholder: 'Ex.: não é documento fiscal · nota de outra empresa · já foi lançada',
      },
      confirmarLabel: 'Rejeitar documento',
      variante: 'perigo',
    })
    if (!motivo) return
    return rejeitarComMotivo(pending, motivo)
  }

  // A rejeição em si, já com o motivo em mãos.
  async function rejeitarComMotivo(pending, motivo, opcoes = {}) {
    const d = pending.data || {}
    try {
      const { error } = await supabase.from('nf_pending').update({
        status: 'rejeitado',
        rejected_at: new Date().toISOString(),
        data: { ...d, motivo_rejeicao: motivo },
      }).eq('id', pending.id)
      if (error) throw error
      if (!opcoes.emLote) showToast('Documento rejeitado. O motivo ficou no histórico.', 'info')
      baixarDaLista({ ...pending, data: { ...d, motivo_rejeicao: motivo } }, 'rejeitado')
    } catch (e) {
      if (opcoes.emLote) throw e
      showToast(msgErro(e, 'Não consegui rejeitar o documento.'), 'error')
    }
  }

  // ── Decidir várias de uma vez ────────────────────────────────────────────
  const marcadas = pendentes.filter(p => selecionados.has(p.id))
  const totalMarcado = marcadas.reduce((soma, p) => soma + (Number(p.data?.valor) || 0), 0)

  function alternarSelecao(id) {
    setSelecionados(prev => {
      const novo = new Set(prev)
      if (novo.has(id)) novo.delete(id); else novo.add(id)
      return novo
    })
  }

  function alternarTodas(marcar) {
    setSelecionados(marcar ? new Set(pendentes.map(p => p.id)) : new Set())
  }

  // Percorre as marcadas uma a uma. Uma que falhe não derruba as outras: ela
  // continua na caixa de entrada e aparece no aviso do final.
  async function decidirEmLote(alvos, acao, executar) {
    const falhas = []
    let feitas = 0
    setLote({ feitas: 0, total: alvos.length, acao })
    for (const p of alvos) {
      try {
        await executar(p)
        feitas++
      } catch (e) {
        falhas.push(`${p.data?.parte || 'documento'}: ${msgErro(e, 'falhou')}`)
      }
      setLote({ feitas: feitas + falhas.length, total: alvos.length, acao })
    }
    setLote(null)
    setSelecionados(new Set())
    if (falhas.length) {
      showToast(`${feitas} ${acao}(s), ${falhas.length} com erro — ${falhas[0]}`, 'warning')
    } else {
      showToast(`${feitas} documento(s) ${acao}(s).`, 'success')
    }
  }

  async function aprovarMarcadas() {
    if (!marcadas.length) return
    const ok = await confirmar({
      titulo: `Aprovar ${marcadas.length} documento(s)?`,
      texto: `Somam ${fmtMoney(totalMarcado)}`,
      consequencias: [
        'Cada um vira um lançamento novo nas suas contas.',
        'A categoria vem só como sugestão — a Escrituração continua sendo sua.',
        'Se algum falhar, ele fica na caixa de entrada e você é avisada.',
      ],
      confirmarLabel: `Aprovar ${marcadas.length}`,
    })
    if (!ok) return
    await decidirEmLote(marcadas, 'aprovado', p => aprovar(p, { emLote: true }))
  }

  async function rejeitarMarcadas() {
    if (!marcadas.length) return
    const motivo = await confirmar({
      titulo: `Rejeitar ${marcadas.length} documento(s)?`,
      texto: `Somam ${fmtMoney(totalMarcado)}`,
      consequencias: [
        'Todos saem da caixa de entrada e vão para o histórico.',
        'Nenhum lançamento é criado.',
        'O mesmo motivo fica registrado em todos.',
      ],
      exigeTexto: {
        label: 'Por que está rejeitando?',
        minimo: 3,
        placeholder: 'Ex.: não são documentos fiscais · já lançados · de outra empresa',
      },
      confirmarLabel: `Rejeitar ${marcadas.length}`,
      variante: 'perigo',
    })
    if (!motivo) return
    await decidirEmLote(marcadas, 'rejeitado', p => rejeitarComMotivo(p, motivo, { emLote: true }))
  }

  return (
    <AppLayout
      title="Caixa de entrada · NFs"
      stickyTop={(
        <div style={tabsBar}>
          <button onClick={() => setAba('aguardando')} style={aba === 'aguardando' ? tabActive : tabInactive}>
            Na caixa de entrada <span style={chip}>{pendentes.length}</span>
          </button>
          <button onClick={() => setAba('historico')} style={aba === 'historico' ? tabActive : tabInactive}>
            Histórico <span style={chip}>{historico.length}</span>
          </button>
          <button onClick={() => setAba('upload')} style={aba === 'upload' ? tabActive : tabInactive}>
            Upload Manual
          </button>
          {consumo && (
            <span
              style={contadorCusto}
              title={Number(consumo.documentos) > 0
                ? `${consumo.documentos} documento(s) lido(s) pelo robô neste mês · média de ${fmtMoney((Number(consumo.custo_brl) || 0) / Number(consumo.documentos))} por documento`
                : 'A medição começou agora: as leituras anteriores não foram registradas.'}
            >
              robô · {fmtMoney(Number(consumo.custo_brl) || 0)} no mês
            </span>
          )}
        </div>
      )}
    >

      {loading ? (
        <div style={emptyState}>Carregando…</div>
      ) : aba === 'aguardando' ? (
        <>
        <div style={ajudaBox}>
          Toda nota que chega por e-mail ou upload fica aqui até você decidir: <strong>Aprovar</strong> (vira lançamento novo)
          ou <strong>Anexar</strong> a um lançamento que já existe (ex.: compra do cartão já importada, conta já lançada).
          Nada sai da caixa sem decisão.
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--text-mid)' }}>
            {editandoEmail ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span>Endereço que recebe as notas:</span>
                <input
                  value={emailForm}
                  onChange={e => setEmailForm(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') salvarEmailEntrada(); if (e.key === 'Escape') setEditandoEmail(false) }}
                  placeholder={EMAIL_SUGERIDO || 'financeiro@suaempresa.com.br'}
                  autoFocus
                  style={inputEmail}
                />
                <button onClick={salvarEmailEntrada} disabled={salvandoEmail} style={btnMini}>{salvandoEmail ? 'Salvando…' : 'Salvar'}</button>
                <button onClick={() => setEditandoEmail(false)} style={btnMiniGhost}>Cancelar</button>
              </span>
            ) : (
              <>
                {emailEntrada
                  ? <>As notas enviadas para <strong>{emailEntrada}</strong> chegam aqui sozinhas.</>
                  : <>Ainda não há um endereço configurado para receber as notas.</>}
                {' '}
                <button onClick={() => { setEmailForm(emailEntrada || EMAIL_SUGERIDO); setEditandoEmail(true) }} style={btnLinkMini}>
                  {emailEntrada ? 'alterar' : 'configurar'}
                </button>
                {emailEntrada && ' · Use o botão para procurar agora.'}
              </>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select value={diasBusca} onChange={e => setDiasBusca(Number(e.target.value))} disabled={rodandoCron} style={selectPeriodo} title="Quanto tempo para trás procurar no e-mail">
              <option value={7}>últimos 7 dias</option>
              <option value={30}>últimos 30 dias</option>
              <option value={90}>últimos 3 meses</option>
              <option value={365}>últimos 12 meses</option>
            </select>
            <button onClick={rodarCron} disabled={rodandoCron} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 6, border: '1.5px solid var(--navy)', background: rodandoCron ? 'var(--cream)' : 'var(--navy)', color: rodandoCron ? 'var(--text-mid)' : '#fff', fontFamily: 'var(--body)', fontSize: 11, fontWeight: 700, letterSpacing: 0.5, cursor: rodandoCron ? 'not-allowed' : 'pointer', textTransform: 'uppercase' }}>
              {rodandoCron ? '⏳ Procurando…' : '🔄 Procurar no e-mail'}
            </button>
          </div>
        </div>
        {ultimoResultado && (
          <div style={{ marginBottom: 14, padding: 12, borderRadius: 6, fontSize: 12, background: ultimoResultado.ok ? 'rgba(39,174,96,0.08)' : 'rgba(231,76,60,0.08)', borderLeft: `3px solid ${ultimoResultado.ok ? 'var(--green)' : 'var(--red)'}`, color: ultimoResultado.ok ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
            {ultimoResultado.ok ? '✓' : '⚠'} {ultimoResultado.msg}
          </div>
        )}
        {pendentes.length === 0 ? (
          <div style={emptyState}>
            ✨ Nenhuma nota esperando. As notas que chegam por e-mail aparecem aqui para você decidir — aprovar, anexar a um lançamento que já existe, ou rejeitar. Nada entra nas suas contas antes dessa decisão.
          </div>
        ) : (
          <>
            {selecionados.size > 0 && (
              <div style={barraLote}>
                <span><strong>{selecionados.size}</strong> de {pendentes.length} marcada(s) · somam <strong>{fmtMoney(totalMarcado)}</strong></span>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                  <button onClick={() => alternarTodas(false)} disabled={!!lote} style={btnMiniGhost}>Limpar</button>
                  <button onClick={rejeitarMarcadas} disabled={!!lote} style={btnMiniPerigo}>Rejeitar marcadas</button>
                  <button onClick={aprovarMarcadas} disabled={!!lote} style={btnMini}>✓ Aprovar marcadas</button>
                </span>
              </div>
            )}
            {lote && (
              <div style={avisoLote}>
                {lote.acao === 'rejeitado' ? 'Rejeitando' : 'Aprovando'} {lote.feitas} de {lote.total}…
              </div>
            )}
            <PendingTable
              pendentes={pendentes}
              selecionados={selecionados}
              processando={confirmando}
              emLote={!!lote}
              onAlternar={alternarSelecao}
              onAlternarTodas={alternarTodas}
              onAprovar={p => aprovar(p)}
              onRejeitar={p => rejeitar(p)}
              onAnexar={p => setAnexando(p)}
            />
          </>
        )}
        {dialogoConfirmacao}
      <SeletorLancamento
          open={!!anexando}
          nf={anexando}
          user={user}
          onClose={() => setAnexando(null)}
          onVinculado={() => { const nf = anexando; setAnexando(null); if (nf) baixarDaLista(nf, 'aprovado') }}
        />
        </>
      ) : aba === 'historico' ? (
        historico.length === 0 ? (
          <div style={emptyState}>Nenhuma NF processada ainda.</div>
        ) : (
          <HistoricoTable historico={historico} decisoes={decisoes} />
        )
      ) : (
        <UploadManualCard emailEntrada={emailEntrada} />
      )}
    </AppLayout>
  )
}

// A caixa de entrada é uma FILA DE TRABALHO: o que importa é ver muitas de uma
// vez e decidir. Em cards, cada nota ocupava meia tela e obrigava a rolar; em
// linha, as mesmas informações cabem numa olhada — e dá para marcar várias.
function PendingTable({ pendentes, selecionados, processando, emLote, onAlternar, onAlternarTodas, onAprovar, onRejeitar, onAnexar }) {
  const todasMarcadas = pendentes.length > 0 && pendentes.every(p => selecionados.has(p.id))
  return (
    <div style={{ background: 'var(--white)', border: '1px solid var(--cream-dark)', borderRadius: 8, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...th, width: 36, textAlign: 'center' }}>
              <input
                type="checkbox"
                checked={todasMarcadas}
                onChange={e => onAlternarTodas(e.target.checked)}
                title={todasMarcadas ? 'Desmarcar todas' : 'Marcar todas'}
                style={caixaSelecao}
              />
            </th>
            <th style={{ ...th, width: 86 }}>Tipo</th>
            <th style={{ ...th, width: 92 }}>Nº</th>
            <th style={th}>Quem · o quê</th>
            <th style={{ ...th, width: 84 }}>Emissão</th>
            <th style={{ ...th, width: 92 }}>Vencimento</th>
            <th style={{ ...th, width: 118, textAlign: 'right' }}>Valor</th>
            <th style={{ ...th, width: 176, textAlign: 'right' }}>Decisão</th>
          </tr>
        </thead>
        <tbody>
          {pendentes.map(p => {
            const d = p.data || {}
            const isSaida = d.is_saida || d.tipo === 'saida'
            const cor = isSaida ? 'var(--green)' : 'var(--red)'
            const marcada = selecionados.has(p.id)
            const ocupada = processando === p.id
            return (
              <tr key={p.id} style={{ background: marcada ? 'rgba(204,145,94,0.08)' : 'transparent' }}>
                <td style={{ ...td, textAlign: 'center' }}>
                  <input type="checkbox" checked={marcada} onChange={() => onAlternar(p.id)} style={caixaSelecao} />
                </td>
                <td style={td}>
                  <span style={chipTipo} title={isSaida ? 'Receita — nota emitida pela empresa' : 'Despesa — nota recebida'}>
                    {d.tipo_documento || 'NF'}
                  </span>
                </td>
                <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>{d.numero || '—'}</td>
                <td style={td}>
                  <div style={{ fontWeight: 600, color: 'var(--navy)' }}>{d.parte || '(parte não identificada)'}</div>
                  <div style={linhaSecundaria} title={d.descricao || d.fileName}>{d.descricao || d.fileName || '—'}</div>
                </td>
                <td style={{ ...td, color: 'var(--text-mid)', fontSize: 11 }}>{fmtData(d.data_emissao)}</td>
                <td style={{ ...td, color: 'var(--text-mid)', fontSize: 11 }}>{fmtData(d.data_vencimento)}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: cor, whiteSpace: 'nowrap' }}>
                  {isSaida ? '+' : '−'} {fmtMoney(d.valor)}
                  {d.moeda && d.moeda !== 'BRL' && (
                    <div style={{ fontSize: 9, fontWeight: 400, color: 'var(--text-mid)' }}>
                      orig {d.moeda} {Number(d.valor_original || 0).toFixed(2)}
                    </div>
                  )}
                </td>
                <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button onClick={() => onAprovar(p)} disabled={ocupada || emLote} style={btnLinha} title="Aprovar e lançar">
                    {ocupada ? '…' : '✓ Aprovar'}
                  </button>
                  <button onClick={() => onAnexar(p)} disabled={ocupada || emLote} style={btnLinhaGhost} title="Anexar a um lançamento que já existe — o valor não é lançado de novo">
                    🔗
                  </button>
                  <button onClick={() => onRejeitar(p)} disabled={ocupada || emLote} style={btnLinhaPerigo} title="Rejeitar (pede o motivo)">
                    ✕
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// O que apareceu no lugar do status cru do robô ('ok', 'sem_anexo'...).
const TEXTO_STATUS = {
  ok: 'Lido e colocado na caixa de entrada',
  sem_anexo: 'E-mail sem documento anexado',
  sem_lancamento: 'Lido, mas não virou lançamento',
  descartado: 'Descartado: não era documento fiscal',
  duplicado: 'Já existia no sistema',
  error: 'Erro ao ler',
  rejeitado: 'Rejeitado por você',
  aprovado: 'Aprovado e lançado',
}

function HistoricoTable({ historico, decisoes = [] }) {
  const [dataDe, setDataDe] = useState('')
  const [dataAte, setDataAte] = useState('')
  // Duas origens, uma linha do tempo só: o que o robô leu e o que você decidiu.
  const linhas = [
    ...historico.map(h => ({
      id: 'h_' + h.id,
      quando: h.created_at,
      tipo: h.data?.tipo_documento,
      numero: h.data?.numero,
      parte: h.data?.parte,
      valor: h.data?.valor,
      status: h.data?.status,
      motivo: h.data?.motivo || h.data?.erro || '',
    })),
    ...decisoes.map(p => ({
      id: 'd_' + p.id,
      quando: p.rejected_at || p.approved_at || p.updated_at || p.created_at,
      tipo: p.data?.tipo_documento,
      numero: p.data?.numero,
      parte: p.data?.parte,
      valor: p.data?.valor,
      status: p.status,
      motivo: p.data?.motivo_rejeicao || '',
    })),
  ].sort((a, b) => String(b.quando || '').localeCompare(String(a.quando || '')))
  const filtrado = linhas.filter(h => {
    const v = h.quando ? String(h.quando).slice(0, 10) : ''
    if (!v) return true
    if (dataDe && v < dataDe) return false
    if (dataAte && v > dataAte) return false
    return true
  })
  return (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', padding: '10px 14px', background: 'var(--white)', borderRadius: 10, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)' }}>
        <span style={{ fontSize: 11, color: 'var(--text-mid)', fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase' }}>Data</span>
        <input type="date" value={dataDe} onChange={e => setDataDe(e.target.value)} style={inputDataNF} title="De" />
        <span style={{ fontSize: 11, color: 'var(--text-mid)' }}>até</span>
        <input type="date" value={dataAte} onChange={e => setDataAte(e.target.value)} style={inputDataNF} title="Até" />
        {(dataDe || dataAte) && (
          <button onClick={() => { setDataDe(''); setDataAte('') }} style={{ background: 'none', border: 'none', color: 'var(--text-mid)', cursor: 'pointer', fontSize: 14, fontWeight: 700, padding: '4px 6px' }} title="Limpar">×</button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-mid)' }}>{filtrado.length} de {linhas.length}</span>
      </div>
      <div style={tableWrap}>
        <table style={tbl}>
          <thead>
            <tr>
              <th style={th}>Data</th>
              <th style={th}>Tipo</th>
              <th style={{ ...th, width: 110 }}>Nº NF</th>
              <th style={th}>Parte</th>
              <th style={{ ...th, width: 130, textAlign: 'right' }}>Valor</th>
              <th style={{ ...th, width: 230 }}>O que aconteceu</th>
            </tr>
          </thead>
          <tbody>
            {filtrado.map(h => (
            <tr key={h.id}>
              <td style={{ ...td, color: 'var(--text-mid)' }}>{h.quando ? new Date(h.quando).toLocaleDateString('pt-BR') : '—'}</td>
              <td style={{ ...td }}>{h.tipo || '—'}</td>
              <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>{h.numero || '—'}</td>
              <td style={td}>{h.parte || '—'}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{fmtMoney(h.valor)}</td>
              <td style={{ ...td, fontSize: 11 }}>
                <span style={{ color: h.status === 'rejeitado' ? 'var(--red)' : h.status === 'aprovado' ? 'var(--green)' : 'var(--text-mid)' }}>
                  {TEXTO_STATUS[h.status] || h.status || '—'}
                </span>
                {h.motivo && <div style={{ color: 'var(--text-mid)', fontStyle: 'italic', marginTop: 2 }}>“{h.motivo}”</div>}
              </td>
            </tr>
          ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function UploadManualCard({ emailEntrada }) {
  return (
    <div style={emptyState}>
      <div style={{ fontSize: 22, marginBottom: 12 }}>📤</div>
      <div style={{ fontSize: 14, color: 'var(--navy)', fontWeight: 600, marginBottom: 6 }}>Upload manual</div>
      <div style={{ fontSize: 12, color: 'var(--text-mid)', maxWidth: 480, margin: '0 auto', lineHeight: 1.5 }}>
        Em preparação. Por enquanto, encaminhe a nota
        {emailEntrada ? <> para <strong>{emailEntrada}</strong></> : <> para o endereço configurado na caixa de entrada</>}
        {' '}— em segundos ela aparece na caixa de entrada.
      </div>
    </div>
  )
}

const caixaSelecao = { width: 15, height: 15, accentColor: 'var(--gold-dark)', cursor: 'pointer', verticalAlign: 'middle' }
const chipTipo = { fontSize: 9, fontWeight: 700, color: 'var(--gold-dark)', letterSpacing: 0.6, textTransform: 'uppercase', background: 'rgba(204,145,94,0.12)', padding: '2px 7px', borderRadius: 999, whiteSpace: 'nowrap' }
const linhaSecundaria = { fontSize: 11, color: 'var(--text-mid)', maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const btnLinha = { padding: '4px 10px', marginLeft: 4, borderRadius: 5, border: 'none', background: 'var(--gold-dark)', color: '#fff', fontFamily: 'var(--body)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }
const btnLinhaGhost = { padding: '4px 8px', marginLeft: 4, borderRadius: 5, border: '1px solid var(--cream-dark)', background: 'var(--white)', color: 'var(--navy)', fontSize: 11, cursor: 'pointer' }
const btnLinhaPerigo = { padding: '4px 8px', marginLeft: 4, borderRadius: 5, border: '1px solid var(--cream-dark)', background: 'var(--white)', color: 'var(--red)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }
const barraLote = { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', marginBottom: 10, borderRadius: 7, background: 'rgba(204,145,94,0.10)', border: '1px solid rgba(204,145,94,0.35)', fontSize: 12, color: 'var(--navy)' }
const avisoLote = { padding: '8px 14px', marginBottom: 10, borderRadius: 7, background: 'var(--cream)', fontSize: 12, fontWeight: 600, color: 'var(--text-mid)' }
const btnMiniPerigo = { padding: '5px 12px', borderRadius: 6, border: '1.5px solid var(--red)', background: 'var(--white)', color: 'var(--red)', fontFamily: 'var(--body)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }
const inputEmail = { padding: '5px 9px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 12, color: 'var(--navy)', background: 'var(--white)', outline: 'none', minWidth: 240 }
const btnMini = { padding: '5px 12px', borderRadius: 6, border: 'none', background: 'var(--navy)', color: '#fff', fontFamily: 'var(--body)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }
const btnMiniGhost = { padding: '5px 10px', borderRadius: 6, border: '1.5px solid var(--cream-dark)', background: 'var(--white)', color: 'var(--text-mid)', fontFamily: 'var(--body)', fontSize: 11, fontWeight: 600, cursor: 'pointer' }
const btnLinkMini = { background: 'none', border: 'none', padding: 0, color: 'var(--gold-dark)', fontFamily: 'var(--body)', fontSize: 12, fontWeight: 700, textDecoration: 'underline', cursor: 'pointer' }
const selectPeriodo = { padding: '8px 10px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 11, fontWeight: 600, color: 'var(--navy)', background: 'var(--white)', outline: 'none', cursor: 'pointer' }
const tabsBar = { display: 'flex', alignItems: 'center', gap: 4, marginBottom: 16, background: 'var(--cream)', padding: 4, borderRadius: 8 }
const contadorCusto = { marginLeft: 'auto', marginRight: 6, fontSize: 10, fontWeight: 600, letterSpacing: 0.3, color: 'var(--text-mid)', whiteSpace: 'nowrap', cursor: 'default' }
const tabBase = { border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 11, fontWeight: 700, letterSpacing: 0.6, cursor: 'pointer', fontFamily: 'var(--body)', textTransform: 'uppercase', display: 'inline-flex', alignItems: 'center', gap: 6 }
const tabActive = { ...tabBase, background: 'var(--navy)', color: '#fff' }
const tabInactive = { ...tabBase, background: 'transparent', color: 'var(--text-mid)' }
const chip = { padding: '2px 7px', borderRadius: 999, fontSize: 10, background: 'rgba(0,0,0,0.10)' }
const inputDataNF = { padding: '7px 10px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 12, color: 'var(--navy)', background: 'var(--white)', outline: 'none' }
const ajudaBox = { marginBottom: 14, padding: '10px 14px', borderRadius: 6, fontSize: 12, lineHeight: 1.55, background: 'rgba(0,32,62,0.04)', borderLeft: '3px solid var(--navy)', color: 'var(--navy)' }
const tableWrap = { background: 'var(--white)', borderRadius: 12, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)', overflow: 'clip' }
const tbl = { width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--body)' }
const th = { textAlign: 'left', padding: '12px 14px', fontSize: 9, fontWeight: 700, letterSpacing: 1.5, color: '#fff', textTransform: 'uppercase', background: 'var(--navy)', borderBottom: '2px solid var(--gold)' }
const td = { padding: '12px 14px', fontSize: 12, color: 'var(--navy)', borderBottom: '1px solid var(--cream-dark)', verticalAlign: 'middle' }
const emptyState = { padding: '60px 24px', textAlign: 'center', fontFamily: 'var(--body)', color: 'var(--text-mid)', fontSize: 13, background: 'var(--white)', borderRadius: 12, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)', lineHeight: 1.5 }
