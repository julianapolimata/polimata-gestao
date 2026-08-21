import { useEffect, useMemo, useState } from 'react'
import Modal from '../../components/Modal'
import { showToast } from '../../components/Toast'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { proximoCodigoReceivable, proximoCodigoPayable, proximosCodigosPayable } from '../../lib/codigos'
import { uploadAnexo, getAnexoSignedUrl, deleteAnexo, nomeAnexoFromPath } from '../../lib/anexos'
import { detectarParcela, removerSufixoParcela, gerarParcelas } from '../../lib/parcelas'
import { fetchPlanoContas, categoriasDe, subcategoriasDe } from '../../lib/planoContas'

// =============================================================================
// MODAL LANÇAMENTO — serve Contas a Receber (tipo='rec') e Pagar (tipo='pay').
// Replica o saveReceivable() / savePayable() do legado (linhas 2845/3008).
// =============================================================================

const FORMAS_REC = ['Pix/Transferência', 'Boleto', 'Cartão de Crédito']
const FORMAS_PAY = ['Pix/Transferência', 'Boleto', 'Cartão de Crédito', 'Débito Automático', 'Dinheiro']
const STATUSES_REC = ['Pendente', 'Recebido', 'Atrasado']
const STATUSES_PAY = ['Pendente', 'Pago', 'Atrasado']
const TIPOS_CONTRAPART_REC = ['Cliente', 'Prospect', 'Fornecedor', 'Funcionário', 'Órgão Público', 'Outro']
const TIPOS_CONTRAPART_PAY = ['Fornecedor', 'Funcionário', 'Órgão Público', 'Cliente', 'Outro']
const FREQUENCIAS = [
  { value: 'mensal', label: 'Mensal' },
  { value: 'trimestral', label: 'Trimestral' },
  { value: 'semestral', label: 'Semestral' },
  { value: 'anual', label: 'Anual' },
]
const MOTIVOS_DISPENSA = [
  'Tarifa bancária', 'Anuidade de cartão', 'IOF / Imposto sobre operação',
  'Juros / Multa', 'Rendimento de aplicação',
  'Transferência entre contas próprias', 'Saque ou depósito próprio',
  'Estorno / Cancelamento', 'Outro',
]

export default function ModalLancamento({ open, onClose, tipo, registro, onSaved }) {
  const { user } = useAuth()
  const isEdit = !!registro
  const isRec = tipo === 'rec'
  const tabela = isRec ? 'receivable' : 'payable'
  const tipoFinanc = isRec ? 'Entrada' : 'Saída'

  // ── State (form) ─────────────────────────────────────────────────────
  const [parte, setParte] = useState('')
  const [parteTipo, setParteTipo] = useState(isRec ? 'Cliente' : 'Fornecedor')
  const [valor, setValor] = useState('')
  const [descricao, setDescricao] = useState('')
  const [venc, setVenc] = useState('')
  const [dataCompetencia, setDataCompetencia] = useState('')
  const [dataPagamento, setDataPagamento] = useState('')
  const [statusV, setStatusV] = useState('Pendente')
  const [forma, setForma] = useState('')
  const [cat, setCat] = useState('')
  const [subcat, setSubcat] = useState('')
  const [notes, setNotes] = useState('')
  const [docStatus, setDocStatus] = useState('vinculado')
  const [docMotivo, setDocMotivo] = useState('')
  const [recorrente, setRecorrente] = useState(false)
  const [recFreq, setRecFreq] = useState('mensal')
  const [recAte, setRecAte] = useState('')

  // ── Anexo ─────────────────────────────────────────────────────────────
  const [anexoPath, setAnexoPath] = useState(null)
  const [anexoFile, setAnexoFile] = useState(null) // arquivo selecionado, ainda não enviado
  // O estado de upload em si é coberto pelo `saving` global do modal.

  // ── Cartão / parcelado (só Pagar) ─────────────────────────────────────
  const [cartoes, setCartoes] = useState([])
  const [cartaoId, setCartaoId] = useState('')
  const [parcelado, setParcelado] = useState(false)
  const [numParcelas, setNumParcelas] = useState(2)

  const [pessoas, setPessoas] = useState([])
  const [plano, setPlano] = useState([])
  const [saving, setSaving] = useState(false)

  // ── Carregar listas auxiliares (pessoas para autocomplete + plano de contas) ──
  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    Promise.all([
      supabase.from('pessoas').select('id,codigo,data'),
      fetchPlanoContas(),
      isRec ? Promise.resolve({ data: [] }) : supabase.from('cartoes').select('id,data').order('updated_at', { ascending: false }),
    ]).then(([rPess, plano, rCart]) => {
      if (cancelled) return
      setPessoas(rPess.data || [])
      setPlano(plano || [])
      setCartoes((rCart?.data || []).filter(c => c.data?.ativo !== false))
    })
    return () => { cancelled = true }
  }, [open])

  // ── Reset / hidratação ao abrir ──────────────────────────────────────
  useEffect(() => {
    if (!open) return
    if (isEdit && registro) {
      const d = registro.data || {}
      setParte(d.client || d.supplier || '')
      setParteTipo(d.parte_tipo || (isRec ? 'Cliente' : 'Fornecedor'))
      setValor(String(d.value ?? ''))
      setDescricao(d.desc || '')
      setVenc(d.due || '')
      setDataCompetencia(d.data_competencia || '')
      setDataPagamento(d.data_pagamento || '')
      setStatusV(d.status || 'Pendente')
      setForma(d.forma || '')
      setCat(d.cat || '')
      setSubcat(d.subcat || '')
      setNotes(d.notes || '')
      setDocStatus(d.doc_status || (d.sem_documento ? 'pendente' : 'vinculado'))
      setDocMotivo(d.doc_motivo_dispensa || '')
      setRecorrente(!!d.recorrente)
      setRecFreq(d.rec_frequencia || 'mensal')
      setRecAte(d.rec_ate || '')
      setAnexoPath(registro.anexo_path || null); setAnexoFile(null)
      setCartaoId(registro.cartao_id || '')
      setParcelado(!!(d.parcela_total && d.parcela_total > 1))
      setNumParcelas(d.parcela_total || 2)
    } else {
      setParte(''); setParteTipo(isRec ? 'Cliente' : 'Fornecedor')
      setValor(''); setDescricao(''); setVenc('')
      setDataCompetencia(''); setDataPagamento('');       setStatusV('Pendente'); setForma(''); setCat(''); setSubcat(''); setNotes('')
      setDocStatus('vinculado'); setDocMotivo('')
      setRecorrente(false); setRecFreq('mensal'); setRecAte('')
      setAnexoPath(null); setAnexoFile(null)
      setCartaoId(''); setParcelado(false); setNumParcelas(2)
    }
  }, [open, isEdit, registro, isRec])

  // ── Auto-detecta padrão "X/Y" na descrição (Pagar com cartão) ───────
  useEffect(() => {
    if (isRec || forma !== 'Cartão de Crédito') return
    const det = detectarParcela(descricao)
    if (det) { setParcelado(true); setNumParcelas(det.total) }
  }, [descricao, forma, isRec])

  // ── Categorias / subcategorias filtradas ─────────────────────────────
  const categorias = useMemo(() => categoriasDe(plano, tipoFinanc), [plano, tipoFinanc])
  const subcategorias = useMemo(() => subcategoriasDe(plano, tipoFinanc, cat), [plano, tipoFinanc, cat])
  useEffect(() => {
    if (cat && !subcategorias.includes(subcat)) setSubcat('')
  }, [cat, subcategorias, subcat])

  // ── Autocomplete parte (datalist nativo) ─────────────────────────────
  const partesFiltradas = useMemo(() => {
    const tiposAccept = parteTipo === 'Outro' ? null
      : parteTipo === 'Cliente' ? ['Cliente', 'Prospect']
      : [parteTipo]
    return pessoas
      .filter(p => !tiposAccept || tiposAccept.includes(p.data?.tipo))
      .map(p => p.data?.nome)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [pessoas, parteTipo])

  // ── Save ─────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!parte.trim() || !valor || !descricao.trim() || !venc) {
      showToast('Preencha os campos obrigatórios.', 'warning')
      return
    }
    if (!cat) { showToast('Selecione a categoria.', 'warning'); return }
    if (!subcat) { showToast('Selecione a subcategoria.', 'warning'); return }
    // A2 — regime caixa: status liquidado exige data de pagamento
    const liquidado = (statusV === 'Recebido' || statusV === 'Pago')
    if (liquidado && !dataPagamento) {
      showToast(`Status "${statusV}" exige a data de ${isRec ? 'recebimento' : 'pagamento'}.`, 'warning')
      return
    }
    setSaving(true)
    try {
      const data = {
        ...(isRec ? { client: parte.trim() } : { supplier: parte.trim() }),
        parte_tipo: parteTipo,
        value: Number(valor),
        desc: descricao.trim(),
        due: venc,
        data_competencia: dataCompetencia || null,
        data_pagamento: dataPagamento || null,
        status: statusV,
        forma: forma || null,
        cat, subcat,
        notes: notes.trim() || null,
        doc_status: docStatus,
        doc_motivo_dispensa: docStatus === 'dispensado' ? (docMotivo || null) : null,
        sem_documento: docStatus === 'pendente',
        recorrente,
        rec_frequencia: recorrente ? recFreq : null,
        rec_ate: recorrente ? (recAte || null) : null,
      }
      if (isEdit) {
        const merged = { ...(registro.data || {}), ...data }
        const updates = { data: merged }
        // Anexo: 3 casos — substituir (novo file), remover (anexoPath=null mas tinha), manter
        if (anexoFile) {
          // Substituir: apaga o antigo (se existir), envia o novo
          if (registro.anexo_path) {
            try { await deleteAnexo(registro.anexo_path) } catch (e) { console.warn('Falha ao apagar anexo antigo:', e) }
          }
          try {
            const newPath = await uploadAnexo(anexoFile, { tipo: isRec ? 'rec' : 'pay', lancamentoId: registro.id, userId: user?.id || registro.user_id })
            updates.anexo_path = newPath
          } catch (errUp) {
            console.error(errUp)
            showToast('Erro ao subir anexo: ' + errUp.message, 'error')
            setSaving(false)
            return
          }
        } else if (registro.anexo_path && !anexoPath) {
          // Usuário clicou em remover
          try { await deleteAnexo(registro.anexo_path) } catch (e) { console.warn(e) }
          updates.anexo_path = null
        }
        // Cartão (Pagar) — gravar/limpar cartao_id
        if (!isRec) updates.cartao_id = cartaoId || null
        const { error } = await supabase.from(tabela).update(updates).eq('id', registro.id)
        if (error) throw error
        showToast('Lançamento atualizado.', 'success')
      } else {
        if (!user) { showToast('Sessão expirada — faça login novamente.', 'error'); return }
        // Cartão (Pagar): integra com a tabela cartoes via cartao_id
        const cartaoSelecionado = cartoes.find(c => c.id === cartaoId)
        // Caso PARCELADO + Cartão: gera N lançamentos com vencimento progressivo
        if (!isRec && parcelado && cartaoSelecionado && numParcelas > 1) {
          const dataCompra = data.data_competencia || data.due || new Date().toISOString().slice(0, 10)
          const parcelas = gerarParcelas({
            baseData: { ...data, desc: removerSufixoParcela(data.desc) },
            valorTotal: Number(valor),
            numParcelas,
            dataCompra,
            cartao: cartaoSelecionado,
          })
          const created = new Date().toISOString().slice(0, 10)
          // Gera todos os códigos de uma vez e insere pai + filhas numa ÚNICA
          // operação — o Postgres garante tudo-ou-nada num insert em lote, então
          // não há mais risco de parcela-pai órfã se as filhas falharem.
          const codigos = await proximosCodigosPayable(parcelas.length)
          const parentId = crypto.randomUUID()
          const linhas = parcelas.map((p, i) => ({
            ...(i === 0 ? { id: parentId } : { parent_id: parentId }),
            user_id: user.id,
            codigo: codigos[i],
            cartao_id: cartaoId,
            data: { ...p, created },
          }))
          const { error: errParcelas } = await supabase.from('payable').insert(linhas)
          if (errParcelas) throw errParcelas
          showToast(`${numParcelas} parcelas criadas (${codigos[0]} + ${parcelas.length - 1} filhas).`, 'success')
          onSaved?.()
          onClose()
          return
        }

        const codigo = isRec ? await proximoCodigoReceivable() : await proximoCodigoPayable()
        const payload = {
          user_id: user.id,
          codigo,
          ...(cartaoId ? { cartao_id: cartaoId } : {}),
          data: { ...data, created: new Date().toISOString().slice(0, 10) },
        }
        const { data: inserted, error } = await supabase.from(tabela).insert(payload).select('id').single()
        if (error) throw error
        // Upload do anexo (se selecionado) — após criação
        if (anexoFile && inserted?.id) {
          try {
            const path = await uploadAnexo(anexoFile, { tipo: isRec ? 'rec' : 'pay', lancamentoId: inserted.id, userId: user.id })
            await supabase.from(tabela).update({ anexo_path: path }).eq('id', inserted.id)
          } catch (errUp) {
            console.error(errUp)
            showToast('Lançamento salvo, mas anexo falhou: ' + errUp.message, 'warning')
          }
        }
        showToast(`${codigo} salvo.`, 'success')
      }
      onSaved?.()
      onClose()
    } catch (e) {
      console.error(e)
      showToast(e?.message || 'Erro ao salvar.', 'error')
    } finally {
      setSaving(false)
    }
  }

  // ── Mover entre Contas a Receber ⇄ Contas a Pagar ────────────────────
  // Corrige lançamento que entrou na direção errada (ex.: uma compra que caiu
  // em Receber). Troca client⇄supplier, limpa categoria (as do plano de contas
  // diferem entre receita e despesa) e gera código na tabela de destino.
  async function moverEntreContas() {
    if (!isEdit || !registro) return
    const destino = isRec ? 'payable' : 'receivable'
    const nomeDestino = isRec ? 'Contas a Pagar' : 'Contas a Receber'
    if (!window.confirm(`Mover este lançamento para ${nomeDestino}?\n\nA categoria será limpa (as categorias de receita e despesa são diferentes) — você reclassifica depois. O anexo e os valores são preservados.`)) return
    setSaving(true)
    try {
      const orig = { ...(registro.data || {}) }
      if (isRec) { orig.supplier = orig.client || parte.trim(); delete orig.client }
      else { orig.client = orig.supplier || parte.trim(); delete orig.supplier }
      // status liquidado tem nome diferente entre as tabelas
      if (orig.status === (isRec ? 'Recebido' : 'Pago')) orig.status = isRec ? 'Pago' : 'Recebido'
      orig.cat = ''
      orig.subcat = ''
      orig.movido_de = tabela
      const codigo = isRec ? await proximoCodigoPayable() : await proximoCodigoReceivable()
      const payload = { user_id: user?.id || registro.user_id, codigo, anexo_path: registro.anexo_path || null, data: orig }
      const { error: errIns } = await supabase.from(destino).insert(payload)
      if (errIns) throw errIns
      const { error: errDel } = await supabase.from(tabela).delete().eq('id', registro.id)
      if (errDel) { showToast('Copiado para ' + nomeDestino + ', mas falhou remover o original — apague-o manualmente.', 'warning') }
      else showToast(`Movido para ${nomeDestino} (${codigo}). Reclassifique a categoria lá.`, 'success')
      onSaved?.()
      onClose()
    } catch (e) {
      showToast('Erro ao mover: ' + e.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function abrirAnexo() {
    if (!anexoPath) return
    try {
      const url = await getAnexoSignedUrl(anexoPath)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (e) {
      showToast('Erro ao abrir anexo: ' + e.message, 'error')
    }
  }
  function selecionarAnexo(e) {
    const f = e.target.files?.[0]
    if (!f) return
    setAnexoFile(f)
    // Marcar visualmente como "novo anexo pendente de envio"
    setAnexoPath('pending')
  }
  function removerAnexo() {
    setAnexoPath(null)
    setAnexoFile(null)
  }

    const title = isEdit
    ? `Editar ${isRec ? 'Conta a Receber' : 'Conta a Pagar'}${registro.codigo ? ` · ${registro.codigo}` : ''}`
    : `Nova ${isRec ? 'Conta a Receber' : 'Conta a Pagar'}`

  const tiposParte = isRec ? TIPOS_CONTRAPART_REC : TIPOS_CONTRAPART_PAY
  const datalistId = `parte-list-${isRec ? 'rec' : 'pay'}`

  return (
    <Modal
      open={open}
      onClose={saving ? () => {} : onClose}
      title={title}
      width={760}
      footer={
        <>
          {isEdit && (
            <button type="button" onClick={moverEntreContas} style={{ ...btnMover, marginRight: 'auto' }} disabled={saving} title={`Este lançamento é na verdade ${isRec ? 'uma despesa' : 'uma receita'}? Mova para ${isRec ? 'Contas a Pagar' : 'Contas a Receber'}.`}>
              ⇄ Mover para {isRec ? 'Contas a Pagar' : 'Contas a Receber'}
            </button>
          )}
          <button type="button" onClick={onClose} style={btnGhost} disabled={saving}>Cancelar</button>
          <button type="button" onClick={handleSave} style={btnPrimary} disabled={saving}>
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </>
      }
    >
      <Row cols={2}>
        <Field label={`${isRec ? 'Cliente' : 'Fornecedor'} *`}>
          <select value={parteTipo} onChange={e => setParteTipo(e.target.value)} style={input}>
            {tiposParte.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <input
            value={parte} onChange={e => setParte(e.target.value)}
            list={datalistId}
            placeholder={isRec ? 'Nome do cliente' : 'Nome do fornecedor'}
            style={{ ...input, marginTop: 6 }}
            autoComplete="off"
          />
          <datalist id={datalistId}>
            {partesFiltradas.map(n => <option key={n} value={n} />)}
          </datalist>
        </Field>
        <Field label="Valor (R$) *">
          <input type="number" step="0.01" value={valor} onChange={e => setValor(e.target.value)} placeholder="0,00" style={input} />
        </Field>
      </Row>

      <Row>
        <Field label="Descrição *">
          <input value={descricao} onChange={e => setDescricao(e.target.value)} placeholder="Descrição do serviço ou produto" style={input} />
        </Field>
      </Row>

      {/* Datas e status */}
      <Row cols={3}>
        <Field label="Data de Emissão (Competência)">
          <input type="date" value={dataCompetencia} onChange={e => setDataCompetencia(e.target.value)} style={input} title="Data de emissão da NF — usada no DRE (regime de competência)" />
        </Field>
        <Field label="Vencimento *">
          <input type="date" value={venc} onChange={e => setVenc(e.target.value)} style={input} />
        </Field>
        <Field label={`Data de ${isRec ? 'Recebimento' : 'Pagamento'}${(statusV === 'Recebido' || statusV === 'Pago') ? ' *' : ''}`}>
          <input
            type="date" value={dataPagamento}
            onChange={e => setDataPagamento(e.target.value)}
            style={{ ...input, ...(((statusV === 'Recebido' || statusV === 'Pago') && !dataPagamento) ? { borderColor: 'var(--red)' } : {}) }}
            title="Quando o dinheiro entrou/saiu de fato — usado no Fluxo de Caixa"
          />
        </Field>
      </Row>

      <Row cols={2}>
        <Field label="Status">
          <select value={statusV} onChange={e => setStatusV(e.target.value)} style={input}>
            {(isRec ? STATUSES_REC : STATUSES_PAY).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label={`Forma de ${isRec ? 'Recebimento' : 'Pagamento'}`}>
          <select value={forma} onChange={e => setForma(e.target.value)} style={input}>
            <option value="">Não informado</option>
            {(isRec ? FORMAS_REC : FORMAS_PAY).map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </Field>
      </Row>

      <Row cols={2}>
        <Field label="Categoria *">
          <select value={cat} onChange={e => setCat(e.target.value)} style={input}>
            <option value="">Selecione…</option>
            {categorias.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Subcategoria *">
          <select value={subcat} onChange={e => setSubcat(e.target.value)} style={input} disabled={!cat}>
            <option value="">{cat ? 'Selecione…' : 'Selecione a categoria primeiro'}</option>
            {subcategorias.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
      </Row>

      <Row>
        <Field label="Observações">
          <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Informações adicionais…" style={{ ...input, minHeight: 70, resize: 'vertical' }} />
        </Field>
      </Row>

      {/* Documento fiscal */}
      <div style={boxNavy}>
        <div style={boxLabel}>📎 Documento Fiscal</div>
        <Row cols={2} gap={10}>
          <select value={docStatus} onChange={e => setDocStatus(e.target.value)} style={input}>
            <option value="vinculado">✓ Documento vinculado / não se aplica</option>
            <option value="pendente">📎 NF pendente (vai chegar)</option>
            <option value="dispensado">✓ Doc fiscal dispensado (sem NF possível)</option>
          </select>
          {docStatus === 'dispensado' ? (
            <select value={docMotivo} onChange={e => setDocMotivo(e.target.value)} style={input}>
              <option value="">— motivo —</option>
              {MOTIVOS_DISPENSA.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          ) : <div />}
        </Row>
      </div>

      {/* Anexo Fiscal */}
      <div style={boxNavy}>
        <div style={boxLabel}>📎 Anexo Fiscal (PDF, XML, imagem)</div>
        {anexoPath && anexoFile ? (
          <div style={anexoRow}>
            <span style={anexoNome}>📄 {anexoFile.name}</span>
            <span style={anexoStatus}>· Será enviado ao salvar</span>
            <button type="button" onClick={removerAnexo} style={btnRemoverAnexo} aria-label="Cancelar">×</button>
          </div>
        ) : anexoPath ? (
          <div style={anexoRow}>
            <button type="button" onClick={abrirAnexo} style={anexoLink}>📄 {nomeAnexoFromPath(anexoPath)}</button>
            <button type="button" onClick={removerAnexo} style={btnRemoverAnexo} aria-label="Remover anexo">×</button>
          </div>
        ) : (
          <label style={anexoUpload}>
            <input type="file" onChange={selecionarAnexo} accept=".pdf,.xml,.png,.jpg,.jpeg" style={{ display: 'none' }} disabled={saving} />
            <span>+ Selecionar arquivo</span>
          </label>
        )}
      </div>

      {/* Cartão de crédito + parcelas (só Pagar) */}
      {!isRec && forma === 'Cartão de Crédito' && (
        <div style={boxNavy}>
          <div style={boxLabel}>💳 Cartão de Crédito</div>
          <Row cols={2} gap={10}>
            <Field label="Cartão">
              {cartoes.length === 0 ? (
                <div style={{ fontSize: 11, color: 'var(--text-mid)', fontStyle: 'italic' }}>
                  Nenhum cartão cadastrado. Cadastre em <a href="/cartoes" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--gold)', textDecoration: 'underline' }}>Cartões</a>.
                </div>
              ) : (
                <select value={cartaoId} onChange={e => setCartaoId(e.target.value)} style={input}>
                  <option value="">— selecione —</option>
                  {cartoes.map(c => <option key={c.id} value={c.id}>{c.data?.nome} ({c.data?.bandeira})</option>)}
                </select>
              )}
            </Field>
            <Field label="Parcelas">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, color: 'var(--navy)', fontWeight: 600, marginTop: 6 }}>
                <input type="checkbox" checked={parcelado} onChange={e => setParcelado(e.target.checked)} disabled={isEdit} style={{ width: 15, height: 15, accentColor: 'var(--gold)' }} />
                Compra parcelada
              </label>
              {parcelado && (
                <input
                  type="number" min={2} max={36} value={numParcelas}
                  onChange={e => setNumParcelas(Math.max(2, Math.min(36, Number(e.target.value))))}
                  disabled={isEdit}
                  style={{ ...input, marginTop: 6 }}
                  placeholder="Nº de parcelas (ex: 12)"
                />
              )}
            </Field>
          </Row>
          {parcelado && !isEdit && cartaoId && (
            <div style={{ fontSize: 11, color: 'var(--text-mid)', background: 'rgba(204,145,94,0.08)', padding: 10, borderRadius: 4, borderLeft: '3px solid var(--gold)' }}>
              💡 Ao salvar, o sistema vai criar <strong>{numParcelas} lançamentos</strong> ligados como parcelas (1/{numParcelas} a {numParcelas}/{numParcelas}), com vencimentos progressivos baseados no fechamento do cartão.
            </div>
          )}
          {isEdit && registro?.data?.parcela_atual && (
            <div style={{ fontSize: 11, color: 'var(--text-mid)', background: 'rgba(0,32,62,0.05)', padding: 10, borderRadius: 4, borderLeft: '3px solid var(--navy)' }}>
              Esta é a parcela <strong>{registro.data.parcela_atual}/{registro.data.parcela_total}</strong> de uma compra parcelada. Edição de parcelas individuais é livre, mas a estrutura da série não pode ser alterada por aqui.
            </div>
          )}
        </div>
      )}

      {/* Recorrência */}
      <div style={boxGold}>
        <label style={checkboxLabel}>
          <input type="checkbox" checked={recorrente} onChange={e => setRecorrente(e.target.checked)} style={{ width: 15, height: 15, accentColor: 'var(--gold)' }} />
          🔄 Lançamento recorrente
        </label>
        {recorrente && (
          <Row cols={2} gap={10} mt={10}>
            <Field label="Frequência">
              <select value={recFreq} onChange={e => setRecFreq(e.target.value)} style={input}>
                {FREQUENCIAS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </Field>
            <Field label="Última geração até">
              <input type="date" value={recAte} onChange={e => setRecAte(e.target.value)} style={input} />
            </Field>
          </Row>
        )}
      </div>
    </Modal>
  )
}

// ─── helpers visuais ─────────────────────────────────────────────────────────
function Field({ label, children }) {
  return (
    <div style={fieldWrap}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  )
}

function Row({ children, cols = 1, gap = 14, mt }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
      gap,
      marginTop: mt,
      marginBottom: 14,
    }}>
      {children}
    </div>
  )
}

const fieldWrap = { display: 'flex', flexDirection: 'column' }
const labelStyle = {
  fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase',
  color: 'var(--text-mid)', marginBottom: 6, fontFamily: 'var(--body)',
}
const input = {
  width: '100%', padding: '9px 12px', border: '1.5px solid var(--cream-dark)',
  borderRadius: 6, fontFamily: 'var(--body)', fontSize: 13,
  color: 'var(--navy)', background: 'var(--white)', outline: 'none',
  boxSizing: 'border-box',
}
const boxNavy = {
  marginTop: 6, padding: 14,
  background: 'rgba(0,32,62,0.04)', borderLeft: '3px solid var(--navy)',
  borderRadius: 6, marginBottom: 14,
}
const boxGold = {
  padding: 14,
  background: 'rgba(204,145,94,0.06)', borderLeft: '3px solid var(--gold)',
  borderRadius: 6,
}
const boxLabel = {
  fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase',
  color: 'var(--navy)', marginBottom: 8, fontFamily: 'var(--body)',
}
const checkboxLabel = {
  display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
  fontWeight: 600, color: 'var(--navy)', fontSize: 12, fontFamily: 'var(--body)',
}
const btnGhost = {
  padding: '10px 18px', border: '1.5px solid var(--cream-dark)',
  borderRadius: 6, background: 'var(--white)', color: 'var(--navy)',
  fontFamily: 'var(--body)', fontSize: 12, fontWeight: 600,
  cursor: 'pointer', letterSpacing: 0.5,
}
const btnMover = {
  padding: '10px 14px', border: '1.5px solid var(--navy)',
  borderRadius: 6, background: 'var(--white)', color: 'var(--navy)',
  fontFamily: 'var(--body)', fontSize: 12, fontWeight: 600,
  cursor: 'pointer', letterSpacing: 0.3,
}
const anexoRow = { display: 'flex', alignItems: 'center', gap: 10 }
const anexoNome = { fontSize: 12, color: 'var(--navy)', fontWeight: 600 }
const anexoStatus = { fontSize: 11, color: 'var(--gold-dark)', fontStyle: 'italic' }
const anexoLink = {
  background: 'none', border: 'none', padding: 0,
  color: 'var(--gold)', cursor: 'pointer', textDecoration: 'underline',
  fontSize: 12, fontWeight: 600, fontFamily: 'var(--body)',
}
const anexoUpload = {
  display: 'inline-block', cursor: 'pointer',
  padding: '8px 14px', borderRadius: 6,
  border: '1.5px dashed var(--gold)',
  background: 'rgba(204,145,94,0.06)',
  color: 'var(--gold-dark)',
  fontSize: 11, fontWeight: 600, fontFamily: 'var(--body)',
  letterSpacing: 0.5, textTransform: 'uppercase',
}
const btnRemoverAnexo = {
  background: 'none', border: '1px solid transparent', borderRadius: 4,
  color: 'var(--text-mid)', fontSize: 18, lineHeight: 1, cursor: 'pointer',
  width: 26, height: 26, padding: 0, marginLeft: 'auto',
}
const btnPrimary = {
  padding: '10px 18px', border: 'none',
  borderRadius: 6, background: 'var(--gold)', color: '#fff',
  fontFamily: 'var(--body)', fontSize: 12, fontWeight: 700,
  cursor: 'pointer', letterSpacing: 0.5,
}
