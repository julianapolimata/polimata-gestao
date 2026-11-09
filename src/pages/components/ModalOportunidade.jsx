import { useEffect, useMemo, useState } from 'react'
import Modal from '../../components/Modal'
import CampoData from '../../components/CampoData'
import { showToast } from '../../components/Toast'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { msgErro } from '../../lib/erros'
import { fmtMoney } from '../../lib/finance'
import { ETAPAS, SITUACOES, ORIGENS, proximaReferencia, problemaNaOportunidade } from '../../lib/funil'

// =============================================================================
// A OPORTUNIDADE — o que está sendo negociado com uma pessoa.
//
// Ela aponta para a PESSOA, e não o contrário: no momento da proposta, quem
// está do outro lado ainda não é cliente. E cliente não precisa entrar pelo
// CRM para existir no cadastro — a oportunidade é opcional, a pessoa não.
//
// A REFERÊNCIA (P-2026-001) mora na coluna `codigo`, e em lugar nenhum mais.
// É ela que se cita na proposta, na nota e no nome do arquivo.
// =============================================================================
export default function ModalOportunidade({ open, onClose, registro, pessoas, onSaved }) {
  const { user } = useAuth()
  const isEdit = !!registro?.id

  const [pessoaId, setPessoaId] = useState('')
  const [codigo, setCodigo] = useState('')
  const [dataProposta, setDataProposta] = useState('')
  const [etapa, setEtapa] = useState('Sondagem')
  const [situacao, setSituacao] = useState('aberta')
  const [origem, setOrigem] = useState('')
  const [valor, setValor] = useState('')
  const [motivoPerda, setMotivoPerda] = useState('')
  const [descricao, setDescricao] = useState('')
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    if (!open) return
    if (isEdit) {
      const d = registro.data || {}
      setPessoaId(d.pessoa_id || '')
      setCodigo(registro.codigo || '')
      setDataProposta(d.data_proposta || '')
      setEtapa(d.etapa || '')
      setSituacao(d.situacao || 'aberta')
      setOrigem(d.origem || '')
      setValor(d.valor_estimado != null ? String(d.valor_estimado) : '')
      setMotivoPerda(d.motivo_perda || '')
      setDescricao(d.descricao || '')
    } else {
      setPessoaId(''); setCodigo(''); setEtapa('Sondagem'); setSituacao('aberta')
      setOrigem(''); setValor(''); setMotivoPerda(''); setDescricao('')
      setDataProposta(new Date().toISOString().slice(0, 10))
    }
  }, [open, isEdit, registro])

  const pessoasOrdenadas = useMemo(
    () => [...(pessoas || [])].sort((a, b) =>
      String(a.data?.nome || '').localeCompare(String(b.data?.nome || ''))),
    [pessoas],
  )

  // A referência é sugerida a partir do ANO DA PROPOSTA, não de hoje: uma
  // proposta de dezembro cadastrada em janeiro pertence ao ano dela.
  async function sugerirReferencia() {
    const ano = Number(String(dataProposta || '').slice(0, 4)) || new Date().getFullYear()
    const { data, error } = await supabase.from('oportunidades').select('codigo')
    if (error) { showToast(msgErro(error, 'Não consegui ler as referências já usadas.'), 'error'); return }
    setCodigo(proximaReferencia((data || []).map(o => o.codigo), ano))
  }

  async function salvar() {
    if (!user) { showToast('Sessão expirada.', 'error'); return }
    const d = {
      pessoa_id: pessoaId,
      data_proposta: dataProposta || null,
      etapa: situacao === 'aberta' ? etapa : '',
      situacao,
      origem: origem || '',
      valor_estimado: valor === '' ? null : Number(String(valor).replace(',', '.')),
      motivo_perda: situacao === 'perdida' ? motivoPerda.trim() : '',
      descricao: descricao.trim(),
    }
    const problema = problemaNaOportunidade(d)
    if (problema) { showToast(problema, 'warning'); return }

    setSalvando(true)
    try {
      if (isEdit) {
        const merged = { ...(registro.data || {}), ...d }
        const { error } = await supabase.from('oportunidades')
          .update({ data: merged, codigo: codigo.trim() || null }).eq('id', registro.id)
        if (error) throw error
        showToast('Oportunidade atualizada.', 'success')
      } else {
        const { error } = await supabase.from('oportunidades').insert({
          user_id: user.id, codigo: codigo.trim() || null,
          data: { ...d, created: new Date().toISOString().slice(0, 10) },
        })
        if (error) throw error
        showToast(codigo ? `${codigo} criada.` : 'Oportunidade criada.', 'success')
      }
      onSaved?.()
      onClose()
    } catch (e) {
      showToast(msgErro(e, 'Não consegui salvar a oportunidade.'), 'error')
    } finally { setSalvando(false) }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={640}
      title={isEdit ? `Oportunidade ${registro?.codigo || ''}`.trim() : 'Nova oportunidade'}
      footer={(
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={btnGhost}>Cancelar</button>
          <button onClick={salvar} disabled={salvando} style={btnPrimario}>
            {salvando ? 'Salvando…' : (isEdit ? 'Atualizar' : 'Criar')}
          </button>
        </div>
      )}
    >
      <Linha>
        <Campo label="Com quem *" flex="2 1 260px">
          <select value={pessoaId} onChange={e => setPessoaId(e.target.value)} style={input}>
            <option value="">— escolha a pessoa —</option>
            {pessoasOrdenadas.map(p => (
              <option key={p.id} value={p.id}>
                {p.codigo ? `${p.codigo} · ` : ''}{p.data?.nome || '(sem nome)'}
              </option>
            ))}
          </select>
          <div style={dica}>
            No momento da proposta ela ainda pode não ser cliente — e isso está certo.
          </div>
        </Campo>
        <Campo label="Data da proposta">
          <CampoData value={dataProposta} onChange={setDataProposta} />
        </Campo>
      </Linha>

      <Linha>
        <Campo label="Referência">
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              value={codigo}
              onChange={e => setCodigo(e.target.value)}
              placeholder="P-2026-001"
              style={{ ...input, flex: 1 }}
            />
            <button type="button" onClick={sugerirReferencia} style={btnMini}>sugerir</button>
          </div>
          <div style={dica}>
            É esta a referência citada na proposta, na nota e no nome do arquivo. Ela mora aqui.
          </div>
        </Campo>
        <Campo label="Valor estimado (R$)">
          <input value={valor} onChange={e => setValor(e.target.value)} inputMode="decimal" style={input} />
          {valor !== '' && Number(String(valor).replace(',', '.')) > 0 && (
            <div style={dica}>{fmtMoney(Number(String(valor).replace(',', '.')))}</div>
          )}
        </Campo>
        <Campo label="Origem">
          <select value={origem} onChange={e => setOrigem(e.target.value)} style={input}>
            <option value="">— não registrada —</option>
            {ORIGENS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </Campo>
      </Linha>

      <Linha>
        <Campo label="Situação *">
          <select value={situacao} onChange={e => setSituacao(e.target.value)} style={input}>
            {SITUACOES.map(s => <option key={s.v} value={s.v}>{s.label}</option>)}
          </select>
        </Campo>
        {situacao === 'aberta' && (
          <Campo label="Etapa *">
            <select value={etapa} onChange={e => setEtapa(e.target.value)} style={input}>
              <option value="">— escolha —</option>
              {ETAPAS.map(e2 => <option key={e2} value={e2}>{e2}</option>)}
            </select>
            <div style={dica}>Onde a negociação está. Ganha ou perdida, ela sai do funil.</div>
          </Campo>
        )}
      </Linha>

      {situacao === 'perdida' && (
        <Linha>
          <Campo label="Por que foi perdida *" flex="1 1 100%">
            <input
              value={motivoPerda}
              onChange={e => setMotivoPerda(e.target.value)}
              placeholder="Preço, prazo, escopo, concorrente, sem resposta…"
              style={input}
            />
            <div style={dica}>
              É daqui que o funil ensina alguma coisa. Perda sem motivo não ensina nada.
            </div>
          </Campo>
        </Linha>
      )}

      <Linha>
        <Campo label="O que está sendo negociado" flex="1 1 100%">
          <input
            value={descricao}
            onChange={e => setDescricao(e.target.value)}
            placeholder="Ex.: mapeamento de processos comerciais"
            style={input}
          />
        </Campo>
      </Linha>
    </Modal>
  )
}

