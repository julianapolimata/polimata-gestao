import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'
import { showToast } from '../../components/Toast'
import { proximoCodigoEmprestimo } from '../../lib/codigos'


// ============================================================================
// MODAL EMPRÉSTIMO / FINANCIAMENTO / PARCELAMENTO FISCAL
//
// Fluxo: usuário sobe PDF → Claude extrai cabeçalho + tabela de parcelas →
// usuário revisa e ajusta → save cria registro + N parcelas em payable.
// ============================================================================

const TIPOS = [
  { value: 'emprestimo', label: 'Empréstimo bancário' },
  { value: 'financiamento', label: 'Financiamento' },
  { value: 'parcelamento_fiscal', label: 'Parcelamento fiscal (RFB/PGFN)' },
]

const STATUS_OPTS = [
  { value: 'ativa', label: 'Ativa' },
  { value: 'quitada', label: 'Quitada' },
  { value: 'em_atraso', label: 'Em atraso' },
]


export default function ModalEmprestimo({ open, onClose, registro, onSaved }) {
  const { user } = useAuth()
  const isEdit = !!registro
  const fileInputRef = useRef(null)

  const [extraindo, setExtraindo] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [contas, setContas] = useState([])
  const [cartoes, setCartoes] = useState([])

  // Cabeçalho
  const [nome, setNome] = useState('')
  const [tipo, setTipo] = useState('emprestimo')
  const [credor, setCredor] = useState('')
  const [numeroContrato, setNumeroContrato] = useState('')
  const [modalidade, setModalidade] = useState('')
  const [valorOriginal, setValorOriginal] = useState('')
  const [saldoAtual, setSaldoAtual] = useState('')
  const [parcelasTotal, setParcelasTotal] = useState('')
  const [parcelasPagas, setParcelasPagas] = useState('0')
  const [dataInicio, setDataInicio] = useState('')
  const [dataVencimentoFinal, setDataVencimentoFinal] = useState('')
  const [taxaJurosMensal, setTaxaJurosMensal] = useState('')
  const [indicadorCalculo, setIndicadorCalculo] = useState('price')
  const [contaDebitoTipo, setContaDebitoTipo] = useState('') // conta | cartao | ''
  const [contaDebitoId, setContaDebitoId] = useState('')
  const [status, setStatus] = useState('ativa')
  const [observacoes, setObservacoes] = useState('')
  const [anexoFile, setAnexoFile] = useState(null)

  // Entrada (captação) — o dinheiro que cai na conta ao contratar.
  const [registrarEntrada, setRegistrarEntrada] = useState(true)
  const [valorLiberado, setValorLiberado] = useState('')
  const [dataLiberacao, setDataLiberacao] = useState('')
  const [contaCreditoId, setContaCreditoId] = useState('')

  // Tabela de parcelas — array de { numero, vencimento, valor, amortizacao, juros, pago }
  const [parcelas, setParcelas] = useState([])

  useEffect(() => {
    if (!open) return
    if (registro) {
      const d = registro.data || registro
      setNome(d.nome || '')
      setTipo(d.tipo || 'emprestimo')
      setCredor(d.credor || '')
      setNumeroContrato(d.numero_contrato || '')
      setModalidade(d.modalidade || '')
      setValorOriginal(d.valor_original || '')
      setSaldoAtual(d.saldo_atual || '')
      setParcelasTotal(d.parcelas_total || '')
      setParcelasPagas(d.parcelas_pagas || '0')
      setDataInicio(d.data_inicio || '')
      setDataVencimentoFinal(d.data_vencimento_final || '')
      setTaxaJurosMensal(d.taxa_juros_mensal || '')
      setIndicadorCalculo(d.indicador_calculo || 'price')
      setContaDebitoTipo(d.conta_debito_tipo || '')
      setContaDebitoId(d.conta_debito_id || '')
      setStatus(d.status || 'ativa')
      setObservacoes(d.observacoes || '')
      setParcelas(d.parcelas || [])
      setRegistrarEntrada(false); setValorLiberado(''); setDataLiberacao(''); setContaCreditoId('')
    } else {
      setNome(''); setTipo('emprestimo'); setCredor(''); setNumeroContrato('')
      setModalidade(''); setValorOriginal(''); setSaldoAtual('')
      setParcelasTotal(''); setParcelasPagas('0'); setDataInicio('')
      setDataVencimentoFinal(''); setTaxaJurosMensal(''); setIndicadorCalculo('price')
      setContaDebitoTipo(''); setContaDebitoId(''); setStatus('ativa')
      setObservacoes(''); setAnexoFile(null); setParcelas([])
      setRegistrarEntrada(true); setValorLiberado(''); setDataLiberacao(''); setContaCreditoId('')
    }
    Promise.all([
      supabase.from('contas_bancarias').select('*'),
      supabase.from('cartoes').select('*'),
    ]).then(([rC, rCart]) => {
      setContas((rC.data || []).filter(c => c.data?.ativo !== false))
      setCartoes((rCart.data || []).filter(c => c.data?.ativo !== false))
    })
  }, [open, registro])

  // ── Extração via Claude ────────────────────────────────────────────────
  async function handlePDF(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setAnexoFile(file)
    if (!file.type.includes('pdf') && !file.name.toLowerCase().endsWith('.pdf')) {
      showToast('Esperado PDF.', 'warning'); return
    }
    setExtraindo(true)
    try {
      // Lê PDF como base64
      const buf = await file.arrayBuffer()
      const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)))

      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Sessão expirada')

      const resp = await fetch('/api/anthropic', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 4000,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'document',
                source: { type: 'base64', media_type: 'application/pdf', data: b64 },
              },
              {
                type: 'text',
                text: `Você é um assistente que extrai dados estruturados de PDFs de empréstimos, financiamentos ou parcelamentos fiscais brasileiros.

Extraia os seguintes campos e responda APENAS com JSON válido (sem markdown, sem texto explicativo):

{
  "tipo": "emprestimo" | "financiamento" | "parcelamento_fiscal",
  "nome": "nome curto descritivo (ex: 'Empréstimo Sicoob Capital de Giro', 'Parcelamento Simples Nacional')",
  "credor": "nome do banco/órgão (ex: 'Sicoob - Coop Rio Claro Centro', 'Receita Federal do Brasil')",
  "numero_contrato": "número do contrato/parcelamento",
  "modalidade": "modalidade ou descrição (ex: 'Capital de Giro', 'Parcelamento Simplificado RFB')",
  "valor_original": número (valor total contratado/parcelado),
  "saldo_atual": número (saldo devedor atual, ou igual ao valor_original se não informado),
  "parcelas_total": número (qtd total de parcelas),
  "parcelas_pagas": número (parcelas já pagas, 0 se não informado),
  "data_inicio": "YYYY-MM-DD" (data da operação/adesão),
  "data_vencimento_final": "YYYY-MM-DD" (vencimento da última parcela),
  "taxa_juros_mensal": número (% ao mês, ex: 3.04. null se não informado),
  "indicador_calculo": "price" | "sac" | "fixo" (default 'fixo' se não tem amortização variável),
  "parcelas": [
    {
      "numero": número,
      "vencimento": "YYYY-MM-DD",
      "valor": número,
      "amortizacao": número (0 se não informado),
      "juros": número (0 se não informado),
      "pago": true/false
    }
  ]
}

Importante:
- Datas SEMPRE no formato ISO YYYY-MM-DD
- Valores numéricos sem R$, sem separador de milhar, com . como decimal
- Liste TODAS as parcelas listadas no PDF
- Se uma parcela tiver "DEBITO AUTOMATICO" no histórico ou data de pagamento preenchida, marque pago=true
- Se for parcelamento fiscal sem cronograma de parcelas listado, gere as N parcelas mensais a partir da primeira parcela conhecida.`,
              },
            ],
          }],
        }),
      })

      if (!resp.ok) {
        const errTxt = await resp.text()
        throw new Error(`Claude API ${resp.status}: ${errTxt.slice(0, 200)}`)
      }
      const data = await resp.json()
      const texto = data?.content?.[0]?.text || ''
      // Extrai JSON da resposta (pode vir cercado de markdown ou texto)
      const m = texto.match(/\{[\s\S]*\}/)
      if (!m) throw new Error('Claude não retornou JSON válido')
      const extraido = JSON.parse(m[0])

      // Preenche os campos
      setTipo(extraido.tipo || 'emprestimo')
      setNome(extraido.nome || '')
      setCredor(extraido.credor || '')
      setNumeroContrato(extraido.numero_contrato || '')
      setModalidade(extraido.modalidade || '')
      setValorOriginal(String(extraido.valor_original ?? ''))
      setSaldoAtual(String(extraido.saldo_atual ?? extraido.valor_original ?? ''))
      setParcelasTotal(String(extraido.parcelas_total ?? ''))
      setParcelasPagas(String(extraido.parcelas_pagas ?? 0))
      setDataInicio(extraido.data_inicio || '')
      setDataVencimentoFinal(extraido.data_vencimento_final || '')
      setTaxaJurosMensal(extraido.taxa_juros_mensal != null ? String(extraido.taxa_juros_mensal) : '')
      setIndicadorCalculo(extraido.indicador_calculo || 'price')
      setParcelas(extraido.parcelas || [])
      showToast(`✓ ${extraido.parcelas?.length || 0} parcelas extraídas.`, 'success')
    } catch (err) {
      console.error(err)
      showToast('Erro ao extrair: ' + err.message, 'error')
    } finally {
      setExtraindo(false)
    }
  }

  function atualizarParcela(idx, campo, valor) {
    setParcelas(p => p.map((x, i) => i === idx ? { ...x, [campo]: valor } : x))
  }

  // ── Salvar ─────────────────────────────────────────────────────────────
  async function salvar() {
    if (!nome.trim()) { showToast('Nome é obrigatório.', 'warning'); return }
    if (!parcelasTotal) { showToast('Quantidade de parcelas é obrigatória.', 'warning'); return }
    setSalvando(true)
    try {
      let anexoPath = registro?.anexo_path || null
      if (anexoFile) {
        // const ext = anexoFile.name.split('.').pop()
        const path = `${user.id}/emprestimos/${Date.now()}_${anexoFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
        const { error: upErr } = await supabase.storage.from('anexos-fiscais').upload(path, anexoFile, { upsert: false })
        if (upErr) console.warn('Erro upload anexo:', upErr.message)
        else anexoPath = path
      }

      const dataPayload = {
        nome: nome.trim(),
        tipo,
        credor: credor.trim(),
        numero_contrato: numeroContrato.trim(),
        modalidade: modalidade.trim(),
        valor_original: Number(valorOriginal) || 0,
        saldo_atual: Number(saldoAtual) || 0,
        parcelas_total: Number(parcelasTotal) || 0,
        parcelas_pagas: Number(parcelasPagas) || 0,
        data_inicio: dataInicio || null,
        data_vencimento_final: dataVencimentoFinal || null,
        taxa_juros_mensal: taxaJurosMensal ? Number(taxaJurosMensal) : null,
        indicador_calculo: indicadorCalculo,
        conta_debito_tipo: contaDebitoTipo || null,
        conta_debito_id: contaDebitoId || null,
        status,
        observacoes: observacoes.trim(),
        parcelas, // congela snapshot da tabela
      }

      if (isEdit) {
        const { error } = await supabase.from('emprestimos_financiamentos').update({
          data: dataPayload, anexo_path: anexoPath,
        }).eq('id', registro.id)
        if (error) throw error
      } else {
        const hoje = new Date().toISOString().slice(0, 10)
        // Entrada (captação): o dinheiro que caiu na conta — recebido, financiamento (fora do DRE).
        const entradaData = registrarEntrada ? {
          client: credor || nome,
          desc: `Captação — ${nome || 'empréstimo'}`,
          value: Number(valorLiberado || valorOriginal) || 0,
          due: dataLiberacao || dataInicio || hoje,
          data_competencia: dataLiberacao || dataInicio || hoje,
          data_pagamento: dataLiberacao || dataInicio || hoje,
          status: 'Recebido',
          cat: 'Empréstimos e Financiamentos',
          subcat: 'Captação de empréstimo (entrada)',
          conta_id: contaCreditoId || null,
          criado_via_emprestimo: true,
          created: hoje,
        } : null

        // Cada parcela vira 2 lançamentos: amortização (principal, fora do DRE) e
        // juros (despesa financeira, no DRE). Sem split disponível → uma linha só,
        // tratada como amortização (não infla o DRE com juros fictícios).
        const parcelasData = []
        for (const p of parcelas) {
          const amort = Number(p.amortizacao) || 0
          const jur = Number(p.juros) || 0
          const base = {
            supplier: credor || nome,
            due: p.vencimento,
            data_competencia: p.vencimento,
            status: p.pago ? 'Pago' : 'Pendente',
            data_pagamento: p.pago ? p.vencimento : null,
            cat: 'Empréstimos e Financiamentos',
            forma_pagamento: 'Débito Automático',
            parcela_atual: Number(p.numero) || 0,
            parcela_total: Number(parcelasTotal) || 0,
            criado_via_emprestimo: true,
            created: hoje,
          }
          if (amort > 0 || jur > 0) {
            if (amort > 0) parcelasData.push({ ...base, desc: `${nome} — parcela ${p.numero}/${parcelasTotal} (amortização)`, value: amort, subcat: 'Amortização do principal (saída)' })
            if (jur > 0) parcelasData.push({ ...base, desc: `${nome} — parcela ${p.numero}/${parcelasTotal} (juros)`, value: jur, subcat: 'Juros de empréstimos' })
          } else {
            parcelasData.push({ ...base, desc: `${nome} — parcela ${p.numero}/${parcelasTotal}`, value: Number(p.valor) || 0, subcat: 'Amortização do principal (saída)' })
          }
        }

        // Empréstimo + entrada + parcelas numa transação atômica (RPC).
        // A RPC devolve o id; geramos o código (EMP-NNN) e gravamos na coluna.
        const codigo = await proximoCodigoEmprestimo()
        const { data: novoId, error } = await supabase.rpc('criar_emprestimo', {
          p_emp: dataPayload, p_anexo_path: anexoPath, p_parcelas: parcelasData, p_entrada: entradaData,
        })
        if (error) throw error
        if (novoId && codigo) {
          await supabase.from('emprestimos_financiamentos').update({ codigo }).eq('id', novoId)
        }
      }
      showToast(isEdit ? 'Atualizado.' : 'Empréstimo criado — entrada no caixa + parcelas (amortização/juros) geradas.', 'success')
      onSaved?.()
      onClose()
    } catch (e) {
      console.error(e)
      showToast('Erro: ' + e.message, 'error')
    } finally {
      setSalvando(false)
    }
  }

  if (!open) return null

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={e => e.stopPropagation()}>
        <div style={header}>
          <h2 style={titulo}>{isEdit ? 'Editar' : 'Novo'} empréstimo/financiamento</h2>
          <button onClick={onClose} style={btnClose}>×</button>
        </div>

        {/* Upload PDF + extração IA */}
        {!isEdit && (
          <div style={uploadBox}>
            <input ref={fileInputRef} type="file" accept=".pdf" onChange={handlePDF} style={{ display: 'none' }} />
            <button onClick={() => fileInputRef.current?.click()} disabled={extraindo} style={btnUpload}>
              {extraindo ? '⏳ Extraindo dados via IA…' : '📄 Importar PDF (sistema extrai os dados)'}
            </button>
            <div style={{ fontSize: 11, color: 'var(--text-mid)', marginTop: 8 }}>
              Empréstimo Sicoob, parcelamento RFB, financiamento — IA lê o PDF e preenche os campos abaixo. Você revisa antes de salvar.
            </div>
          </div>
        )}

        {/* Cabeçalho */}
        <div style={grid}>
          <Field label="Nome">
            <input value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex: Empréstimo Sicoob Capital de Giro" style={input} />
          </Field>
          <Field label="Tipo">
            <select value={tipo} onChange={e => setTipo(e.target.value)} style={input}>
              {TIPOS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="Credor">
            <input value={credor} onChange={e => setCredor(e.target.value)} placeholder="Ex: Sicoob, Receita Federal" style={input} />
          </Field>
          <Field label="Número do contrato">
            <input value={numeroContrato} onChange={e => setNumeroContrato(e.target.value)} style={input} />
          </Field>
          <Field label="Modalidade">
            <input value={modalidade} onChange={e => setModalidade(e.target.value)} placeholder="Ex: Capital de Giro" style={input} />
          </Field>
          <Field label="Status">
            <select value={status} onChange={e => setStatus(e.target.value)} style={input}>
              {STATUS_OPTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </Field>
          <Field label="Valor original (R$)">
            <input type="number" step="0.01" value={valorOriginal} onChange={e => setValorOriginal(e.target.value)} style={input} />
          </Field>
          <Field label="Saldo atual (R$)">
            <input type="number" step="0.01" value={saldoAtual} onChange={e => setSaldoAtual(e.target.value)} style={input} />
          </Field>
          <Field label="Parcelas total">
            <input type="number" value={parcelasTotal} onChange={e => setParcelasTotal(e.target.value)} style={input} />
          </Field>
          <Field label="Parcelas pagas">
            <input type="number" value={parcelasPagas} onChange={e => setParcelasPagas(e.target.value)} style={input} />
          </Field>
          <Field label="Data início">
            <input type="date" value={dataInicio} onChange={e => setDataInicio(e.target.value)} style={input} />
          </Field>
          <Field label="Vencimento final">
            <input type="date" value={dataVencimentoFinal} onChange={e => setDataVencimentoFinal(e.target.value)} style={input} />
          </Field>
          <Field label="Taxa juros mensal (%)">
            <input type="number" step="0.01" value={taxaJurosMensal} onChange={e => setTaxaJurosMensal(e.target.value)} style={input} />
          </Field>
          <Field label="Cálculo">
            <select value={indicadorCalculo} onChange={e => setIndicadorCalculo(e.target.value)} style={input}>
              <option value="price">Tabela Price</option>
              <option value="sac">SAC</option>
              <option value="fixo">Parcelas fixas (parcelamento fiscal)</option>
            </select>
          </Field>
          <Field label="Débito automático em">
            <div style={{ display: 'flex', gap: 6 }}>
              <select value={contaDebitoTipo} onChange={e => { setContaDebitoTipo(e.target.value); setContaDebitoId('') }} style={{ ...input, flex: 1 }}>
                <option value="">— escolher —</option>
                <option value="conta">Conta bancária</option>
                <option value="cartao">Cartão de crédito</option>
              </select>
              {contaDebitoTipo === 'conta' && (
                <select value={contaDebitoId} onChange={e => setContaDebitoId(e.target.value)} style={{ ...input, flex: 2 }}>
                  <option value="">— qual conta —</option>
                  {contas.map(c => <option key={c.id} value={c.id}>{c.data?.nome}</option>)}
                </select>
              )}
              {contaDebitoTipo === 'cartao' && (
                <select value={contaDebitoId} onChange={e => setContaDebitoId(e.target.value)} style={{ ...input, flex: 2 }}>
                  <option value="">— qual cartão —</option>
                  {cartoes.map(c => <option key={c.id} value={c.id}>{c.data?.nome}</option>)}
                </select>
              )}
            </div>
          </Field>
        </div>

        {/* Entrada (captação) — só no cadastro novo */}
        {!isEdit && (
          <div style={entradaBox}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700, color: 'var(--navy)', marginBottom: registrarEntrada ? 12 : 0 }}>
              <input type="checkbox" checked={registrarEntrada} onChange={e => setRegistrarEntrada(e.target.checked)} style={{ width: 15, height: 15, accentColor: 'var(--gold)' }} />
              Registrar a entrada do dinheiro no caixa (captação)
            </label>
            {registrarEntrada && (
              <>
                <div style={grid}>
                  <Field label="Valor liberado (R$)">
                    <input type="number" step="0.01" value={valorLiberado} onChange={e => setValorLiberado(e.target.value)} placeholder={valorOriginal ? String(valorOriginal) : 'igual ao valor original'} style={input} />
                  </Field>
                  <Field label="Data de liberação">
                    <input type="date" value={dataLiberacao} onChange={e => setDataLiberacao(e.target.value)} style={input} />
                  </Field>
                  <Field label="Conta que recebeu">
                    <select value={contaCreditoId} onChange={e => setContaCreditoId(e.target.value)} style={input}>
                      <option value="">— opcional —</option>
                      {contas.map(c => <option key={c.id} value={c.id}>{c.data?.nome}</option>)}
                    </select>
                  </Field>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-mid)' }}>
                  Entra como <strong>recebido</strong> (financiamento): aparece no caixa, mas <strong>não</strong> no DRE — não é receita, é dívida.
                </div>
              </>
            )}
          </div>
        )}

        <Field label="Observações">
          <textarea value={observacoes} onChange={e => setObservacoes(e.target.value)} rows={2} style={{ ...input, resize: 'vertical' }} />
        </Field>

        {/* Tabela de parcelas */}
        {parcelas.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-mid)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
              Tabela de parcelas ({parcelas.length}) — você pode ajustar antes de salvar
            </div>
            <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid var(--cream-dark)', borderRadius: 6 }}>
              <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 11, fontFamily: 'var(--body)' }}>
                <thead>
                  <tr>
                    <th style={thMini}>#</th>
                    <th style={thMini}>Vencimento</th>
                    <th style={{ ...thMini, textAlign: 'right' }}>Parcela</th>
                    <th style={{ ...thMini, textAlign: 'right' }}>Amortização</th>
                    <th style={{ ...thMini, textAlign: 'right' }}>Juros</th>
                    <th style={{ ...thMini, textAlign: 'center' }}>Pago?</th>
                  </tr>
                </thead>
                <tbody>
                  {parcelas.map((p, idx) => (
                    <tr key={idx}>
                      <td style={tdMini}>{p.numero}</td>
                      <td style={tdMini}>
                        <input type="date" value={p.vencimento || ''} onChange={e => atualizarParcela(idx, 'vencimento', e.target.value)} style={inputMini} />
                      </td>
                      <td style={{ ...tdMini, textAlign: 'right' }}>
                        <input type="number" step="0.01" value={p.valor || ''} onChange={e => atualizarParcela(idx, 'valor', e.target.value)} style={{ ...inputMini, textAlign: 'right' }} />
                      </td>
                      <td style={{ ...tdMini, textAlign: 'right' }}>
                        <input type="number" step="0.01" value={p.amortizacao || ''} onChange={e => atualizarParcela(idx, 'amortizacao', e.target.value)} style={{ ...inputMini, textAlign: 'right' }} />
                      </td>
                      <td style={{ ...tdMini, textAlign: 'right' }}>
                        <input type="number" step="0.01" value={p.juros || ''} onChange={e => atualizarParcela(idx, 'juros', e.target.value)} style={{ ...inputMini, textAlign: 'right' }} />
                      </td>
                      <td style={{ ...tdMini, textAlign: 'center' }}>
                        <input type="checkbox" checked={!!p.pago} onChange={e => atualizarParcela(idx, 'pago', e.target.checked)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-mid)' }}>
              {isEdit ? 'Tabela snapshot da dívida. Editar aqui NÃO altera os payable já criados.' : 'Ao salvar: a entrada vira um recebido, e cada parcela vira 2 lançamentos (amortização + juros) em Contas a Pagar.'}
            </div>
          </div>
        )}

        {/* Ações */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={btnSecondary}>Cancelar</button>
          <button onClick={salvar} disabled={salvando || extraindo} style={btnPrimary}>
            {salvando ? 'Salvando…' : (isEdit ? 'Atualizar' : 'Criar + Gerar parcelas')}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-mid)' }}>{label}</label>
      {children}
    </div>
  )
}

const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,32,62,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }
const modal = { background: 'var(--white)', borderRadius: 12, padding: 24, width: '100%', maxWidth: 900, maxHeight: '92vh', overflowY: 'auto', boxShadow: 'var(--shadow-lg)', fontFamily: 'var(--body)' }
const header = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, paddingBottom: 12, borderBottom: '1px solid var(--cream-dark)' }
const titulo = { margin: 0, fontSize: 18, fontWeight: 600, color: 'var(--navy)' }
const btnClose = { background: 'none', border: 'none', fontSize: 28, color: 'var(--text-mid)', cursor: 'pointer', padding: 0, lineHeight: 1 }
const uploadBox = { padding: 14, background: 'rgba(204,145,94,0.08)', border: '1px dashed var(--gold)', borderRadius: 8, marginBottom: 16, textAlign: 'center' }
const entradaBox = { padding: 14, background: 'var(--cream)', border: '1px solid var(--cream-dark)', borderLeft: '3px solid var(--gold)', borderRadius: 8, marginBottom: 12 }
const btnUpload = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 18px', background: 'var(--gold)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', fontFamily: 'var(--body)' }
const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 12 }
const input = { padding: '8px 10px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 12, color: 'var(--navy)', background: 'var(--white)', outline: 'none' }
const btnPrimary = { padding: '10px 18px', background: 'var(--gold)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', fontFamily: 'var(--body)' }
const btnSecondary = { padding: '10px 18px', background: 'var(--white)', color: 'var(--navy)', border: '1.5px solid var(--cream-dark)', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'var(--body)' }
const thMini = { textAlign: 'left', padding: '6px 8px', fontSize: 9, fontWeight: 700, letterSpacing: 1, color: '#fff', textTransform: 'uppercase', background: 'var(--navy)', position: 'sticky', top: 0, zIndex: 5 }
const tdMini = { padding: '4px 6px', borderBottom: '1px solid var(--cream-dark)' }
const inputMini = { width: '100%', padding: '4px 6px', border: '1px solid var(--cream-dark)', borderRadius: 4, fontSize: 11, fontFamily: 'var(--body)', color: 'var(--navy)' }
