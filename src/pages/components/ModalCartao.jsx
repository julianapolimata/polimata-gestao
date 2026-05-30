import { useEffect, useState } from 'react'
import Modal from '../../components/Modal'
import { showToast } from '../../components/Toast'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'

// =============================================================================
// MODAL CARTÃO — cadastro de cartão de crédito da Polímata.
// Campos: nome, bandeira, dia_fechamento (1-28), dia_vencimento (1-28),
// observações.
// =============================================================================

const BANDEIRAS = ['Visa', 'Mastercard', 'Elo', 'American Express', 'Hipercard', 'Outra']
const DIAS = Array.from({ length: 28 }, (_, i) => i + 1)

export default function ModalCartao({ open, onClose, registro, onSaved }) {
  const { user } = useAuth()
  const isEdit = !!registro

  const [nome, setNome] = useState('')
  const [bandeira, setBandeira] = useState('Visa')
  const [diaFechamento, setDiaFechamento] = useState(1)
  const [diaVencimento, setDiaVencimento] = useState(10)
  const [ativo, setAtivo] = useState(true)
  const [observacoes, setObservacoes] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    if (isEdit && registro) {
      const d = registro.data || {}
      setNome(d.nome || '')
      setBandeira(d.bandeira || 'Visa')
      setDiaFechamento(d.dia_fechamento || 1)
      setDiaVencimento(d.dia_vencimento || 10)
      setAtivo(d.ativo !== false)
      setObservacoes(d.observacoes || '')
    } else {
      setNome(''); setBandeira('Visa'); setDiaFechamento(1)
      setDiaVencimento(10); setAtivo(true); setObservacoes('')
    }
  }, [open, isEdit, registro])

  async function handleSave() {
    if (!nome.trim()) { showToast('Informe o nome do cartão.', 'warning'); return }
    setSaving(true)
    try {
      const data = {
        nome: nome.trim(), bandeira,
        dia_fechamento: Number(diaFechamento),
        dia_vencimento: Number(diaVencimento),
        ativo, observacoes: observacoes.trim() || null,
      }
      if (isEdit) {
        const merged = { ...(registro.data || {}), ...data }
        const { error } = await supabase.from('cartoes').update({ data: merged }).eq('id', registro.id)
        if (error) throw error
        showToast('Cartão atualizado.', 'success')
      } else {
        if (!user) { showToast('Sessão expirada.', 'error'); return }
        const { error } = await supabase.from('cartoes').insert({
          user_id: user.id,
          data: { ...data, created: new Date().toISOString().slice(0, 10) },
        })
        if (error) throw error
        showToast(`Cartão ${nome.trim()} cadastrado.`, 'success')
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

  return (
    <Modal
      open={open}
      onClose={saving ? () => {} : onClose}
      title={isEdit ? `Editar Cartão · ${registro.data?.nome || ''}` : 'Novo Cartão de Crédito'}
      width={580}
      footer={
        <>
          <button type="button" onClick={onClose} style={btnGhost} disabled={saving}>Cancelar</button>
          <button type="button" onClick={handleSave} style={btnPrimary} disabled={saving}>{saving ? 'Salvando…' : 'Salvar'}</button>
        </>
      }
    >
      <Row cols={2}>
        <Field label="Nome do Cartão *">
          <input value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex: Nubank Empresarial" style={input} />
        </Field>
        <Field label="Bandeira">
          <select value={bandeira} onChange={e => setBandeira(e.target.value)} style={input}>
            {BANDEIRAS.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </Field>
      </Row>

      <Row cols={2}>
        <Field label="Dia do Fechamento da Fatura">
          <select value={diaFechamento} onChange={e => setDiaFechamento(Number(e.target.value))} style={input}>
            {DIAS.map(d => <option key={d} value={d}>Dia {d}</option>)}
          </select>
        </Field>
        <Field label="Dia do Vencimento da Fatura">
          <select value={diaVencimento} onChange={e => setDiaVencimento(Number(e.target.value))} style={input}>
            {DIAS.map(d => <option key={d} value={d}>Dia {d}</option>)}
          </select>
        </Field>
      </Row>

      <div style={infoBox}>
        💡 Exemplo: fechamento dia {diaFechamento}, vencimento dia {diaVencimento}. Uma compra feita dia 15 deste mês entra na fatura
        que fecha dia {diaFechamento} {diaFechamento >= 15 ? 'deste mês' : 'do mês que vem'} e vence dia {diaVencimento} {diaFechamento >= 15 ? 'deste mês' : 'do mês que vem'}.
      </div>

      <Row>
        <Field label="Observações">
          <textarea value={observacoes} onChange={e => setObservacoes(e.target.value)} placeholder="Anuidade, limite, etc." style={{ ...input, minHeight: 60, resize: 'vertical' }} />
        </Field>
      </Row>

      <div style={{ marginTop: 12 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, color: 'var(--navy)', fontWeight: 600 }}>
          <input type="checkbox" checked={ativo} onChange={e => setAtivo(e.target.checked)} style={{ width: 15, height: 15, accentColor: 'var(--green)' }} />
          Cartão ativo
        </label>
      </div>
    </Modal>
  )
}

function Field({ label, children }) {
  return (<div style={{ display: 'flex', flexDirection: 'column' }}>
    <label style={labelStyle}>{label}</label>
    {children}
  </div>)
}
function Row({ children, cols = 1, gap = 14 }) {
  return (<div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap, marginBottom: 14 }}>{children}</div>)
}

const labelStyle = { fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-mid)', marginBottom: 6, fontFamily: 'var(--body)' }
const input = { width: '100%', padding: '9px 12px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 13, color: 'var(--navy)', background: 'var(--white)', outline: 'none', boxSizing: 'border-box' }
const infoBox = { background: 'rgba(0,32,62,0.04)', borderLeft: '3px solid var(--navy)', padding: 12, borderRadius: 6, fontSize: 11, color: 'var(--text-mid)', marginBottom: 14, lineHeight: 1.5 }
const btnGhost = { padding: '10px 18px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, background: 'var(--white)', color: 'var(--navy)', fontFamily: 'var(--body)', fontSize: 12, fontWeight: 600, cursor: 'pointer', letterSpacing: 0.5 }
const btnPrimary = { padding: '10px 18px', border: 'none', borderRadius: 6, background: 'var(--gold)', color: '#fff', fontFamily: 'var(--body)', fontSize: 12, fontWeight: 700, cursor: 'pointer', letterSpacing: 0.5 }
