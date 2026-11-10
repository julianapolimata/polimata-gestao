import { useEffect, useMemo, useState } from 'react'
import CampoData from '../../components/CampoData'
import Modal from '../../components/Modal'
import { showToast } from '../../components/Toast'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { proximoCodigoProjeto } from '../../lib/codigos'
import { fmtMoney } from '../../lib/finance'
import { acharPessoa, pessoasDosTipos, rotuloDoVinculo, estiloVinculoOk, estiloVinculoFalta } from '../../lib/vinculoPessoa'

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
  const [clienteId, setClienteId] = useState(null)
  const [responsavel, setResponsavel] = useState('')
  const [statusV, setStatusV] = useState('Em planejamento')
  const [progresso, setProgresso] = useState('')
  const [inicio, setInicio] = useState('')
  const [deadline, setDeadline] = useState('')
  const [descricao, setDescricao] = useState('')
  const [etapas, setEtapas] = useState([])

  const [pessoas, setPessoas] = useState([])
  // A oportunidade que originou este projeto. Consultada, nunca copiada: a
  // referência da venda mora na oportunidade e em lugar nenhum mais.
  const [venda, setVenda] = useState(null)
  const cicloDoProjeto = registro?.data?.ciclo || 1

  useEffect(() => {
    const id = registro?.data?.oportunidade_id
    if (!open || !id) { setVenda(null); return undefined }
    let cancelado = false
    supabase.from('oportunidades').select('id, codigo, data').eq('id', id).maybeSingle()
      .then(({ data, error }) => {
        // A oportunidade pode ter sido apagada: o projeto continua valendo, e
        // a tela apenas deixa de mostrar a origem.
        if (!cancelado) setVenda(error ? null : data)
      })
    return () => { cancelado = true }
  }, [open, registro])
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
      setNome(d.name || '')
      setCliente(d.client || '')
      setClienteId(d.pessoa_id || null)
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

  const clientesAceitos = useMemo(() => pessoasDosTipos(pessoas, ['Cliente', 'Prospect']), [pessoas])
  const clientesSugeridos = useMemo(() => clientesAceitos.map(p => p.data.nome), [clientesAceitos])
  const clienteVinculado = useMemo(
    () => (clienteId ? pessoas.find(p => p.id === clienteId) || null : null),
    [clienteId, pessoas],
  )

  function digitarCliente(nome) {
    setCliente(nome)
    setClienteId(acharPessoa(clientesAceitos, nome)?.id || null)
  }

  // Contratos do mesmo cliente — informativo
  // Antes isto comparava TEXTO em minusculas — e por isso nunca acharia a
  // Plancus, escrita "EIRELI" num lado e "LTDA" no outro. Agora o vinculo
  // manda; a comparacao por nome fica so para contrato antigo, sem vinculo.
  const contratosVinculados = useMemo(() => {
    if (!clienteId && !cliente.trim()) return []
    return contratos.filter(c => (
      clienteId && c.data?.pessoa_id
        ? c.data.pessoa_id === clienteId
        : !c.data?.pessoa_id && acharPessoa([{ id: 1, data: { nome: c.data?.party } }], cliente)
    ))
  }, [contratos, cliente, clienteId])

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
        // O nome continua gravado; ao lado dele vai o identificador.
        pessoa_id: clienteId,
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
        {/* DE QUAL VENDA ESTE PROJETO VEIO.
            O projeto guardava `oportunidade_id` desde 09/11/2026 e nenhuma
            tela lia: o elo proposta → projeto existia no dado e não na tela.
            Abrir um projeto não dizia de qual proposta ele veio, nem por
            quanto foi vendido — que é justamente contra o que o faturamento
            precisa ser comparado. */}
        {venda && (
          <div style={blocoVenda}>
            <div style={blocoVendaTitulo}>Proposta de origem</div>
            <div>
              <strong>{venda.codigo || 'sem referência'}</strong>
              {venda.data?.data_proposta ? ` · proposta de ${dataBR(venda.data.data_proposta)}` : ''}
              {Number(venda.data?.valor_estimado) > 0
                ? ` · vendido por ${fmtMoney(Number(venda.data.valor_estimado))}`
                : ''}
            </div>
            {Number(cicloDoProjeto) > 1 && (
              <div style={blocoVendaNota}>
                Ciclo {cicloDoProjeto} — renovação do projeto anterior deste cliente.
              </div>
            )}
          </div>
        )}

        <Field label="Nome do Projeto *">
          <input value={nome} onChange={e => setNome(e.target.value)} placeholder="Nome do projeto" style={input} />
        </Field>
      </Row>
      <Row cols={2}>
        <Field label="Cliente">
          <input value={cliente} onChange={e => digitarCliente(e.target.value)} list="projeto-cliente-list" placeholder="Cliente" style={input} autoComplete="off" />
          <datalist id="projeto-cliente-list">
            {clientesSugeridos.map(n => <option key={n} value={n} />)}
          </datalist>
          {cliente.trim() && (
            clienteVinculado
              ? <div style={estiloVinculoOk}>{rotuloDoVinculo(clienteVinculado)}</div>
              : <div style={estiloVinculoFalta}>Sem cadastro correspondente. O projeto fica só com o nome.</div>
          )}
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
          <CampoData value={inicio} onChange={e => setInicio(e.target.value)} style={input} />
        </Field>
        <Field label="Data de Entrega">
          <CampoData value={deadline} onChange={e => setDeadline(e.target.value)} style={input} />
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
                <CampoData value={et.data || ''} onChange={e => updateEtapa(idx, { data: e.target.value })}
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
function dataBR(iso) {
  if (!iso) return ""
  const [a, m, d] = String(iso).slice(0, 10).split("-")
  return d ? `${d}/${m}/${a}` : iso
}

