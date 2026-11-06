import { useEffect, useMemo, useState } from 'react'
import Modal from '../../components/Modal'
import { showToast } from '../../components/Toast'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { proximoCodigoPessoa } from '../../lib/codigos'
import { maskDocumento as maskDoc, maskTelefone, maskCEP } from '../../lib/mascaras'

// =============================================================================
// MODAL PESSOA — replica savePessoa() do legado (linha 5738).
// Suporta Cliente, Fornecedor, Funcionário, Órgão Público.
// Cliente tem 2 seções extras: CRM (etapa funil + origem) e Contato Principal
// & Branding — esses campos são propagados via webhook clientes-webhook ao
// salvar (configuração de banco, não precisa nada no front).
// =============================================================================

const STATUSES = ['Ativo', 'Prospect', 'Inativo']
const ETAPAS_FUNIL = ['Sondagem', 'Proposta', 'Fechado', 'Perdido']
const ORIGENS = ['Indicação', 'LinkedIn', 'Site', 'Evento', 'Outro']
const PORTES = [
  { v: '', l: 'Não informado' },
  { v: 'MEI', l: 'MEI' },
  { v: 'ME', l: 'Micro Empresa' },
  { v: 'EPP', l: 'Pequeno Porte' },
  { v: 'Médio', l: 'Médio Porte' },
  { v: 'Grande', l: 'Grande Porte' },
]

// maskDocumento agora vem de '../../lib/mascaras' como maskDoc

