import { useEffect, useMemo, useState } from 'react'
import Modal from '../../components/Modal'
import { showToast } from '../../components/Toast'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { proximoCodigoProjeto } from '../../lib/codigos'

// =============================================================================
// MODAL PROJETO — replica saveProject() do legado (linha 4195).
// Inclui editor inline de etapas/marcos (lista dinâmica de nome + data).
// =============================================================================

const STATUSES = ['Em planejamento', 'Em execução', 'Pausado', 'Concluído', 'Cancelado']

export default function ModalProjeto({ open, onClose, registro, onSaved }) {
  const { user } = useAuth()
  const isEdit = !!registro

  const [nome, setNome] = useState('')
  const [cliente, setCliente] = useState('')
  const [responsavel, setResponsavel] = useState('')
  const [statusV, setStatusV] = useState('Em planejamento')
  const [progresso, setProgresso] = useState('')
  const [inicio, setInicio] = useState('')
  const [deadline, setDeadline] = useState('')
  const [descricao, setDescricao] = useState('')
  const [etapas, setEtapas] = useState([])

  const [pessoas, setPessoas] = useState([])
  const [contratos, setContratos] = useState([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    Promise.all([
      supabase.from('pessoas').select('id,data'),
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
      setNome(d.name || '')
      setCliente(d.client || '')
      setResponsavel(d.responsavel || '')
      setStatusV(d.status || 'Em planejamento')
      setProgresso(d.progress != null ? String(d.progress) : '')
      setInicio(d.start || '')
      setDeadline(d.deadline || '')
      setDescricao(d.desc || '')
      setEtapas(Array.isArray(d.etapas) ? d.etapas.map(e => ({ ...e })) : [])
    } else {
      setNome(''); setCliente(''); setResponsavel('')
      setStatusV('Em planejamento'); setProgresso('')
      setInicio(''); setDeadline(''); setDescricao('')
      setEtapas([])
    }
  }, [open, isEdit, registro])

  const clientesSugeridos = useMemo(() => {
    const tipos = ['Cliente', 'Prospect']
    return pessoas
      .filter(p => tipos.includes(p.data?.tipo))
      .map(p => p.data?.nome)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [pessoas])

  // Contratos do mesmo cliente — informativo
  const contratosVinculados = useMemo(() => {
    if (!cliente.trim()) return []
    return contratos.filter(c => (c.data?.party || '').toLowerCase() === cliente.trim().toLowerCase())
  }, [contratos, cliente])

  function addEtapa() {
    setEtapas(e => [...e, { id: Math.random().toString(36).slice(2), nome: '', data: '', concluida: false }])
  }
  function updateEtapa(idx, patch) {
    setEtapas(e => e.map((it, i) => i === idx ? { ...it, ...patch } : it))
  }
  function removeEtapa(idx) {
    setEtapas(e => e.filter((_, i) => i !== idx))
  }

  async function handleSave() {
    if (!nome.trim()) { showToast('Informe o nome do projeto.', 'warning'); return }
    setSaving(true)
    try {
      const etapasLimpas = etapas
        .filter(e => e.nome?.trim())
        .map(e => ({
          id: e.id || Math.random().toString(36).slice(2),
          nome: e.nome.trim(),
          data: e.data || null,
          concluida: !!e.concluida,
        }))
      const data = {
        name: nome.trim(),
        client: cliente.trim() || null,
        responsavel: responsavel.trim() || null,
        status: statusV,
        progress: progresso === '' ? null : Math.max(0, Math.min(100, Number(progresso))),
        start: inicio || null,
        deadline: deadline || null,
        desc: descricao.trim() || null,
        etapas: etapasLimpas,
      }
      if (isEdit) {
        const merged = { ...(registro.data || {}), ...data }
        const { error } = await supabase.from('projects').update({ data: merged }).eq('id', registro.id)
        if (error) throw error
        showToast('Projeto atualizado.', 'success')
      } else {
        if (!user) { showToast('Sessão expirada.', 'error'); return }
        const codigo = await proximoCodigoProjeto()
        const payload = {
          user_id: user.id, codigo,
          data: { ...data, created: new Date().toISOString().slice(0, 10) },
        }
        const { error } = await supabase.from('projects').insert(payload)
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
    ? `Editar Projeto${registro.codigo ? ` · ${registro.codigo}` : ''}`
    : 'Novo Projeto'

  return (
    <Modal
      open={open}
      onClose={saving ? () => {} : onClose}
      title={title}
      width={760}
      footer={
        <>
          <button type="button" onClick={onClose} style={btnGhost} disabled={saving}>Cancelar</button>
          <button type="button" onClick={handleSave} style={btnPrimary} disabled={saving}>
            {saving ? 'Salvando…' : 'Salvar Projeto'}
          </button>
        </>
      }
    >
      <Row>
        <Field label="Nome do Projeto *">
          <input value={nome} onChange={e => setNome(e.target.value)} placeholder="Nome do projeto" style={input} />
        </Field>
      </Row>
      <Row cols={2}>
        <Field label="Cliente">
          <input value={cliente} onChange={e => setCliente(e.target.value)} list="projeto-cliente-list" placeholder="Cliente" style={input} autoComplete="off" />
          <datalist id="projeto-cliente-list">
            {clientesSugeridos.map(n => <option key={n} value={n} />)}
          </datalist>
        </Field>
        <Field label="Responsável">
          <input value={responsavel} onChange={e => setResponsavel(e.target.value)} placeholder="Quem toca o projeto" style={input} />
        </Field>
      </Row>
      <Row cols={2}>
        <Field label="Status">
          <select value={statusV} onChange={e => setStatusV(e.target.value)} style={input}>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Progresso (%)">
          <input type="number" min={0} max={100} value={progresso} onChange={e => setProgresso(e.target.value)} placeholder="0" style={input} />
        </Field>
      </Row>
      <Row cols={2}>
        <Field label="Data de Início">
          <input type="date" value={inicio} onChange={e => setInicio(e.target.value)} style={input} />
        </Field>
        <Field label="Data de Entrega">
          <input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} style={input} />
        </Field>
      </Row>
      <Row>
        <Field label="Descrição / Escopo">
          <textarea value={descricao} onChange={e => setDescricao(e.target.value)} placeholder="Descreva o escopo e entregas esperadas…" style={{ ...input, minHeight: 70, resize: 'vertical' }} />
        </Field>
      </Row>

      {/* Etapas/marcos */}
      <div style={etapasBox}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <label style={{ fontWeight: 600, color: 'var(--navy)', fontSize: 13 }}>📍 Etapas / Marcos</label>
          <button type="button" onClick={addEtapa} style={btnAdd}>+ Etapa</button>
        </div>
        {etapas.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--text-mid)', fontStyle: 'italic', textAlign: 'center', padding: '10px 0' }}>
            Nenhuma etapa cadastrada.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {etapas.map((et, idx) => (
              <div key={et.id || idx} style={etapaRow}>
                <input
                  type="checkbox" checked={!!et.concluida}
                  onChange={e => updateEtapa(idx, { concluida: e.target.checked })}
                  style={{ width: 16, height: 16, accentColor: 'var(--gold)' }}
                  title="Marcar como concluída"
                />
                <input
                  value={et.nome || ''} onChange={e => updateEtapa(idx, { nome: e.target.value })}
                  placeholder="Nome da etapa"
                  style={{ ...input, flex: 1 }}
                />
                <input
                  type="date" value={et.data || ''} onChange={e => updateEtapa(idx, { data: e.target.value })}
                  style={{ ...input, width: 150 }}
                />
                <button
                  type="button" onClick={() => removeEtapa(idx)}
                  style={btnRemoveEtapa} aria-label="Remover etapa" title="Remover"
                >×</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {contratosVinculados.length > 0 && (
        <div style={{ fontSize: 11, color: 'var(--text-mid)', marginTop: 10 }}>
          📎 Contratos vinculados ao cliente "{cliente}": {contratosVinculados.length}
        </div>
      )}
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
const etapasBox = { marginTop: 4, padding: 14, background: 'rgba(0,32,62,0.03)', borderLeft: '3px solid var(--navy)', borderRadius: 6 }
const etapaRow = { display: 'flex', alignItems: 'center', gap: 8 }
const btnAdd = { padding: '6px 12px', borderRadius: 4, border: '1.5px solid var(--cream-dark)', background: 'var(--white)', color: 'var(--navy)', fontFamily: 'var(--body)', fontSize: 11, fontWeight: 600, cursor: 'pointer' }
const btnRemoveEtapa = { background: 'none', border: '1px solid transparent', borderRadius: 4, color: 'var(--text-mid)', fontSize: 18, cursor: 'pointer', width: 28, height: 28, padding: 0 }
const btnGhost = { padding: '10px 18px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, background: 'var(--white)', color: 'var(--navy)', fontFamily: 'var(--body)', fontSize: 12, fontWeight: 600, cursor: 'pointer', letterSpacing: 0.5 }
const btnPrimary = { padding: '10px 18px', border: 'none', borderRadius: 6, background: 'var(--gold)', color: '#fff', fontFamily: 'var(--body)', fontSize: 12, fontWeight: 700, cursor: 'pointer', letterSpacing: 0.5 }
