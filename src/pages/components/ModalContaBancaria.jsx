import { useEffect, useState } from 'react'
import Modal from '../../components/Modal'
import { showToast } from '../../components/Toast'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { maskAgencia, maskConta, validarAgencia, validarConta } from '../../lib/mascaras'

const BANCOS_BR = ['Itaú', 'Bradesco', 'Banco do Brasil', 'Santander', 'Caixa', 'Nubank', 'Inter', 'BTG Pactual', 'C6 Bank', 'Sicredi', 'Sicoob', 'XP Investimentos', 'Outro']
const TIPOS = [
  { v: 'corrente', l: 'Corrente' },
  { v: 'poupanca', l: 'Poupança' },
  { v: 'pagamento', l: 'Conta de Pagamento (digital)' },
  { v: 'investimento', l: 'Investimento' },
]

export default function ModalContaBancaria({ open, onClose, registro, onSaved }) {
  const { user } = useAuth()
  const isEdit = !!registro

  const [nome, setNome] = useState('')
  const [banco, setBanco] = useState('Itaú')
  const [agencia, setAgencia] = useState('')
  const [conta, setConta] = useState('')
  const [tipo, setTipo] = useState('corrente')
  const [saldoInicial, setSaldoInicial] = useState('')
  const [ativo, setAtivo] = useState(true)
  const [observacoes, setObservacoes] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    if (isEdit && registro) {
      const d = registro.data || {}
      setNome(d.nome || '')
      setBanco(d.banco || 'Itaú')
      setAgencia(d.agencia || '')
      setConta(d.conta || '')
      setTipo(d.tipo || 'corrente')
      setSaldoInicial(d.saldo_inicial != null ? String(d.saldo_inicial) : '')
      setAtivo(d.ativo !== false)
      setObservacoes(d.observacoes || '')
    } else {
      setNome(''); setBanco('Itaú'); setAgencia(''); setConta('')
      setTipo('corrente'); setSaldoInicial(''); setAtivo(true); setObservacoes('')
    }
  }, [open, isEdit, registro])

  async function handleSave() {
    if (!nome.trim()) { showToast('Informe o nome da conta.', 'warning'); return }
    setSaving(true)
    try {
      const data = {
        nome: nome.trim(), banco, agencia: agencia.trim(), conta: conta.trim(),
        tipo, saldo_inicial: saldoInicial === '' ? null : Number(saldoInicial),
        ativo, observacoes: observacoes.trim() || null,
      }
      if (isEdit) {
        const merged = { ...(registro.data || {}), ...data }
        const { error } = await supabase.from('contas_bancarias').update({ data: merged }).eq('id', registro.id)
        if (error) throw error
        showToast('Conta atualizada.', 'success')
      } else {
        if (!user) { showToast('Sessão expirada.', 'error'); return }
        const { error } = await supabase.from('contas_bancarias').insert({
          user_id: user.id,
          data: { ...data, created: new Date().toISOString().slice(0, 10) },
        })
        if (error) throw error
        showToast(`Conta ${nome.trim()} cadastrada.`, 'success')
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
      title={isEdit ? `Editar Conta · ${registro.data?.nome || ''}` : 'Nova Conta Bancária'}
      width={580}
      footer={
        <>
          <button type="button" onClick={onClose} style={btnGhost} disabled={saving}>Cancelar</button>
          <button type="button" onClick={handleSave} style={btnPrimary} disabled={saving}>{saving ? 'Salvando…' : 'Salvar'}</button>
        </>
      }
    >
      <Row cols={2}>
        <Field label="Nome da Conta *">
          <input value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex: Itaú Empresarial" style={input} />
        </Field>
        <Field label="Banco">
          <select value={banco} onChange={e => setBanco(e.target.value)} style={input}>
            {BANCOS_BR.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </Field>
      </Row>

      <Row cols={2}>
        <Field label="Tipo">
          <select value={tipo} onChange={e => setTipo(e.target.value)} style={input}>
            {TIPOS.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
          </select>
        </Field>
        <Field label="Saldo Inicial (R$)">
          <input type="number" step="0.01" value={saldoInicial} onChange={e => setSaldoInicial(e.target.value)} placeholder="0,00" style={input} title="Saldo da conta na data em que você começou a usar o sistema" />
        </Field>
      </Row>

      <Row cols={2}>
        <Field label="Agência">
          <input value={agencia} onChange={e => setAgencia(maskAgencia(e.target.value))} placeholder="0000-0" maxLength={6} style={{...input, ...(agencia && !validarAgencia(agencia) ? {borderColor:'var(--red)'}:{})}} />
        </Field>
        <Field label="Conta">
          <input value={conta} onChange={e => setConta(maskConta(e.target.value))} placeholder="00000-0" maxLength={11} style={{...input, ...(conta && !validarConta(conta) ? {borderColor:'var(--red)'}:{})}} />
        </Field>
      </Row>

      <Row>
        <Field label="Observações">
          <textarea value={observacoes} onChange={e => setObservacoes(e.target.value)} placeholder="Tarifa mensal, gerente, etc." style={{ ...input, minHeight: 60, resize: 'vertical' }} />
        </Field>
      </Row>

      <div style={{ marginTop: 12 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, color: 'var(--navy)', fontWeight: 600 }}>
          <input type="checkbox" checked={ativo} onChange={e => setAtivo(e.target.checked)} style={{ width: 15, height: 15, accentColor: 'var(--gold)' }} />
          Conta ativa
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
const btnGhost = { padding: '10px 18px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, background: 'var(--white)', color: 'var(--navy)', fontFamily: 'var(--body)', fontSize: 12, fontWeight: 600, cursor: 'pointer', letterSpacing: 0.5 }
const btnPrimary = { padding: '10px 18px', border: 'none', borderRadius: 6, background: 'var(--gold)', color: '#fff', fontFamily: 'var(--body)', fontSize: 12, fontWeight: 700, cursor: 'pointer', letterSpacing: 0.5 }
