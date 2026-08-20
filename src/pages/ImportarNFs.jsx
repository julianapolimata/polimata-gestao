import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import AppLayout from '../components/AppLayout'
import { showToast } from '../components/Toast'
import { fmtMoney } from '../lib/finance'
import { proximoCodigoReceivable, proximoCodigoPayable, proximoCodigoPessoa } from '../lib/codigos'

// =====================================================================
// IMPORTAR NFs v2 — tela de governança das NFs processadas pelo cron
// (api/email-cron.js) + upload manual.
//
// 3 abas:
//  - Aguardando: nf_pending status=pendente — revisão humana antes de
//    virar lançamento oficial.
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
  const [rodandoBackfill, setRodandoBackfill] = useState(false)
  const [backfillMsg, setBackfillMsg] = useState(null)
  const [rodandoReproc, setRodandoReproc] = useState(false)
  const [reprocMsg, setReprocMsg] = useState(null)

  async function rodarCron() {
    setRodandoCron(true)
    setUltimoResultado(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { showToast('Sessão expirada — faça login novamente.', 'error'); return }
      const r = await fetch('/api/email-cron?days=7&max=10', {
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
        msg = `Verifiquei o e-mail: ${found} documento(s) encontrado(s), ${novas} nova(s) na fila.`
        if (errs > 0) msg += ` ${errs} com erro — veja no Histórico.`
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
  async function rodarBackfill() {
    if (!confirm('Reler os anexos das notas antigas que estão sem data de emissão e preencher a competência automaticamente? Pode levar até ~1 minuto.')) return
    setRodandoBackfill(true)
    setBackfillMsg('Lendo os anexos…')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { showToast('Sessão expirada — faça login novamente.', 'error'); return }
      let totalOk = 0, totalSemData = 0, restantes = 0
      for (let i = 0; i < 12; i++) {
        const r = await fetch('/api/backfill-competencia', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${session.access_token}` },
        })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) { showToast('Erro no backfill: ' + (j?.error || `HTTP ${r.status}`), 'error'); break }
        totalOk += j?.resumo?.ok || 0
        totalSemData += (j?.resumo?.sem_data || 0) + (j?.resumo?.sem_anexo || 0)
        restantes = j?.restantes ?? 0
        setBackfillMsg(`${totalOk} recuperada(s)…${restantes > 0 ? ` (${restantes} restantes)` : ''}`)
        if (restantes <= 0) break
      }
      setBackfillMsg(`Concluído: ${totalOk} competência(s) recuperada(s)${totalSemData ? ` · ${totalSemData} sem data legível no documento` : ''}.`)
      showToast(`Backfill: ${totalOk} recuperada(s).`, 'success')
      carregar()
    } catch (e) {
      showToast('Falha no backfill: ' + e.message, 'error')
    } finally {
      setRodandoBackfill(false)
    }
  }

  // Reprocessa e-mails que o robô marcou como "lido" mas não conseguiu ler
  // (durante a queda do modelo). Relê cada um pelo ID, com o modelo novo.
  async function reprocessarFalhas() {
    if (!confirm('Reprocessar os e-mails que o robô marcou como "lido" mas não conseguiu ler (durante a queda do modelo jun–ago)? Vai reler cada um com o modelo novo e colocar as NFs/guias na fila de aprovação.')) return
    setRodandoReproc(true)
    setReprocMsg('Relendo os e-mails que falharam…')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { showToast('Sessão expirada — faça login novamente.', 'error'); return }
      let totalNovas = 0
      for (let i = 0; i < 15; i++) {
        const r = await fetch('/api/email-cron?reprocess=1&max=3', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${session.access_token}` },
        })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) { showToast('Erro ao reprocessar: ' + (j?.error || `HTTP ${r.status}`), 'error'); break }
        const found = j?.found ?? 0
        totalNovas += j?.processed ?? 0
        setReprocMsg(`${totalNovas} recuperada(s)…${found > 0 ? ` (${found} nesta rodada)` : ''}`)
        if (found === 0) break
      }
      setReprocMsg(`Concluído: ${totalNovas} NF(s)/guia(s) recuperada(s) e colocada(s) na fila.`)
      showToast(`Reprocessamento: ${totalNovas} recuperada(s).`, 'success')
      carregar()
    } catch (e) {
      showToast('Falha ao reprocessar: ' + e.message, 'error')
    } finally {
      setRodandoReproc(false)
    }
  }

  const carregar = useCallback(() => {
    if (!user) return
    setLoading(true)
    Promise.all([
      supabase.from('nf_pending').select('*').eq('status', 'pendente').order('created_at', { ascending: false }),
      supabase.from('nf_history').select('*').order('created_at', { ascending: false }).limit(200),
    ]).then(([rP, rH]) => {
      setPendentes(rP.data || [])
      setHistorico(rH.data || [])
      setLoading(false)
    })
  }, [user])

  useEffect(() => { carregar() }, [carregar])

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
  async function aprovar(pending) {
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
        cat: d.categoria_sugerida || '',
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
      const { error: errAprovar } = await supabase.rpc('aprovar_nf', {
        p_pending_id: pending.id, p_target: target, p_codigo: codigo, p_lanc: novoLanc,
      })
      if (errAprovar) throw errAprovar

      showToast(`${codigo} aprovado e lançado.`, 'success')
      carregar()
    } catch (e) {
      console.error(e)
      showToast('Erro ao aprovar: ' + e.message, 'error')
    } finally {
      setConfirmando(null)
    }
  }

  async function rejeitar(pending) {
    if (!confirm('Rejeitar essa NF? Ela vai pro histórico marcada como descartada.')) return
    await supabase.from('nf_pending').update({
      status: 'rejeitado', rejected_at: new Date().toISOString(),
    }).eq('id', pending.id)
    showToast('NF rejeitada.', 'info')
    carregar()
  }

  return (
    <AppLayout
      title="Importar NFs"
      stickyTop={(
        <div style={tabsBar}>
          <button onClick={() => setAba('aguardando')} style={aba === 'aguardando' ? tabActive : tabInactive}>
            Aguardando <span style={chip}>{pendentes.length}</span>
          </button>
          <button onClick={() => setAba('historico')} style={aba === 'historico' ? tabActive : tabInactive}>
            Histórico <span style={chip}>{historico.length}</span>
          </button>
          <button onClick={() => setAba('upload')} style={aba === 'upload' ? tabActive : tabInactive}>
            Upload Manual
          </button>
        </div>
      )}
    >

      {loading ? (
        <div style={emptyState}>Carregando…</div>
      ) : aba === 'aguardando' ? (
        <>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--text-mid)' }}>
            Cron processa emails em <strong>financeiro@polimatagrc.com.br</strong> automaticamente.
            Use o botão se quiser forçar verificação imediata.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={rodarBackfill} disabled={rodandoBackfill} title="Relê os anexos das notas antigas que estão sem data de emissão e preenche a competência" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 6, border: '1.5px solid var(--gold-dark)', background: rodandoBackfill ? 'var(--cream)' : '#fff', color: 'var(--gold-dark)', fontFamily: 'var(--body)', fontSize: 11, fontWeight: 700, letterSpacing: 0.5, cursor: rodandoBackfill ? 'not-allowed' : 'pointer', textTransform: 'uppercase' }}>
              {rodandoBackfill ? '⏳ Lendo…' : '📅 Recuperar competências'}
            </button>
            <button onClick={reprocessarFalhas} disabled={rodandoReproc} title="Relê os e-mails que o robô não conseguiu ler durante a queda do modelo (jun–ago) e coloca as NFs/guias na fila" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 6, border: '1.5px solid var(--navy)', background: rodandoReproc ? 'var(--cream)' : '#fff', color: 'var(--navy)', fontFamily: 'var(--body)', fontSize: 11, fontWeight: 700, letterSpacing: 0.5, cursor: rodandoReproc ? 'not-allowed' : 'pointer', textTransform: 'uppercase' }}>
              {rodandoReproc ? '⏳ Relendo…' : '📥 Reprocessar falhas'}
            </button>
            <button onClick={rodarCron} disabled={rodandoCron} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 6, border: '1.5px solid var(--navy)', background: rodandoCron ? 'var(--cream)' : 'var(--navy)', color: rodandoCron ? 'var(--text-mid)' : '#fff', fontFamily: 'var(--body)', fontSize: 11, fontWeight: 700, letterSpacing: 0.5, cursor: rodandoCron ? 'not-allowed' : 'pointer', textTransform: 'uppercase' }}>
              {rodandoCron ? '⏳ Verificando…' : '🔄 Verificar emails agora'}
            </button>
          </div>
        </div>
        {ultimoResultado && (
          <div style={{ marginBottom: 14, padding: 12, borderRadius: 6, fontSize: 12, background: ultimoResultado.ok ? 'rgba(39,174,96,0.08)' : 'rgba(231,76,60,0.08)', borderLeft: `3px solid ${ultimoResultado.ok ? 'var(--green)' : 'var(--red)'}`, color: ultimoResultado.ok ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
            {ultimoResultado.ok ? '✓' : '⚠'} {ultimoResultado.msg}
          </div>
        )}
        {backfillMsg && (
          <div style={{ marginBottom: 14, padding: 12, borderRadius: 6, fontSize: 12, background: 'rgba(204,145,94,0.10)', borderLeft: '3px solid var(--gold-dark)', color: 'var(--gold-dark)', fontWeight: 600 }}>
            📅 {backfillMsg}
          </div>
        )}
        {reprocMsg && (
          <div style={{ marginBottom: 14, padding: 12, borderRadius: 6, fontSize: 12, background: 'rgba(0,32,62,0.05)', borderLeft: '3px solid var(--navy)', color: 'var(--navy)', fontWeight: 600 }}>
            📥 {reprocMsg}
          </div>
        )}
        {pendentes.length === 0 ? (
          <div style={emptyState}>
            ✨ Nada na fila! O cron (rodando em <code>api/email-cron.js</code>) processa emails em <strong>financeiro@polimatagrc.com.br</strong> e coloca aqui as NFs detectadas pra você aprovar antes de virarem lançamentos.
          </div>
        ) : (
          <div style={lista}>
            {pendentes.map(p => (
              <PendingCard key={p.id} pending={p} processando={confirmando === p.id} onAprovar={() => aprovar(p)} onRejeitar={() => rejeitar(p)} />
            ))}
          </div>
        )}
        </>
      ) : aba === 'historico' ? (
        historico.length === 0 ? (
          <div style={emptyState}>Nenhuma NF processada ainda.</div>
        ) : (
          <HistoricoTable historico={historico} />
        )
      ) : (
        <UploadManualCard />
      )}
    </AppLayout>
  )
}