/** Data em pt-BR a partir de 'YYYY-MM-DD' ou de um timestamp do banco. */
function fmtData(v) {
  const iso = String(v || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '—'
  const [a, m, d] = iso.split('-')
  return `${d}/${m}/${a}`
}

export default function ModalPessoa({ open, onClose, tipo, registro, onSaved }) {
  const { user } = useAuth()
  const isEdit = !!registro

  // Tipo da pessoa — em projetos onde a tela é dedicada (ex: /clientes), prop tipo
  // chega fixa; deixamos o usuário trocar mesmo assim porque o cadastro pode mudar
  // de natureza (Prospect → Cliente etc.)
  const [pessoaTipo, setPessoaTipo] = useState(tipo || 'Fornecedor')
  const [statusV, setStatusV] = useState('Ativo')
  // PJ · PF · EX. "EX" e a natureza ESTRANGEIRA: empresa ou pessoa de fora do
  // Brasil nao tem CNPJ, nem situacao cadastral, nem CNAE, nem porte, nem
  // Simples — sao todos campos da Receita. Em troca precisa de pais e moeda.
  // E como o SPED trata (Registro 0150: documento vazio + codigo de pais).
  const [pjpf, setPjpf] = useState('PJ')
  const [pais, setPais] = useState('')
  const [moeda, setMoeda] = useState('USD')
  const [doc, setDoc] = useState('')
  const [nome, setNome] = useState('')
  const [fantasia, setFantasia] = useState('')
  const [segmento, setSegmento] = useState('')
  const [porte, setPorte] = useState('')
  const [situacao, setSituacao] = useState('')
  const [email, setEmail] = useState('')
  const [telefone, setTelefone] = useState('')
  const [contato, setContato] = useState('') // contato pra não-Cliente
  // Endereço
  const [logradouro, setLogradouro] = useState('')
  const [bairro, setBairro] = useState('')
  const [cidade, setCidade] = useState('')
  const [uf, setUf] = useState('')
  const [cep, setCep] = useState('')
  // Bancário
  const [banco, setBanco] = useState('')
  const [agencia, setAgencia] = useState('')
  const [conta, setConta] = useState('')
  // Observações
  const [notes, setNotes] = useState('')
  // CRM (Cliente)
  const [etapaFunil, setEtapaFunil] = useState('Sondagem')
  const [origem, setOrigem] = useState('')
  // Contato principal (Cliente)
  const [contatoNome, setContatoNome] = useState('')
  const [contatoCargo, setContatoCargo] = useState('')
  const [contatoEmail, setContatoEmail] = useState('')
  const [contatoTel, setContatoTel] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
  const [retemIss, setRetemIss] = useState(false) // cliente retém ISS na fonte quando você emite NF

  // Quando a Receita foi consultada pela ultima vez. Diferente de updated_at,
  // que e quando o cadastro foi SALVO: da para salvar sem revalidar.
  const [validadoEm, setValidadoEm] = useState('')
  const [buscandoCnpj, setBuscandoCnpj] = useState(false)
  const [lookupMsg, setLookupMsg] = useState(null)
  const [saving, setSaving] = useState(false)
  const isCliente = pessoaTipo === 'Cliente'
  const isEstrangeiro = pjpf === 'EX'

  // ── Hidratação ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    setLookupMsg(null)
    if (isEdit && registro) {
      const d = registro.data || {}
      setPessoaTipo(d.tipo || tipo || 'Fornecedor')
      setStatusV(d.status || 'Ativo')
      setPjpf(d.pjpf || 'PJ')
      setPais(d.pais || '')
      setMoeda(d.moeda_padrao || 'USD')
      setDoc(d.doc || '')
      setNome(d.nome || '')
      setFantasia(d.fantasia || '')
      setSegmento(d.segmento || '')
      setPorte(d.porte || '')
      setSituacao(d.situacao || '')
      setEmail(d.email || '')
      setTelefone(d.telefone || '')
      setContato(d.tipo === 'Cliente' ? '' : (d.contato_nome || ''))
      setLogradouro(d.logradouro || '')
      setBairro(d.bairro || '')
      setCidade(d.cidade || '')
      setUf(d.uf || '')
      setCep(d.cep || '')
      setBanco(d.banco || '')
      setAgencia(d.agencia || '')
      setConta(d.conta || '')
      setNotes(d.notes || '')
      setEtapaFunil(d.etapa_funil || 'Sondagem')
      setOrigem(d.origin || '')
      setContatoNome(d.tipo === 'Cliente' ? (d.contato_nome || '') : '')
      setContatoCargo(d.contato_cargo || '')
      setContatoEmail(d.contato_email || '')
      setContatoTel(d.contato_telefone || '')
      setLogoUrl(d.logo_url || '')
      setRetemIss(d.retem_iss === true)
      setValidadoEm(d.validado_em || '')
    } else {
      setPessoaTipo(tipo || 'Fornecedor'); setStatusV('Ativo'); setPjpf('PJ')
      setPais(''); setMoeda('USD')
      setDoc(''); setNome(''); setFantasia(''); setSegmento(''); setPorte(''); setSituacao('')
      setEmail(''); setTelefone(''); setContato('')
      setLogradouro(''); setBairro(''); setCidade(''); setUf(''); setCep('')
      setBanco(''); setAgencia(''); setConta(''); setNotes('')
      setEtapaFunil('Sondagem'); setOrigem('')
      setContatoNome(''); setContatoCargo(''); setContatoEmail(''); setContatoTel(''); setLogoUrl(''); setRetemIss(false)
      setValidadoEm('')
    }
  }, [open, isEdit, registro, tipo])

  // ── Buscar CNPJ na Receita (BrasilAPI) ───────────────────────────────
  async function buscarCNPJ() {
    if (isEstrangeiro) {
      setLookupMsg({ kind: 'info', text: 'Empresa ou pessoa de fora do Brasil não tem CNPJ na Receita.' })
      return
    }
    const raw = doc.replace(/\D/g, '')
    if (raw.length !== 14 && raw.length !== 11) {
      setLookupMsg({ kind: 'err', text: 'Informe um CNPJ (14 dígitos) ou CPF (11 dígitos).' })
      return
    }
    if (raw.length === 11) {
      setPjpf('PF')
      setLookupMsg({ kind: 'info', text: 'CPF informado — preenchimento automático não disponível para pessoa física.' })
      return
    }
    setBuscandoCnpj(true)
    setLookupMsg({ kind: 'load', text: 'Consultando Receita Federal…' })
    try {
      // Duas falhas diferentes, que a tela confundia numa só:
      //  404 = a Receita respondeu, e o CNPJ não existe lá;
      //  fetch que nem sai = a consulta não aconteceu — e aí o sistema NÃO
      //  SABE se o CNPJ é válido, em vez de saber que não é.
      // Foi assim que a política de segurança do próprio site, ao bloquear o
      // endereço, fez a tela acusar o número do usuário por meses.
      let res
      try {
        res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${raw}`)
      } catch {
        throw new Error('consulta_nao_saiu')
      }
      if (res.status === 404) throw new Error('CNPJ não encontrado')
      if (!res.ok) throw new Error('consulta_falhou')
      const d = await res.json()
      setNome(d.razao_social || '')
      setFantasia(d.nome_fantasia || '')
      setSituacao(d.descricao_situacao_cadastral || '')
      setLogradouro(`${d.logradouro || ''} ${d.numero || ''}`.trim())
      setBairro(d.bairro || '')
      setCidade(d.municipio || '')
      setUf(d.uf || '')
      setCep(d.cep ? String(d.cep).replace(/^(\d{5})(\d{3})$/, '$1-$2') : '')
      setTelefone(d.ddd_telefone_1 ? `(${d.ddd_telefone_1.substring(0, 2)}) ${d.ddd_telefone_1.substring(2)}` : '')
      setPjpf('PJ')
      const porteRaw = (d.porte || '').toUpperCase()
      if (porteRaw.includes('MEI')) setPorte('MEI')
      else if (porteRaw.includes('MICRO')) setPorte('ME')
      else if (porteRaw.includes('PEQUENO') || porteRaw.includes('EPP')) setPorte('EPP')
      else if (porteRaw.includes('GRANDE')) setPorte('Grande')
      else if (porteRaw.includes('M')) setPorte('Médio')
      if (d.cnae_fiscal_descricao) setSegmento(String(d.cnae_fiscal_descricao).substring(0, 60))
      // A data da consulta e dado do SISTEMA e vai em campo proprio. Escrever
      // isso dentro de "Observacoes" misturaria com o texto dela — e ela pode
      // apagar sem querer o unico registro de quando o cadastro foi conferido.
      setValidadoEm(new Date().toISOString().slice(0, 10))
      const isAtiva = (d.descricao_situacao_cadastral || '').toLowerCase().includes('ativa')
      setLookupMsg({
        kind: isAtiva ? 'ok' : 'warn',
        text: `Dados preenchidos · Situação: ${d.descricao_situacao_cadastral || '—'}${isAtiva ? '' : ' ⚠'}`,
      })
    } catch (e) {
      setLookupMsg({
        kind: 'err',
        text: e?.message === 'CNPJ não encontrado'
          ? 'CNPJ não encontrado na Receita Federal.'
          : e?.message === 'consulta_nao_saiu'
            ? 'Não foi possível consultar a Receita. Confira a conexão e tente de novo.'
          : e?.message === 'consulta_falhou'
            ? 'A Receita não respondeu. Tente mais tarde.'
          : 'Erro ao consultar. Verifique o CNPJ e tente novamente.',
      })
    } finally {
      setBuscandoCnpj(false)
    }
  }

  // ── Save ─────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!nome.trim()) { showToast('Informe o nome ou razão social.', 'warning'); return }
    setSaving(true)
    try {
      const data = {
        nome: nome.trim(), tipo: pessoaTipo,
        pjpf, status: statusV,
        // Estrangeiro NAO recebe documento: campo vazio e honesto, numero
        // inventado e armadilha que depois colide com a chave verdadeira.
        doc: isEstrangeiro ? '' : doc.trim(),
        ...(isEstrangeiro ? { pais: pais.trim(), moeda_padrao: moeda } : {}),
        fantasia: fantasia.trim(), segmento: segmento.trim(),
        porte, situacao: situacao.trim(),
        email: email.trim(), telefone: telefone.trim(),
        contato_nome: isCliente ? contatoNome.trim() : contato.trim(),
        logradouro: logradouro.trim(), bairro: bairro.trim(),
        cidade: cidade.trim(), uf: uf.trim(), cep: cep.trim(),
        banco: banco.trim(), agencia: agencia.trim(), conta: conta.trim(),
        notes: notes.trim(),
        validado_em: validadoEm || null,
      }
      if (isCliente) {
        data.etapa_funil = etapaFunil || 'Sondagem'
        data.origin = origem || ''
        data.contato_cargo = contatoCargo.trim()
        data.contato_telefone = contatoTel.trim()
        data.contato_email = contatoEmail.trim()
        data.logo_url = logoUrl.trim()
        data.retem_iss = retemIss
      }

      const docLimpo = data.doc.replace(/\D/g, '')

      // Dedup
      const { data: existentes } = await supabase
        .from('pessoas')
        .select('id,codigo,data')
      const dup = (existentes || []).find(p => {
        if (isEdit && p.id === registro.id) return false
        const pDoc = (p.data?.doc || '').replace(/\D/g, '')
        const sameDoc = docLimpo && pDoc && docLimpo === pDoc
        const sameName = (p.data?.nome || '').trim().toLowerCase() === data.nome.toLowerCase()
        return sameDoc || sameName
      })
      if (dup) {
        showToast(`Já existe cadastro "${dup.data?.nome}" (${dup.data?.tipo}).`, 'warning')
        setSaving(false)
        return
      }

      if (isEdit) {
        const merged = { ...(registro.data || {}), ...data }
        const { error } = await supabase.from('pessoas').update({ data: merged }).eq('id', registro.id)
        if (error) throw error
        showToast('Cadastro atualizado.', 'success')
      } else {
        if (!user) { showToast('Sessão expirada.', 'error'); return }
        const codigo = await proximoCodigoPessoa()
        const payload = {
          user_id: user.id, codigo,
          data: { ...data, created: new Date().toISOString().slice(0, 10) },
        }
        const { error } = await supabase.from('pessoas').insert(payload)
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

  const lookupColor = useMemo(() => ({
    err: 'var(--red)', warn: 'var(--orange)', ok: 'var(--green)',
    info: 'var(--text-mid)', load: 'var(--gold)',
  })[lookupMsg?.kind || 'info'], [lookupMsg])

  const title = isEdit
    ? `Editar Cadastro${registro.codigo ? ` · ${registro.codigo}` : ''}`
    : `Novo ${pessoaTipo}`

  return (
    <Modal
      open={open}
      onClose={saving ? () => {} : onClose}
      title={title}
      width={860}
      footer={
        <>
          <button type="button" onClick={onClose} style={btnGhost} disabled={saving}>Cancelar</button>
          <button type="button" onClick={handleSave} style={btnPrimary} disabled={saving}>
            {saving ? 'Salvando…' : 'Salvar Cadastro'}
          </button>
        </>
      }
    >
      {/* Lookup CNPJ/CPF */}
      <div style={lookupBox}>
        <div style={sectionLabel}>🔍 Busca Automática por CNPJ ou CPF</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <Field label="CNPJ / CPF" style={{ flex: 1 }}>
            <input
              value={doc}
              onChange={e => setDoc(maskDoc(e.target.value))}
              placeholder="00.000.000/0001-00 ou 000.000.000-00"
              maxLength={18} style={input}
            />
          </Field>
          <button type="button" onClick={buscarCNPJ} disabled={buscandoCnpj} style={btnNavy}>
            {buscandoCnpj ? '⏳ Buscando…' : '🔎 Buscar na Receita'}
          </button>
        </div>
        {lookupMsg && (
          <div style={{ fontSize: 11, marginTop: 8, color: lookupColor, minHeight: 16 }}>{lookupMsg.text}</div>
        )}
        {/* As duas datas que o cadastro ja tinha e nao mostrava: quando a
            Receita foi consultada e quando o registro foi salvo. Sao coisas
            diferentes — da para salvar sem revalidar. */}
        {(validadoEm || registro?.updated_at) && (
          <div style={{ fontSize: 11, marginTop: 4, color: 'var(--text-mid)' }}>
            {validadoEm && <>Validado na Receita em <strong>{fmtData(validadoEm)}</strong></>}
            {validadoEm && registro?.updated_at && ' · '}
            {registro?.updated_at && <>Cadastro salvo em <strong>{fmtData(registro.updated_at)}</strong></>}
          </div>
        )}
      </div>

      <Row cols={3}>
        <Field label="Tipo *">
          <select value={pessoaTipo} onChange={e => setPessoaTipo(e.target.value)} style={input}>
            <option value="Fornecedor">Fornecedor</option>
            {/* Era "Cliente / Prospect". Prospect NAO e papel: e pessoa com
                proposta em aberto e sem o papel de Cliente. Quem ja registra
                isso e o campo Status, ao lado. Juntar os dois no mesmo rotulo
                fazia a tela dizer uma coisa que o modelo nao sustenta. */}
            <option value="Cliente">Cliente</option>
            <option value="Funcionário">Funcionário</option>
            <option value="Órgão Público">Órgão Público</option>
          </select>
        </Field>
        <Field label="Status">
          <select value={statusV} onChange={e => setStatusV(e.target.value)} style={input}>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Tipo de cadastro">
          <select value={pjpf} onChange={e => setPjpf(e.target.value)} style={input}>
            <option value="PJ">Pessoa Jurídica (PJ)</option>
            <option value="PF">Pessoa Física (PF)</option>
            <option value="EX">Estrangeiro</option>
          </select>
        </Field>
      </Row>

      {isEstrangeiro && (
        <Row cols={2}>
          <Field label="País *">
            <input value={pais} onChange={e => setPais(e.target.value)} placeholder="Ex.: Estados Unidos" style={input} />
          </Field>
          <Field label="Moeda padrão">
            <select value={moeda} onChange={e => setMoeda(e.target.value)} style={input}>
              <option value="USD">Dólar (USD)</option>
              <option value="EUR">Euro (EUR)</option>
              <option value="GBP">Libra (GBP)</option>
              <option value="BRL">Real (BRL)</option>
            </select>
          </Field>
        </Row>
      )}

      {/* CRM — só Cliente */}
      {isCliente && (
        <div style={crmBox}>
          <Row cols={2} gap={10}>
            <Field label="Etapa do Funil">
              <select value={etapaFunil} onChange={e => setEtapaFunil(e.target.value)} style={input}>
                {ETAPAS_FUNIL.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </Field>
            <Field label="Origem do Contato">
              <select value={origem} onChange={e => setOrigem(e.target.value)} style={input}>
                <option value="">— selecione —</option>
                {ORIGENS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </Field>
          </Row>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, color: 'var(--navy)', fontWeight: 600, marginTop: 10 }}>
            <input type="checkbox" checked={retemIss} onChange={e => setRetemIss(e.target.checked)} style={{ width: 15, height: 15, accentColor: 'var(--gold)' }} />
            Este cliente retém ISS na fonte (ao emitir NF pra ele, já vem marcado)
          </label>
        </div>
      )}

      {/* Dados principais */}
      <Row cols={2}>
        <Field label="Nome / Razão Social *">
          <input value={nome} onChange={e => setNome(e.target.value)} style={input} />
        </Field>
        <Field label="Nome Fantasia">
          <input value={fantasia} onChange={e => setFantasia(e.target.value)} style={input} />
        </Field>
      </Row>
      <Row cols={3}>
        <Field label="Segmento / Cargo">
          <input value={segmento} onChange={e => setSegmento(e.target.value)} placeholder="Ex: TI, Contabilidade" style={input} />
        </Field>
        <Field label="Porte">
          <select value={porte} onChange={e => setPorte(e.target.value)} style={input}>
            {PORTES.map(p => <option key={p.v} value={p.v}>{p.l}</option>)}
          </select>
        </Field>
        <Field label="Situação Cadastral">
          <input value={situacao} readOnly style={{ ...input, background: '#f8f8f8', color: 'var(--text-mid)' }} />
        </Field>
      </Row>

      <Divider label="Contato" />
      <Row cols={isCliente ? 2 : 3}>
        <Field label="E-mail">
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} style={input} />
        </Field>
        <Field label="Telefone">
          <input value={telefone} onChange={e => setTelefone(maskTelefone(e.target.value))} placeholder="(00) 00000-0000" style={input} />
        </Field>
        {!isCliente && (
          <Field label="Responsável / Contato">
            <input value={contato} onChange={e => setContato(e.target.value)} style={input} />
          </Field>
        )}
      </Row>

      {/* Cliente extras */}
      {isCliente && (
        <div style={crmBox}>
          <div style={sectionLabel}>Contato Principal &amp; Branding (Cliente)</div>
          <Row cols={2} gap={10}>
            <Field label="Nome do contato">
              <input value={contatoNome} onChange={e => setContatoNome(e.target.value)} style={input} />
            </Field>
            <Field label="Cargo do contato">
              <input value={contatoCargo} onChange={e => setContatoCargo(e.target.value)} style={input} />
            </Field>
          </Row>
          <Row cols={2} gap={10}>
            <Field label="E-mail do contato">
              <input type="email" value={contatoEmail} onChange={e => setContatoEmail(e.target.value)} style={input} />
            </Field>
            <Field label="Telefone direto do contato">
              <input value={contatoTel} onChange={e => setContatoTel(maskTelefone(e.target.value))} placeholder="(00) 00000-0000" style={input} />
            </Field>
          </Row>
          <Row>
            <Field label="URL do logotipo">
              <input type="url" value={logoUrl} onChange={e => setLogoUrl(e.target.value)} placeholder="https://...logo.png" style={input} />
            </Field>
          </Row>
          <div style={infoNote}>Ao salvar, estes campos são enviados ao Polímata CI.</div>
        </div>
      )}

      <Divider label="Endereço" />
      <Row cols={2}>
        <Field label="Logradouro"><input value={logradouro} onChange={e => setLogradouro(e.target.value)} style={input} /></Field>
        <Field label="Bairro"><input value={bairro} onChange={e => setBairro(e.target.value)} style={input} /></Field>
      </Row>
      <Row cols={3}>
        <Field label="Cidade"><input value={cidade} onChange={e => setCidade(e.target.value)} style={input} /></Field>
        <Field label="UF"><input value={uf} onChange={e => setUf(e.target.value.toUpperCase())} maxLength={2} style={input} /></Field>
        <Field label="CEP"><input value={cep} onChange={e => setCep(maskCEP(e.target.value))} placeholder="00000-000" maxLength={9} style={input} /></Field>
      </Row>

      <Divider label="Dados Bancários (opcional)" />
      <Row cols={3}>
        <Field label="Banco"><input value={banco} onChange={e => setBanco(e.target.value)} style={input} /></Field>
        <Field label="Agência"><input value={agencia} onChange={e => setAgencia(e.target.value)} style={input} /></Field>
        <Field label="Conta"><input value={conta} onChange={e => setConta(e.target.value)} style={input} /></Field>
      </Row>

      <Row>
        <Field label="Observações">
          <textarea value={notes} onChange={e => setNotes(e.target.value)} style={{ ...input, minHeight: 70, resize: 'vertical' }} />
        </Field>
      </Row>
    </Modal>
  )
}

function Field({ label, children, style }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', ...style }}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  )
}
function Row({ children, cols = 1, gap = 14, mt }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
      gap, marginTop: mt, marginBottom: 14,
    }}>{children}</div>
  )
}
function Divider({ label }) {
  return (
    <div style={{ margin: '8px 0 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={sectionLabel}>{label}</span>
      <span style={{ flex: 1, height: 1, background: 'var(--cream-dark)' }} />
    </div>
  )
}

const labelStyle = { fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-mid)', marginBottom: 6, fontFamily: 'var(--body)' }
const input = { width: '100%', padding: '9px 12px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 13, color: 'var(--navy)', background: 'var(--white)', outline: 'none', boxSizing: 'border-box' }
const lookupBox = { background: 'var(--cream)', borderRadius: 8, padding: 16, marginBottom: 18, borderLeft: '3px solid var(--gold)' }
const sectionLabel = { fontSize: 9, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--navy)', fontFamily: 'var(--body)' }
const crmBox = { background: 'rgba(204,145,94,0.08)', borderLeft: '3px solid var(--gold)', padding: 14, borderRadius: 6, marginBottom: 14 }
const infoNote = { fontSize: 10, color: 'var(--text-mid)', marginTop: 6, fontStyle: 'italic' }
const btnGhost = { padding: '10px 18px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, background: 'var(--white)', color: 'var(--navy)', fontFamily: 'var(--body)', fontSize: 12, fontWeight: 600, cursor: 'pointer', letterSpacing: 0.5 }
const btnPrimary = { padding: '10px 18px', border: 'none', borderRadius: 6, background: 'var(--gold)', color: '#fff', fontFamily: 'var(--body)', fontSize: 12, fontWeight: 700, cursor: 'pointer', letterSpacing: 0.5 }
const btnNavy = { padding: '9px 14px', border: 'none', borderRadius: 6, background: 'var(--navy)', color: '#fff', fontFamily: 'var(--body)', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }
