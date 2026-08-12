import { useEffect, useState } from 'react'
import Modal from '../../components/Modal'
import { showToast } from '../../components/Toast'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { FREQUENCIAS } from '../../lib/recorrencias'

export default function ModalRecorrencia({ open, onClose, registro, onSaved }) {
  const { user } = useAuth()
  const isEdit = !!registro

  const [tipo, setTipo] = useState('receita')
  const [descricao, setDescricao] = useState('')
  const [parte, setParte] = useState('')
  const [valor, setValor] = useState('')
  const [frequencia, setFrequencia] = useState('mensal')
  const [diaVenc, setDiaVenc] = useState('5')
  const [dataInicio, setDataInicio] = useState('')
  const [dataFim, setDataFim] = useState('')
  const [cat, setCat] = useState('')
  const [formaPagamento, setFormaPagamento] = useState('')
  const [ativo, setAtivo] = useState(true)
  const [observacoes, setObservacoes] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    const d = (isEdit && registro?.data) ? registro.data : {}
    setTipo(d.tipo || 'receita')
    setDescricao(d.descricao || '')
    setParte(d.parte || '')
    setValor(d.valor != null ? String(d.valor) : '')
    setFrequencia(d.frequencia || 'mensal')
    setDiaVenc(d.dia_vencimento != null ? String(d.dia_vencimento) : '5')
    setDataInicio(d.data_inicio || '')
    setDataFim(d.data_fim || '')
    setCat(d.cat || '')
    setFormaPagamento(d.forma_pagamento || '')
    setAtivo(d.ativo !== false)
    setObservacoes(d.observacoes || '')
  }, [open, isEdit, registro])

  async function handleSave() {
    if (!descricao.trim()) { showToast('Informe a descrição.', 'warning'); return }
    if (valor === '' || Number(valor) <= 0) { showToast('Informe um valor válido.', 'warning'); return }
    if (!dataInicio) { showToast('Informe a data de início.', 'warning'); return }
    const dia = Number(diaVenc)
    if (!dia || dia < 1 || dia > 31) { showToast('Dia de vencimento deve ser entre 1 e 31.', 'warning'); return }
    if (dataFim && dataFim < dataInicio) { showToast('A data de término não pode ser antes do início.', 'warning'); return }
    setSaving(true)
    try {
      const data = {
        tipo,
        descricao: descricao.trim(),
        parte: parte.trim() || null,
        valor: Number(valor),
        frequencia,
        dia_vencimento: dia,
        data_inicio: dataInicio,
        data_fim: dataFim || null,
        cat: cat.trim() || null,
        forma_pagamento: formaPagamento.trim() || null,
        ativo,
        observacoes: observacoes.trim() || null,
      }
      if (isEdit) {
        const merged = { ...(registro.data || {}), ...data }
        const { error } = await supabase.from('recurring_masters').update({ data: merged }).eq('id', registro.id)
        if (error) throw error
        showToast('Recorrência atualizada.', 'success')
      } else {
        if (!user) { showToast('Sessão expirada.', 'error'); return }
        const { error } = await supabase.from('recurring_masters').insert({
          user_id: user.id,
          data: { ...data, created: new Date().toISOString().slice(0, 10) },
        })
        if (error) throw error
        showToast('Recorrência criada.', 'success')
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

  const labelParte = tipo === 'receita' ? 'Cliente' : 'Fornecedor'

  return (
    <Modal
      open={open}
      onClose={saving ? () => {} : onClose}
      title={isEdit ? `Editar recorrência · ${registro.data?.descricao || ''}` : 'Nova recorrência'}
      width={600}
      footer={
        <>
          <button type="button" onClick={onClose} style={btnGhost} disabled={saving}>Cancelar</button>
          <button type="button" onClick={handleSave} style={btnPrimary} disabled={saving}>{saving ? 'Salvando…' : 'Salvar'}</button>
        </>
      }
    >
      <Row cols={2}>
        <Field label="Tipo">
          <select value={tipo} onChange={e => setTipo(e.target.value)} style={input}>
            <option value="receita">Receita (a receber)</option>
            <option value="despesa">Despesa (a pagar)</option>
          </select>
        </Field>
        <Field label={labelParte}>
          <input value={parte} onChange={e => setParte(e.target.value)} placeholder={`Nome do ${labelParte.toLowerCase()}`} style={input} />
        </Field>
      </Row>

      <Row>
        <Field label="Descrição *">
          <input value={descricao} onChange={e => setDescricao(e.target.value)} placeholder="Ex: Consultoria mensal GRC" style={input} />
        </Field>
      </Row>

      <Row cols={3}>
        <Field label="Valor (R$) *">
          <input type="number" step="0.01" value={valor} onChange={e => setValor(e.target.value)} placeholder="0,00" style={input} />
        </Field>
        <Field label="Frequência">
          <select value={frequencia} onChange={e => setFrequencia(e.target.value)} style={input}>
            {FREQUENCIAS.map(f => <option key={f.v} value={f.v}>{f.l}</option>)}
          </select>
        </Field>
        <Field label="Dia do vencimento *">
          <input type="number" min="1" max="31" value={diaVenc} onChange={e => setDiaVenc(e.target.value)} placeholder="5" style={input} />
        </Field>
      </Row>

      <Row cols={2}>
        <Field label="Início *">
          <input type="date" value={dataInicio} onChange={e => setDataInicio(e.target.value)} style={input} />
        </Field>
        <Field label="Término (opcional)">
          <input type="date" value={dataFim} onChange={e => setDataFim(e.target.value)} style={input} title="Deixe vazio para recorrência sem fim" />
        </Field>
      </Row>

      <Row cols={2}>
        <Field label="Categoria">
          <input value={cat} onChange={e => setCat(e.target.value)} placeholder="Ex: Receita de Serviços" style={input} />
        </Field>
        <Field label="Forma de pagamento">
          <input value={formaPagamento} onChange={e => setFormaPagamento(e.target.value)} placeholder="Ex: Pix, Boleto…" style={input} />
        </Field>
      </Row>

      <Row>
        <Field label="Observações">
          <textarea value={observacoes} onChange={e => setObservacoes(e.target.value)} placeholder="Notas internas" style={{ ...input, minHeight: 56, resize: 'vertical' }} />
        </Field>
      </Row>

      <div style={{ marginTop: 4 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, color: 'var(--navy)', fontWeight: 600 }}>
          <input type="checkbox" checked={ativo} onChange={e => setAtivo(e.target.checked)} style={{ width: 15, height: 15, accentColor: 'var(--gold)' }} />
          Recorrência ativa (desmarque para pausar a projeção)
        </label>
      </div>
    </Modal>
  )
}

function Field({ label, children }) {
  return <div style={{ display: 'flex', flexDirection: 'column' }}><label style={labelStyle}>{label}</label>{children}</div>
}
function Row({ children, cols = 1 }) {
  return <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 14, marginBottom: 14 }}>{children}</div>
}

const labelStyle = { fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-mid)', marginBottom: 6, fontFamily: 'var(--body)' }
const input = { width: '100%', padding: '9px 12px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 13, color: 'var(--navy)', background: 'var(--white)', outline: 'none', boxSizing: 'border-box' }
const btnGhost = { padding: '10px 18px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, background: 'var(--white)', color: 'var(--navy)', fontFamily: 'var(--body)', fontSize: 12, fontWeight: 600, cursor: 'pointer', letterSpacing: 0.5 }
const btnPrimary = { padding: '10px 18px', border: 'none', borderRadius: 6, background: 'var(--gold)', color: '#fff', fontFamily: 'var(--body)', fontSize: 12, fontWeight: 700, cursor: 'pointer', letterSpacing: 0.5 }