function PendingCard({ pending, processando, onAprovar, onRejeitar }) {
  const d = pending.data || {}
  const isSaida = d.is_saida || d.tipo === 'saida'
  const corLeft = isSaida ? 'var(--green)' : 'var(--red)'
  return (
    <div style={{ ...card, borderLeft: `3px solid ${corLeft}` }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--gold)', letterSpacing: 1, textTransform: 'uppercase', background: 'rgba(204,145,94,0.10)', padding: '3px 8px', borderRadius: 999 }}>
              {d.tipo_documento || 'NF'}
            </span>
            {d.numero && <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-mid)', fontFamily: 'monospace' }}>nº {d.numero}</span>}
            <span style={{ fontSize: 10, color: 'var(--text-mid)' }}>{d.fileName}</span>
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--navy)', marginBottom: 4 }}>{d.parte || '(parte não identificada)'}</div>
          <div style={{ fontSize: 12, color: 'var(--text-mid)' }}>{d.descricao || '(sem descrição)'}</div>
          <div style={{ display: 'flex', gap: 18, marginTop: 10, fontSize: 11, color: 'var(--text-mid)', flexWrap: 'wrap' }}>
            <div>📄 Emissão: <strong>{fmtData(d.data_emissao)}</strong></div>
            <div>📅 Vencimento: <strong>{fmtData(d.data_vencimento)}</strong></div>
            {(isSaida ? d.destinatario_cnpj : d.emitente_cnpj) && <div style={{ fontFamily: 'monospace' }}>CNPJ {isSaida ? d.destinatario_cnpj : d.emitente_cnpj}</div>}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: corLeft }}>{isSaida ? '+' : '−'} {fmtMoney(d.valor)}</div>
          {d.moeda && d.moeda !== 'BRL' && (
            <div style={{ fontSize: 10, color: 'var(--text-mid)', marginTop: 2 }}>
              orig {d.moeda} {Number(d.valor_original || 0).toFixed(2)} · PTAX {Number(d.cotacao_ptax || 0).toFixed(4)}
            </div>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--cream-dark)' }}>
        <button onClick={onRejeitar} disabled={processando} style={btnGhost}>Rejeitar</button>
        <button onClick={onAprovar} disabled={processando} style={btnPrimary}>
          {processando ? 'Processando…' : '✓ Aprovar e lançar'}
        </button>
      </div>
    </div>
  )
}

