import { useEffect, useRef, useState } from 'react'
import Modal from '../../components/Modal'
import { showToast } from '../../components/Toast'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { VARIAVEIS_NFSE, EXEMPLO_MODELO, preencherModelo } from '../../lib/nfseModelos'

export default function ModalNfseModelo({ open, onClose, registro, onSaved }) {
  const { user } = useAuth()
  const isEdit = !!registro
  const textareaRef = useRef(null)

  const [nome, setNome] = useState('')
  const [discriminacao, setDiscriminacao] = useState('')
  const [itemLista, setItemLista] = useState('')
  const [aliquota, setAliquota] = useState('')
  const [ativo, setAtivo] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    const d = (isEdit && registro?.data) ? registro.data : {}
    setNome(d.nome || '')
    setDiscriminacao(d.discriminacao || '')
    setItemLista(d.item_lista_servico || '')
    setAliquota(d.aliquota_iss != null ? String(d.aliquota_iss) : '')
    setAtivo(d.ativo !== false)
  }, [open, isEdit, registro])

  // Insere {chave} na posição do cursor do textarea.
  function inserirVariavel(chave) {
    const marcador = `{${chave}}`
    const el = textareaRef.current
    if (!el) { setDiscriminacao(v => v + marcador); return }
    const ini = el.selectionStart ?? discriminacao.length
    const fim = el.selectionEnd ?? discriminacao.length
    const novo = discriminacao.slice(0, ini) + marcador + discriminacao.slice(fim)
    setDiscriminacao(novo)
    // Reposiciona o cursor depois do marcador inserido
    requestAnimationFrame(() => {
      el.focus()
      const pos = ini + marcador.length
      el.setSelectionRange(pos, pos)
    })
  }

  async function handleSave() {
    if (!nome.trim()) { showToast('Dê um nome ao modelo.', 'warning'); return }
    if (!discriminacao.trim()) { showToast('Escreva a discriminação do serviço.', 'warning'); return }
    setSaving(true)
    try {
      const data = {
        nome: nome.trim(),
        discriminacao: discriminacao.trim(),
        item_lista_servico: itemLista.trim() || null,
        aliquota_iss: aliquota === '' ? null : Number(aliquota),
        ativo,
      }
      if (isEdit) {
        const merged = { ...(registro.data || {}), ...data }
        const { error } = await supabase.from('nfse_modelos').update({ data: merged }).eq('id', registro.id)
        if (error) throw error
        showToast('Modelo atualizado.', 'success')
      } else {
        if (!user) { showToast('Sessão expirada.', 'error'); return }
        const { error } = await supabase.from('nfse_modelos').insert({
          user_id: user.id,
          data: { ...data, created: new Date().toISOString().slice(0, 10) },
        })
        if (error) throw error
        showToast(`Modelo "${nome.trim()}" criado.`, 'success')
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

  const preview = preencherModelo(discriminacao, EXEMPLO_MODELO)

  return (
    <Modal
      open={open}
      onClose={saving ? () => {} : onClose}
      title={isEdit ? `Editar modelo · ${registro.data?.nome || ''}` : 'Novo modelo de NFS-e'}
      width={640}
      footer={
        <>
          <button type="button" onClick={onClose} style={btnGhost} disabled={saving}>Cancelar</button>
          <button type="button" onClick={handleSave} style={btnPrimary} disabled={saving}>{saving ? 'Salvando…' : 'Salvar modelo'}</button>
        </>
      }
    >
      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>Nome do modelo *</label>
        <input value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex: Consultoria GRC mensal" style={input} />
      </div>

      <div style={{ marginBottom: 8 }}>
        <label style={labelStyle}>Discriminação do serviço *</label>
        <textarea
          ref={textareaRef}
          value={discriminacao}
          onChange={e => setDiscriminacao(e.target.value)}
          placeholder="Ex: Serviços de consultoria em GRC prestados a {cliente}, referente à competência {competencia}, no valor de {valor}."
          style={{ ...input, minHeight: 96, resize: 'vertical', lineHeight: 1.5 }}
        />
      </div>

      {/* Chips de variáveis */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 10, color: 'var(--text-mid)', fontWeight: 700, letterSpacing: 0.5, marginBottom: 7 }}>
          Clique para inserir uma variável:
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {VARIAVEIS_NFSE.map(v => (
            <button
              key={v.chave}
              type="button"
              onClick={() => inserirVariavel(v.chave)}
              title={v.descricao}
              style={chip}
            >{`{${v.chave}}`}</button>
          ))}
        </div>
      </div>

      {/* Pré-visualização */}
      <div style={previewBox}>
        <div style={{ fontSize: 9, color: 'var(--text-mid)', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>
          Prévia (com dados de exemplo)
        </div>
        <div style={{ fontSize: 13, color: 'var(--navy)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
          {preview || <span style={{ color: 'var(--text-mid)', fontStyle: 'italic' }}>A discriminação aparece aqui…</span>}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 16 }}>
        <div>
          <label style={labelStyle}>Item da lista (LC 116)</label>
          <input value={itemLista} onChange={e => setItemLista(e.target.value)} placeholder="Ex: 17.01" style={input} title="Opcional — sobrepõe o padrão da configuração para este modelo" />
        </div>
        <div>
          <label style={labelStyle}>Alíquota ISS (%)</label>
          <input type="number" step="0.01" value={aliquota} onChange={e => setAliquota(e.target.value)} placeholder="Padrão da config" style={input} title="Opcional — sobrepõe a alíquota da configuração" />
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, color: 'var(--navy)', fontWeight: 600 }}>
          <input type="checkbox" checked={ativo} onChange={e => setAtivo(e.target.checked)} style={{ width: 15, height: 15, accentColor: 'var(--gold)' }} />
          Modelo ativo
        </label>
      </div>
    </Modal>
  )
}

const labelStyle = { display: 'block', fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-mid)', marginBottom: 6, fontFamily: 'var(--body)' }
const input = { width: '100%', padding: '9px 12px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 13, color: 'var(--navy)', background: 'var(--white)', outline: 'none', boxSizing: 'border-box' }
const chip = { padding: '5px 11px', borderRadius: 999, border: '1px solid var(--gold)', background: 'rgba(204,145,94,0.08)', color: 'var(--gold-dark)', fontFamily: 'monospace', fontSize: 12, cursor: 'pointer', fontWeight: 600 }
const previewBox = { background: 'var(--cream)', border: '1px solid var(--cream-dark)', borderLeft: '3px solid var(--gold)', borderRadius: 6, padding: 14 }
const btnGhost = { padding: '10px 18px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, background: 'var(--white)', color: 'var(--navy)', fontFamily: 'var(--body)', fontSize: 12, fontWeight: 600, cursor: 'pointer', letterSpacing: 0.5 }
const btnPrimary = { padding: '10px 18px', border: 'none', borderRadius: 6, background: 'var(--gold)', color: '#fff', fontFamily: 'var(--body)', fontSize: 12, fontWeight: 700, cursor: 'pointer', letterSpacing: 0.5 }