const blocoVenda = {
  gridColumn: "1 / -1",
  background: "var(--cream)", border: "1px solid var(--cream-dark)",
  borderRadius: 7, padding: "10px 13px", marginBottom: 4,
  fontSize: 12.5, color: "var(--navy)", lineHeight: 1.6,
}
const blocoVendaTitulo = {
  fontSize: 9, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase",
  color: "var(--text-mid)", marginBottom: 3,
}
const blocoVendaNota = { fontSize: 11, color: "var(--text-mid)", marginTop: 3 }
const input = { width: '100%', padding: '9px 12px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 13, color: 'var(--navy)', background: 'var(--white)', outline: 'none', boxSizing: 'border-box' }
const etapasBox = { marginTop: 4, padding: 14, background: 'rgba(0,32,62,0.03)', borderLeft: '3px solid var(--navy)', borderRadius: 6 }
const etapaRow = { display: 'flex', alignItems: 'center', gap: 8 }
const btnAdd = { padding: '6px 12px', borderRadius: 4, border: '1.5px solid var(--cream-dark)', background: 'var(--white)', color: 'var(--navy)', fontFamily: 'var(--body)', fontSize: 11, fontWeight: 600, cursor: 'pointer' }
const btnRemoveEtapa = { background: 'none', border: '1px solid transparent', borderRadius: 4, color: 'var(--text-mid)', fontSize: 18, cursor: 'pointer', width: 28, height: 28, padding: 0 }
const btnGhost = { padding: '10px 18px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, background: 'var(--white)', color: 'var(--navy)', fontFamily: 'var(--body)', fontSize: 12, fontWeight: 600, cursor: 'pointer', letterSpacing: 0.5 }
const btnPrimary = { padding: '10px 18px', border: 'none', borderRadius: 6, background: 'var(--gold)', color: '#fff', fontFamily: 'var(--body)', fontSize: 12, fontWeight: 700, cursor: 'pointer', letterSpacing: 0.5 }