function Linha({ children }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>{children}</div>
}
function Campo({ label, children, flex = '1 1 180px' }) {
  return (
    <div style={{ flex, minWidth: 0 }}>
      <div style={rotulo}>{label}</div>
      {children}
    </div>
  )
}

const rotulo = {
  fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase',
  color: 'var(--text-mid)', marginBottom: 6, fontFamily: 'var(--body)',
}
const input = {
  width: '100%', padding: '9px 12px', border: '1.5px solid var(--cream-dark)',
  borderRadius: 6, fontFamily: 'var(--body)', fontSize: 13, color: 'var(--navy)',
  background: 'var(--white)', outline: 'none', boxSizing: 'border-box',
}
const dica = { fontSize: 10.5, color: 'var(--text-mid)', marginTop: 4, lineHeight: 1.45 }
const btnPrimario = {
  padding: '9px 18px', borderRadius: 6, border: 'none', background: 'var(--gold-dark)',
  color: '#fff', fontFamily: 'var(--body)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
}
const btnGhost = {
  padding: '9px 16px', borderRadius: 6, border: '1px solid var(--cream-dark)',
  background: 'var(--white)', color: 'var(--navy)', fontFamily: 'var(--body)',
  fontSize: 13, cursor: 'pointer',
}
const btnMini = {
  padding: '0 11px', borderRadius: 6, border: '1px solid var(--cream-dark)',
  background: 'var(--white)', color: 'var(--navy)', fontFamily: 'var(--body)',
  fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
}
