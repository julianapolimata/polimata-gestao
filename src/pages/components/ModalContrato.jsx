import { useEffect, useMemo, useState } from 'react'
import Modal from '../../components/Modal'
import { showToast } from '../../components/Toast'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { proximoCodigoContrato } from '../../lib/codigos'

// =============================================================================
// MODAL CONTRATO — replica saveContract() do legado (linha 3760).
// Suporta principal e aditivo (vincula a contrato pai).
// Inclui bloco de recorrência mensal de NF (dia, valor, LC116, descrição, modo).
// =============================================================================

const TIPOS = ['Prestação de Serviços', 'Consultoria', 'Fornecimento', 'Parceria', 'Outro']
const STATUSES = ['Ativo', 'Em negociação', 'Encerrado']
const DIAS_MES = Array.from({ length: 28 }, (_, i) => i + 1)

export default function ModalContrato({ open, onClose, registro, onSaved }) {
  const { user } = useAuth()
  const isEdit = !!registro

  const [natureza, setNatureza] = useState('principal')
  const [paiId, setPaiId] = useState('')
  const [numero, setNumero] = useState('')
  const [parte, setParte] = useState('')
  const [objeto, setObjeto] = useState('')
  const [valor, setValor] = useState('')
  const [inicio, setInicio] = useState('')
  const [fim, setFim] = useState('')
  const [tipoC, setTipoC] = useState('Prestação de Serviços')
  const [statusV, setStatusV] = useState('Ativo')
  const [notes, setNotes] = useState('')

  const [recAtiva, setRecAtiva] = useState(false)
  const [recDia, setRecDia] = useState(5)
  const [recValor, setRecValor] = useState('')
  const [recLc116, setRecLc116] = useState('')
  const [recDesc, setRecDesc] = useState('')
  const [recModo, setRecModo] = useState('consolidado')

  const [pessoas, setPessoas] = useState([])
  const [contratos, setContratos] = useState([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    Promise.all([
      supabase.from('pessoas').select('id,codigo,data'),
      supabase.from('contracts').select('id,codigo,data'),
    ]).then(([rPess, rCon]) => {
      if (cancelled) return
      setPessoas(rPess.data || [])
      setContratos(rCon.data || [])
    })
    return () => { cancelled = true }
  }, [open])

  useEffect(() => {
    if (!open) return
    if (isEdit && registro) {
      const d = registro.data || {}
      setNatureza(d.natureza || 'principal')
      setPaiId(d.pai_id || '')
      setNumero(registro.codigo || d.number || '')
      setParte(d.party || '')
      setObjeto(d.object || '')
      setValor(String(d.value ?? ''))
      setInicio(d.start || '')
      setFim(d.end || '')
      setTipoC(d.type || 'Prestação de Serviços')
      setStatusV(d.status || 'Ativo')
      setNotes(d.notes || '')
      setRecAtiva(!!d.rec_ativa)
      setRecDia(d.rec_dia || 5)
      setRecValor(d.rec_valor_mensal != null ? String(d.rec_valor_mensal) : '')
      setRecLc116(d.rec_lc116 || '')
      setRecDesc(d.rec_descricao || '')
      setRecModo(d.rec_modo || 'consolidado')
    } else {
      setNatureza('principal'); setPaiId(''); setNumero('')
      setParte(''); setObjeto(''); setValor('')
      setInicio(''); setFim(''); setTipoC('Prestação de Serviços'); setStatusV('Ativo'); setNotes('')
      setRecAtiva(false); setRecDia(5); setRecValor(''); setRecLc116(''); setRecDesc('')
      setRecModo('consolidado')
    }
  }, [open, isEdit, registro])

  // Autocomplete parte (clientes + fornecedores)
  const partesSugeridas = useMemo(() => {
    const tipos = ['Cliente', 'Prospect', 'Fornecedor', 'Órgão Público']
    return pessoas
      .filter(p => tipos.includes(p.data?.tipo))
      .map(p => p.data?.nome)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [pessoas])

  // Contratos pai (Ativo + não-aditivo + diferente do próprio)
  const paisDisponiveis = useMemo(() => {
    return contratos.filter(c => {
      if (isEdit && c.id === registro?.id) return false
      const nat = c.data?.natureza || 'principal'
      return nat === 'principal'
    })
  }, [contratos, isEdit, registro])

  async function handleSave() {
    if (!parte.trim() || !objeto.trim() || !valor) {
      showToast('Preencha parte, objeto e valor.', 'warning')
      return
    }
    if (natureza === 'aditivo' && !paiId) {
      showToast('Selecione o contrato pai.', 'warning')
      return
    }
    setSaving(true)
    try {
      const data = {
        natureza,
        pai_id: natureza === 'aditivo' ? paiId : null,
        number: numero.trim() || null,
        party: parte.trim(),
        object: objeto.trim(),
        value: Number(valor),
        start: inicio || null,
        end: fim || null,
        type: tipoC,
        status: statusV,
        notes: notes.trim() || null,
        rec_ativa: recAtiva,
        rec_dia: recAtiva ? Number(recDia) : null,
        rec_valor_mensal: recAtiva ? Number(recValor || 0) : null,
        rec_lc116: recAtiva ? recLc116.trim() : null,
        rec_descricao: recAtiva ? recDesc.trim() : null,
        rec_modo: recAtiva ? recModo : null,
      }
      if (isEdit) {
        const merged = { ...(registro.data || {}), ...data }
        const { error } = await supabase.from('contracts').update({ data: merged }).eq('id', registro.id)
        if (error) throw error
        showToast('Contrato atualizado.', 'success')
      } else {
        if (!user) { showToast('Sessão expirada.', 'error'); return }
        const codigo = numero.trim() || await proximoCodigoContrato()
        const payload = {
          user_id: user.id, codigo,
          data: { ...data, created: new Date().toISOString().slice(0, 10) },
        }
        const { error } = await supabase.from('contracts').insert(payload)
        if (error) throw error
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

  const title = isEdit
    ? `Editar Contrato${registro.codigo ? ` · ${registro.codigo}` : ''}`
    : 'Novo Contrato'

  return (
    <Modal
      open={open}
      onClose={saving ? () => {} : onClose}
      title={title}
      width={820}
      footer={
        <>
          <button type="button" onClick={onClose} style={btnGhost} disabled={saving}>Cancelar</button>
          <button type="button" onClick={handleSave} style={btnPrimary} disabled={saving}>
            {saving ? 'Salvando…' : 'Salvar Contrato'}
          </button>
        </>
      }
    >
      <Row cols={2}>
        <Field label="Natureza *">
          <select value={natureza} onChange={e => setNatureza(e.target.value)} style={input}>
            <option value="principal">Contrato Principal</option>
            <option value="aditivo">Aditivo (vincula a contrato existente)</option>
          </select>
        </Field>
        {natureza === 'aditivo' ? (
          <Field label="Contrato Pai *">
            <select value={paiId} onChange={e => setPaiId(e.target.value)} style={input}>
              <option value="">— selecione —</option>
              {paisDisponiveis.map(c => (
                <option key={c.id} value={c.id}>
                  {c.codigo || c.id.slice(0, 8)} — {c.data?.party || ''}
                </option>
              ))}
            </select>
          </Field>
        ) : <div />}
      </Row>

      <Row cols={2}>
        <Field label="Nº do Contrato">
          <input value={numero} onChange={e => setNumero(e.target.value)} placeholder="Ex: CTR-2026-001 (auto se vazio)" style={input} />
        </Field>
        <Field label="Cliente/Fornecedor *">
          <input value={parte} onChange={e => setParte(e.target.value)} list="contrato-parte-list" placeholder="Nome da parte" style={input} autoComplete="off" />
          <datalist id="contrato-parte-list">
            {partesSugeridas.map(n => <option key={n} value={n} />)}
          </datalist>
        </Field>
      </Row>

      <Row>
        <Field label="Objeto do Contrato *">
          <input value={objeto} onChange={e => setObjeto(e.target.value)} placeholder="Descreva o objeto contratado" style={input} />
        </Field>
      </Row>

      <Row cols={3}>
        <Field label="Valor Total (R$) *">
          <input type="number" step="0.01" value={valor} onChange={e => setValor(e.target.value)} placeholder="0,00" style={input} />
        </Field>
        <Field label="Data de Início">
          <input type="date" value={inicio} onChange={e => setInicio(e.target.value)} style={input} />
        </Field>
        <Field label="Data de Término">
          <input type="date" value={fim} onChange={e => setFim(e.target.value)} style={input} />
        </Field>
      </Row>

      <Row cols={2}>
        <Field label="Tipo">
          <select value={tipoC} onChange={e => setTipoC(e.target.value)} style={input}>
            {TIPOS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select value={statusV} onChange={e => setStatusV(e.target.value)} style={input}>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
      </Row>

      <div style={recBox}>
        <label style={checkboxLabel}>
          <input type="checkbox" checked={recAtiva} onChange={e => setRecAtiva(e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--gold)' }} />
          🔄 Emissão recorrente mensal de NF
        </label>
        {recAtiva && (
          <>
            <Row cols={3} gap={10} mt={12}>
              <Field label="Dia da Emissão">
                <select value={recDia} onChange={e => setRecDia(Number(e.target.value))} style={input}>
                  {DIAS_MES.map(d => <option key={d} value={d}>Dia {d}</option>)}
                </select>
              </Field>
              <Field label="Valor Mensal (R$)">
                <input type="number" step="0.01" value={recValor} onChange={e => setRecValor(e.target.value)} placeholder="0,00" style={input} />
              </Field>
              <Field label="Item LC116 (código)">
                <input value={recLc116} onChange={e => setRecLc116(e.target.value)} placeholder="Ex: 17.20" style={input} />
              </Field>
            </Row>
            <Row cols={2} gap={10}>
              <Field label="Descrição do serviço (vai pra NF)">
                <input value={recDesc} onChange={e => setRecDesc(e.target.value)} placeholder="Ex: Consultoria em GRC — mensalidade" style={input} />
              </Field>
              <Field label="Modo de emissão">
                <select value={recModo} onChange={e => setRecModo(e.target.value)} style={input}>
                  <option value="consolidado">Consolidado (1 NF total = principal + aditivos)</option>
                  <option value="separado">Separado (1 NF por contrato/aditivo)</option>
                </select>
              </Field>
            </Row>
          </>
        )}
      </div>

      <Row>
        <Field label="Observações">
          <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Cláusulas especiais, observações…" style={{ ...input, minHeight: 70, resize: 'vertical' }} />
        </Field>
      </Row>
    </Modal>
  )
}

function Field({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  )
}
function Row({ children, cols = 1, gap = 14, mt }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap, marginTop: mt, marginBottom: 14 }}>{children}</div>
  )
}

const labelStyle = { fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-mid)', marginBottom: 6, fontFamily: 'var(--body)' }
const input = { width: '100%', padding: '9px 12px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 13, color: 'var(--navy)', background: 'var(--white)', outline: 'none', boxSizing: 'border-box' }
const recBox = { padding: 14, background: 'rgba(204,145,94,0.06)', borderLeft: '3px solid var(--gold)', borderRadius: 6, marginBottom: 14 }
const checkboxLabel = { display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 600, color: 'var(--navy)', fontSize: 13, fontFamily: 'var(--body)' }
const btnGhost = { padding: '10px 18px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, background: 'var(--white)', color: 'var(--navy)', fontFamily: 'var(--body)', fontSize: 12, fontWeight: 600, cursor: 'pointer', letterSpacing: 0.5 }
const btnPrimary = { padding: '10px 18px', border: 'none', borderRadius: 6, background: 'var(--gold)', color: '#fff', fontFamily: 'var(--body)', fontSize: 12, fontWeight: 700, cursor: 'pointer', letterSpacing: 0.5 }