function HistoricoTable({ historico }) {
  const [dataDe, setDataDe] = useState('')
  const [dataAte, setDataAte] = useState('')
  const filtrado = historico.filter(h => {
    const v = h.created_at ? h.created_at.slice(0, 10) : ''
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
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-mid)' }}>{filtrado.length} de {historico.length}</span>
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
              <th style={{ ...th, width: 200 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtrado.map(h => (
            <tr key={h.id}>
              <td style={{ ...td, color: 'var(--text-mid)' }}>{new Date(h.created_at).toLocaleDateString('pt-BR')}</td>
              <td style={{ ...td }}>{h.data?.tipo_documento || '—'}</td>
              <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>{h.data?.numero || '—'}</td>
              <td style={td}>{h.data?.parte || '—'}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{fmtMoney(h.data?.valor)}</td>
              <td style={{ ...td, fontSize: 11, color: 'var(--text-mid)' }}>{h.data?.status || '—'}</td>
            </tr>
          ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function UploadManualCard() {
  return (
    <div style={emptyState}>
      <div style={{ fontSize: 22, marginBottom: 12 }}>📤</div>
      <div style={{ fontSize: 14, color: 'var(--navy)', fontWeight: 600, marginBottom: 6 }}>Upload manual</div>
      <div style={{ fontSize: 12, color: 'var(--text-mid)', maxWidth: 480, margin: '0 auto', lineHeight: 1.5 }}>
        O envio manual de PDFs/XMLs será habilitado num PR seguinte (usa o mesmo endpoint <code>api/anthropic.js</code>).
        Por enquanto, encaminhe a NF pro email <strong>financeiro@polimatagrc.com.br</strong> e o cron processa em segundos.
      </div>
    </div>
  )
}

const tabsBar = { display: 'flex', gap: 4, marginBottom: 16, background: 'var(--cream)', padding: 4, borderRadius: 8, width: 'fit-content' }
const tabBase = { border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 11, fontWeight: 700, letterSpacing: 0.6, cursor: 'pointer', fontFamily: 'var(--body)', textTransform: 'uppercase', display: 'inline-flex', alignItems: 'center', gap: 6 }
const tabActive = { ...tabBase, background: 'var(--navy)', color: '#fff' }
const tabInactive = { ...tabBase, background: 'transparent', color: 'var(--text-mid)' }
const chip = { padding: '2px 7px', borderRadius: 999, fontSize: 10, background: 'rgba(0,0,0,0.10)' }
const inputDataNF = { padding: '7px 10px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 12, color: 'var(--navy)', background: 'var(--white)', outline: 'none' }
const lista = { display: 'flex', flexDirection: 'column', gap: 10 }
const card = { background: 'var(--white)', borderRadius: 10, padding: 16, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)' }
const btnGhost = { padding: '7px 14px', borderRadius: 6, border: '1.5px solid var(--cream-dark)', background: 'var(--white)', color: 'var(--text-mid)', fontFamily: 'var(--body)', fontSize: 11, fontWeight: 600, cursor: 'pointer', letterSpacing: 0.5, textTransform: 'uppercase' }
const btnPrimary = { padding: '7px 14px', borderRadius: 6, border: 'none', background: 'var(--gold)', color: '#fff', fontFamily: 'var(--body)', fontSize: 11, fontWeight: 700, cursor: 'pointer', letterSpacing: 0.5, textTransform: 'uppercase' }
const tableWrap = { background: 'var(--white)', borderRadius: 12, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)', overflow: 'clip' }
const tbl = { width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--body)' }
const th = { textAlign: 'left', padding: '12px 14px', fontSize: 9, fontWeight: 700, letterSpacing: 1.5, color: '#fff', textTransform: 'uppercase', background: 'var(--navy)', borderBottom: '2px solid var(--gold)' }
const td = { padding: '12px 14px', fontSize: 12, color: 'var(--navy)', borderBottom: '1px solid var(--cream-dark)', verticalAlign: 'middle' }
const emptyState = { padding: '60px 24px', textAlign: 'center', fontFamily: 'var(--body)', color: 'var(--text-mid)', fontSize: 13, background: 'var(--white)', borderRadius: 12, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)', lineHeight: 1.5 }
