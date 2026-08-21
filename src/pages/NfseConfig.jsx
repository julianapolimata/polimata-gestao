import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import AppLayout from '../components/AppLayout'
import EstadoErro from '../components/EstadoErro'
import { showToast } from '../components/Toast'
import ModalNfseModelo from './components/ModalNfseModelo'
import { preencherModelo, EXEMPLO_MODELO } from '../lib/nfseModelos'

// =====================================================================
// NFS-e — Bloco 1: Configuração do emitente + modelos de texto.
// Padrão Nacional obrigatório p/ optantes do Simples a partir de 01/09/2026
// (CGSN 189/2026). Aqui ficam só os parâmetros fiscais NÃO-secretos; o
// certificado A1 é segredo de servidor (configurado no Bloco 2, na Vercel).
// =====================================================================

const REGIMES = ['Simples Nacional - ME/EPP', 'MEI', 'Regime Normal']
const REGIMES_ESPECIAIS = ['Nenhum', 'Microempresa Municipal', 'Estimativa', 'Sociedade de Profissionais', 'Cooperativa', 'MEI', 'ME/EPP']

export default function NfseConfig() {
  const { user } = useAuth()
  const [config, setConfig] = useState(null)
  const [modelos, setModelos] = useState([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState(null)
  const [saving, setSaving] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [modeloEdicao, setModeloEdicao] = useState(null)

  // Campos fiscais
  const [f, setF] = useState({
    ambiente: 'homologacao',
    inscricao_municipal: '',
    municipio_incidencia: 'Valinhos',
    codigo_municipio_ibge: '3556206',
    regime_tributario: 'Simples Nacional - ME/EPP',
    regime_especial: 'Nenhum',
    optante_simples: true,
    incentivador_cultural: false,
    item_lista_servico: '',
    codigo_tributacao_nacional: '',
    cnae: '',
    aliquota_iss: '',
    iss_retido: false,
    descricao_padrao: '',
  })
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }))
  // Reforma tributária (IBS/CBS) — objeto aninhado em reforma_ibs_cbs
  const setReforma = (k, v) => setF(prev => ({ ...prev, reforma_ibs_cbs: { ...(prev.reforma_ibs_cbs || {}), [k]: v } }))
  const setNbs = (i, codigo) => setF(prev => {
    const arr = [...((prev.reforma_ibs_cbs?.nbs) || [])]
    while (arr.length <= i) arr.push({ codigo: '', desc: '' })
    arr[i] = { ...arr[i], codigo }
    return { ...prev, reforma_ibs_cbs: { ...(prev.reforma_ibs_cbs || {}), nbs: arr } }
  })

  const carregar = useCallback(() => {
    if (!user) return
    setLoading(true)
    Promise.all([
      supabase.from('nfse_config').select('*').limit(1),
      supabase.from('nfse_modelos').select('*').order('created_at', { ascending: true }),
    ]).then(([rC, rM]) => {
      if (rC.error || rM.error) { setErro(rC.error || rM.error); setLoading(false); return }
      setErro(null)
      const cfg = rC.data?.[0] || null
      setConfig(cfg)
      if (cfg?.data) {
        const d = cfg.data
        setF(prev => ({ ...prev, ...d, aliquota_iss: d.aliquota_iss == null ? '' : String(d.aliquota_iss) }))
      }
      setModelos(rM.data || [])
      setLoading(false)
    }).catch(e => { setErro(e); setLoading(false) })
  }, [user])

  useEffect(() => { carregar() }, [carregar])

  async function salvar() {
    if (!user) { showToast('Sessão expirada.', 'error'); return }
    setSaving(true)
    try {
      const data = {
        ...f,
        aliquota_iss: f.aliquota_iss === '' ? null : Number(f.aliquota_iss),
        inscricao_municipal: (f.inscricao_municipal || '').trim(),
        item_lista_servico: (f.item_lista_servico || '').trim(),
        codigo_tributacao_nacional: (f.codigo_tributacao_nacional || '').trim(),
        cnae: (f.cnae || '').trim(),
        descricao_padrao: (f.descricao_padrao || '').trim(),
      }
      if (config?.id) {
        const { error } = await supabase.from('nfse_config').update({ data }).eq('id', config.id)
        if (error) throw error
      } else {
        const { data: inserted, error } = await supabase.from('nfse_config')
          .insert({ user_id: user.id, data }).select('*').single()
        if (error) throw error
        setConfig(inserted)
      }
      showToast('Configuração salva.', 'success')
    } catch (e) {
      console.error(e)
      showToast(e?.message || 'Erro ao salvar.', 'error')
    } finally {
      setSaving(false)
    }
  }

  function novoModelo() { setModeloEdicao(null); setModalOpen(true) }
  function editarModelo(m) { setModeloEdicao(m); setModalOpen(true) }
  async function excluirModelo(m) {
    if (!confirm(`Excluir o modelo "${m.data?.nome || ''}"?`)) return
    const { error } = await supabase.from('nfse_modelos').delete().eq('id', m.id)
    if (error) { showToast('Erro ao excluir: ' + error.message, 'error'); return }
    showToast('Modelo excluído.', 'info')
    carregar()
  }

  if (loading) return <AppLayout title="Configurar NFS-e"><div style={emptyState}>Carregando…</div></AppLayout>
  if (erro) return <AppLayout title="Configurar NFS-e"><EstadoErro onRetry={carregar} /></AppLayout>

  return (
    <AppLayout title="Configurar NFS-e">
      {/* Banner de contexto / prazo legal */}
      <div style={bannerBox}>
        <div style={{ fontSize: 20 }}>🧾</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--navy)' }}>NFS-e Padrão Nacional</div>
          <div style={{ fontSize: 12, color: 'var(--text-mid)', marginTop: 3, lineHeight: 1.5 }}>
            Obrigatória para optantes do Simples Nacional a partir de <strong>01/09/2026</strong> (CGSN 189/2026),
            exclusivamente pelo Emissor Nacional. Configure aqui os parâmetros fiscais e os modelos de texto —
            a emissão pela API entra no próximo bloco.
          </div>
        </div>
        <span style={{ ...pill, ...(f.ambiente === 'producao' ? pillProd : pillHomolog) }}>
          {f.ambiente === 'producao' ? 'PRODUÇÃO' : 'HOMOLOGAÇÃO'}
        </span>
      </div>

      {/* ── Configuração fiscal ── */}
      <div style={card}>
        <SecTitle>Ambiente</SecTitle>
        <Row cols={2}>
          <Field label="Ambiente de emissão">
            <select value={f.ambiente} onChange={e => set('ambiente', e.target.value)} style={input}>
              <option value="homologacao">Homologação (testes)</option>
              <option value="producao">Produção (vale de verdade)</option>
            </select>
          </Field>
          <div />
        </Row>
        {f.ambiente === 'producao' && (
          <div style={noteBox}>
            ⚠️ Produção emite notas com validade fiscal. Só mude para cá depois de testar em homologação com dados fictícios.
          </div>
        )}

        <div style={divider} />
        <SecTitle>Dados do emitente</SecTitle>
        <Row cols={2}>
          <Field label="Inscrição Municipal">
            <input value={f.inscricao_municipal} onChange={e => set('inscricao_municipal', e.target.value)} placeholder="Nº da inscrição em Valinhos" style={input} />
          </Field>
          <Field label="Regime tributário">
            <select value={f.regime_tributario} onChange={e => set('regime_tributario', e.target.value)} style={input}>
              {REGIMES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
        </Row>
        <Row cols={2}>
          <Field label="Município de incidência">
            <input value={f.municipio_incidencia} onChange={e => set('municipio_incidencia', e.target.value)} style={input} />
          </Field>
          <Field label="Código IBGE do município">
            <input value={f.codigo_municipio_ibge} onChange={e => set('codigo_municipio_ibge', e.target.value)} placeholder="Ex: 3556206 (Valinhos)" style={input} />
          </Field>
        </Row>
        <Row cols={2}>
          <Field label="Regime especial de tributação">
            <select value={f.regime_especial} onChange={e => set('regime_especial', e.target.value)} style={input}>
              {REGIMES_ESPECIAIS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, justifyContent: 'flex-end', paddingBottom: 4 }}>
            <Check label="Optante pelo Simples Nacional" checked={f.optante_simples} onChange={v => set('optante_simples', v)} />
            <Check label="Incentivador cultural" checked={f.incentivador_cultural} onChange={v => set('incentivador_cultural', v)} />
          </div>
        </Row>

        <div style={divider} />
        <SecTitle>Serviço prestado</SecTitle>
        <Row cols={3}>
          <Field label="Item da lista (LC 116)">
            <input value={f.item_lista_servico} onChange={e => set('item_lista_servico', e.target.value)} placeholder="Ex: 17.01" style={input} title="Consultoria costuma ser 17.xx — confirme com seu contador" />
          </Field>
          <Field label="Cód. tributação nacional">
            <input value={f.codigo_tributacao_nacional} onChange={e => set('codigo_tributacao_nacional', e.target.value)} placeholder="Código nacional" style={input} />
          </Field>
          <Field label="CNAE">
            <input value={f.cnae} onChange={e => set('cnae', e.target.value)} placeholder="Ex: 7020400" style={input} />
          </Field>
        </Row>
        <Row cols={3}>
          <Field label="Alíquota ISS (%)">
            <input type="number" step="0.01" value={f.aliquota_iss} onChange={e => set('aliquota_iss', e.target.value)} placeholder="Ex: 2,00" style={input} />
          </Field>
          <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 10 }}>
            <Check label="ISS retido pelo tomador" checked={f.iss_retido} onChange={v => set('iss_retido', v)} />
          </div>
          <div />
        </Row>

        <div style={divider} />
        <SecTitle>Reforma Tributária · IBS/CBS (2026)</SecTitle>
        <div style={{ ...noteBox, marginBottom: 14 }}>
          Códigos do padrão nacional (LC 214/2025), em <strong>fase de teste em 2026</strong>. Confirmados com o contador (JL Ramos / Rebeca Pereira, 20/08/2026).
        </div>
        <Row cols={2}>
          <Field label="NBS principal (consultoria)">
            <input value={f.reforma_ibs_cbs?.nbs?.[0]?.codigo || ''} onChange={e => setNbs(0, e.target.value)} placeholder="Ex: 1.1401.19.00" style={input} />
          </Field>
          <Field label="NBS secundário (apoio administrativo)">
            <input value={f.reforma_ibs_cbs?.nbs?.[1]?.codigo || ''} onChange={e => setNbs(1, e.target.value)} placeholder="Ex: 1.1806.40.90" style={input} />
          </Field>
        </Row>
        <Row cols={3}>
          <Field label="CST (situação tributária)">
            <input value={f.reforma_ibs_cbs?.cst || ''} onChange={e => setReforma('cst', e.target.value)} placeholder="Ex: 000" style={input} />
          </Field>
          <Field label="cClassTrib (classif. tributária)">
            <input value={f.reforma_ibs_cbs?.cclasstrib || ''} onChange={e => setReforma('cclasstrib', e.target.value)} placeholder="Ex: 000001" style={input} />
          </Field>
          <Field label="cIndOp (indicador da operação)">
            <input value={f.reforma_ibs_cbs?.cindop || ''} onChange={e => setReforma('cindop', e.target.value)} placeholder="Ex: 000001" style={input} />
          </Field>
        </Row>
        <Row cols={2}>
          <Field label="Alíquota IBS (%)">
            <input type="number" step="0.01" value={f.reforma_ibs_cbs?.aliquota_ibs ?? ''} onChange={e => setReforma('aliquota_ibs', e.target.value === '' ? null : Number(e.target.value))} placeholder="Ex: 0,10" style={input} />
          </Field>
          <Field label="Alíquota CBS (%)">
            <input type="number" step="0.01" value={f.reforma_ibs_cbs?.aliquota_cbs ?? ''} onChange={e => setReforma('aliquota_cbs', e.target.value === '' ? null : Number(e.target.value))} placeholder="Ex: 0,00" style={input} />
          </Field>
        </Row>

        <Row>
          <Field label="Discriminação padrão (usada quando não há modelo)">
            <textarea value={f.descricao_padrao} onChange={e => set('descricao_padrao', e.target.value)} placeholder="Texto padrão da nota. Aceita as mesmas variáveis dos modelos, ex: {cliente}, {competencia}, {valor}." style={{ ...input, minHeight: 70, resize: 'vertical', lineHeight: 1.5 }} />
          </Field>
        </Row>
        {f.descricao_padrao.trim() && (
          <div style={{ ...noteBox, borderLeftColor: 'var(--gold)', background: 'var(--cream)', color: 'var(--navy)' }}>
            <strong style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-mid)' }}>Prévia:</strong><br />
            {preencherModelo(f.descricao_padrao, EXEMPLO_MODELO)}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
          <button type="button" onClick={salvar} disabled={saving} style={btnPrimary}>{saving ? 'Salvando…' : 'Salvar configuração'}</button>
        </div>
      </div>

      {/* ── Certificado (segredo de servidor) ── */}
      <div style={{ ...card, background: 'var(--cream)', borderStyle: 'dashed' }}>
        <SecTitle>Certificado digital A1</SecTitle>
        <div style={{ fontSize: 13, color: 'var(--navy)', lineHeight: 1.6 }}>
          O certificado A1 (.pfx/.p12) e a senha <strong>não são salvos aqui</strong> — por segurança, eles ficam como
          segredo no servidor (Vercel) e são usados só na hora de emitir. Vamos configurá-los juntos quando ativarmos a
          emissão pela API (Bloco 2). Assim a chave do seu certificado nunca trafega pelo aplicativo.
        </div>
      </div>

      {/* ── Modelos de texto ── */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <div>
            <SecTitle noMargin>Modelos de texto</SecTitle>
            <div style={{ fontSize: 12, color: 'var(--text-mid)', marginTop: 2 }}>
              Textos programáveis com variáveis (ex: {'{cliente}'}, {'{competencia}'}, {'{valor}'}) — reaproveite a cada emissão.
            </div>
          </div>
          <button type="button" onClick={novoModelo} style={btnNovo}>+ Novo modelo</button>
        </div>

        {modelos.length === 0 ? (
          <div style={{ ...emptyState, boxShadow: 'none', border: '1px dashed var(--cream-dark)', marginTop: 12 }}>
            Nenhum modelo ainda. Crie um para a discriminação sair pronta a cada nota.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
            {modelos.map(m => (
              <div key={m.id} style={modeloRow}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--navy)' }}>{m.data?.nome || '(sem nome)'}</span>
                    {m.data?.ativo === false && <span style={inativoBadge}>inativo</span>}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-mid)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.data?.discriminacao || '—'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button type="button" onClick={() => editarModelo(m)} style={btnMini} title="Editar">Editar</button>
                  <button type="button" onClick={() => excluirModelo(m)} style={{ ...btnMini, color: 'var(--red)' }} title="Excluir">Excluir</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ModalNfseModelo open={modalOpen} onClose={() => setModalOpen(false)} registro={modeloEdicao} onSaved={carregar} />
    </AppLayout>
  )
}

function SecTitle({ children, noMargin }) {
  return <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--gold-dark)', marginBottom: noMargin ? 0 : 14 }}>{children}</div>
}
function Field({ label, children }) {
  return <div style={{ display: 'flex', flexDirection: 'column' }}><label style={labelStyle}>{label}</label>{children}</div>
}
function Row({ children, cols = 1 }) {
  return <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 14, marginBottom: 14 }}>{children}</div>
}
function Check({ label, checked, onChange }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, color: 'var(--navy)', fontWeight: 600 }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} style={{ width: 15, height: 15, accentColor: 'var(--gold)' }} />
      {label}
    </label>
  )
}

const card = { background: 'var(--white)', borderRadius: 12, padding: 24, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)', marginBottom: 18 }
const bannerBox = { background: 'var(--white)', borderRadius: 10, padding: 16, border: '1px solid var(--cream-dark)', borderLeft: '3px solid var(--gold)', boxShadow: 'var(--shadow)', marginBottom: 18, display: 'flex', gap: 14, alignItems: 'flex-start' }
const labelStyle = { fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-mid)', marginBottom: 6, fontFamily: 'var(--body)' }
const input = { width: '100%', padding: '9px 12px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 13, color: 'var(--navy)', background: 'var(--white)', outline: 'none', boxSizing: 'border-box' }
const divider = { height: 1, background: 'var(--cream-dark)', margin: '20px 0' }
const noteBox = { fontSize: 12, color: 'var(--navy)', background: 'rgba(204,145,94,0.08)', borderLeft: '3px solid var(--gold)', borderRadius: 6, padding: '10px 14px', marginTop: 4, lineHeight: 1.5 }
const btnPrimary = { padding: '11px 22px', border: 'none', borderRadius: 6, background: 'var(--gold)', color: '#fff', fontFamily: 'var(--body)', fontSize: 12, fontWeight: 700, cursor: 'pointer', letterSpacing: 0.5, textTransform: 'uppercase' }
const btnNovo = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 6, border: 'none', background: 'var(--gold)', color: '#fff', fontFamily: 'var(--body)', fontSize: 12, fontWeight: 700, letterSpacing: 0.5, cursor: 'pointer', textTransform: 'uppercase', flexShrink: 0 }
const btnMini = { padding: '6px 12px', borderRadius: 5, border: '1px solid var(--cream-dark)', background: 'var(--white)', color: 'var(--navy)', fontFamily: 'var(--body)', fontSize: 11, fontWeight: 600, cursor: 'pointer' }
const modeloRow = { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', border: '1px solid var(--cream-dark)', borderRadius: 8, background: 'var(--white)' }
const inativoBadge = { fontSize: 9, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', background: 'rgba(0,0,0,0.05)', color: 'var(--text-mid)', padding: '2px 8px', borderRadius: 999 }
const pill = { fontSize: 10, fontWeight: 800, letterSpacing: 1, padding: '5px 12px', borderRadius: 999, flexShrink: 0, alignSelf: 'center' }
const pillHomolog = { background: 'rgba(204,145,94,0.14)', color: 'var(--gold-dark)' }
const pillProd = { background: 'var(--navy)', color: '#f3eee4' }
const emptyState = { padding: '40px 24px', textAlign: 'center', fontFamily: 'var(--body)', color: 'var(--text-mid)', fontSize: 13, background: 'var(--white)', borderRadius: 12, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)' }
