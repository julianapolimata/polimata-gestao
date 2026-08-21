import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import AppLayout from '../components/AppLayout'

import { fmtMoney, flatten } from '../lib/finance'
import { showToast } from '../components/Toast'
import {
  descobrirFaixa, calcularAliquotaEfetiva,
  projetarDAS, compor, vencimentoDAS,
} from '../lib/simplesNacional'

// =====================================================================
// SIMPLES NACIONAL — Calculadora + projeção do DAS do mês seguinte.
// Polímata é Anexo III (consultoria com Fator R ≥ 28%). Anexo determinado
// via análise do último DAS (composição IRPJ/CSLL/COFINS/PIS/CPP/ISS).
// =====================================================================

const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

function fmtPct(v) { return (v * 100).toFixed(2) + '%' }
function fmtDataBR(s) {
  if (!s) return '—'
  const [y, m, d] = s.split('-')
  return `${d}/${m}/${y}`
}

export default function SimplesNacional() {
  const { user } = useAuth()
  const [config, setConfig] = useState(null)
  const [dasHist, setDasHist] = useState([])
  const [receivable, setReceivable] = useState([])
  const [loading, setLoading] = useState(true)
  const [editando, setEditando] = useState(false)
  const [formRbt12, setFormRbt12] = useState('')
  const [formMunicipio, setFormMunicipio] = useState('')
  const [salvando, setSalvando] = useState(false)

  const carregar = useCallback(() => {
    if (!user) return
    setLoading(true)
    Promise.all([
      supabase.from('simples_nacional_config').select('*').limit(1),
      supabase.from('simples_nacional_das').select('*').order('periodo_apuracao', { ascending: false }).limit(13),
      supabase.from('receivable').select('*'),
    ]).then(([rC, rD, rR]) => {
      setConfig(rC.data?.[0] || null)
      setDasHist(rD.data || [])
      setReceivable((rR.data || []).map(flatten))
      setLoading(false)
    })
  }, [user])

  useEffect(() => { carregar() }, [carregar])

  const cfg = config?.data || {}

  function abrirEditor() {
    setFormRbt12(cfg.rbt12_estimada != null ? String(cfg.rbt12_estimada) : '')
    setFormMunicipio(cfg.municipio_iss || '')
    setEditando(true)
  }
  // Prévia ao vivo enquanto digita a RBT12: faixa + alíquota efetiva calculadas.
  const rbt12Form = Number(String(formRbt12).replace(/\./g, '').replace(',', '.')) || 0
  const faixaForm = descobrirFaixa(rbt12Form)
  const aliquotaForm = calcularAliquotaEfetiva(rbt12Form, faixaForm)

  async function salvarConfig() {
    if (rbt12Form <= 0) { showToast('Informe a RBT12 estimada (receita dos últimos 12 meses).', 'warning'); return }
    const novo = {
      ...(cfg || {}),
      anexo: 'III',
      rbt12_estimada: rbt12Form,
      aliquota_efetiva: aliquotaForm,
      municipio_iss: formMunicipio.trim() || null,
      atualizado_em: new Date().toISOString().slice(0, 10),
    }
    setSalvando(true)
    try {
      if (config?.id) {
        const { error } = await supabase.from('simples_nacional_config').update({ data: novo }).eq('id', config.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('simples_nacional_config').insert({ user_id: user.id, data: novo })
        if (error) throw error
      }
      showToast('Configuração do Simples salva.', 'success')
      setEditando(false); carregar()
    } catch (e) { showToast('Erro ao salvar: ' + e.message, 'error') }
    finally { setSalvando(false) }
  }

  // Mês corrente — vamos projetar o DAS deste mês (vence dia 20 do próximo)
  const hoje = new Date()
  // mesAtualISO removido — não usado
  const mesAnteriorISO = `${hoje.getMonth() === 0 ? hoje.getFullYear() - 1 : hoje.getFullYear()}-${String(hoje.getMonth() === 0 ? 12 : hoje.getMonth()).padStart(2, '0')}`

  // Faturamento do mês: receivable cuja data_competencia (ou due) cai no mês selecionado
  const [mesSelecionado, setMesSelecionado] = useState(mesAnteriorISO)

  // Base do DAS = NFS-e EMITIDAS: exclui Provisão (previsão, sem NF) e captação
  // de empréstimo (financiamento, não é faturamento).
  const ehFaturamento = r => {
    const ref = r.data?.data_competencia || r.due
    return ref && ref.startsWith(mesSelecionado) && r.data?.status !== 'Provisão' && !r.data?.criado_via_emprestimo
  }
  const faturamentoMes = useMemo(() => {
    return receivable.filter(ehFaturamento).reduce((s, r) => s + Number(r.value || 0), 0)
  }, [receivable, mesSelecionado])

  // Lançamentos do mês pra mostrar detalhe
  const lancamentosDoMes = useMemo(() => {
    return receivable.filter(ehFaturamento).sort((a, b) => (a.due || '').localeCompare(b.due || ''))
  }, [receivable, mesSelecionado])

  // Projeção
  const aliquotaEf = Number(cfg.aliquota_efetiva || 0)
  const faixaInfo = useMemo(() => descobrirFaixa(Number(cfg.rbt12_estimada || 0)), [cfg.rbt12_estimada])
  const projecao = useMemo(() => projetarDAS({ faturamentoMes, aliquotaEfetiva: aliquotaEf }), [faturamentoMes, aliquotaEf])
  const composicao = useMemo(() => compor(projecao.dasLiquido, faixaInfo.faixa), [projecao.dasLiquido, faixaInfo.faixa])
  const vencimento = vencimentoDAS(mesSelecionado)

  // Tendência: comparar com último DAS pago
  const dasUltimo = dasHist[0]
  const tendencia = useMemo(() => {
    if (!dasUltimo) return null
    const dif = projecao.dasLiquido - Number(dasUltimo.valor_total)
    const pct = dif / Number(dasUltimo.valor_total)
    return { dif, pct, valor_anterior: Number(dasUltimo.valor_total), periodo_anterior: dasUltimo.periodo_apuracao }
  }, [projecao.dasLiquido, dasUltimo])

  // Lista de meses dos últimos 12
  const mesesDisponiveis = useMemo(() => {
    const out = []
    for (let i = 0; i < 12; i++) {
      const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1)
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      out.push({ iso, label: `${MESES[d.getMonth()]}/${d.getFullYear()}` })
    }
    return out
  }, [hoje])

  const formEditor = (
    <div style={parametrosBox}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--navy)', marginBottom: 12 }}>⚙️ Configuração do Simples Nacional</div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={campo}>
            <span style={campoLabel}>RBT12 estimada (receita bruta dos últimos 12 meses)</span>
            <input value={formRbt12} onChange={e => setFormRbt12(e.target.value)} placeholder="ex.: 240000" inputMode="decimal" style={input} />
          </label>
          <label style={campo}>
            <span style={campoLabel}>Município do ISS</span>
            <input value={formMunicipio} onChange={e => setFormMunicipio(e.target.value)} placeholder="ex.: Rio Claro/SP" style={input} />
          </label>
        </div>
        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-mid)' }}>
          Anexo <strong>III</strong> (consultoria, Fator R ≥ 28%) · Faixa <strong>{faixaForm.faixa}</strong> (até {fmtMoney(faixaForm.ate)}) · Alíquota efetiva calculada: <strong style={{ color: 'var(--gold-dark)' }}>{fmtPct(aliquotaForm)}</strong>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button onClick={salvarConfig} disabled={salvando} style={btnPrimary}>{salvando ? 'Salvando…' : 'Salvar configuração'}</button>
          {config && <button onClick={() => setEditando(false)} style={btnGhost}>Cancelar</button>}
        </div>
      </div>
    </div>
  )

  if (loading) return <AppLayout title="Simples Nacional"><div style={emptyState}>Carregando…</div></AppLayout>

  if (!config && !editando) {
    return (
      <AppLayout title="Simples Nacional">
        <div style={{ fontSize: 13, color: 'var(--text-mid)', marginBottom: 14, lineHeight: 1.6 }}>
          Configure a calculadora do Simples Nacional pra eu projetar o DAS do mês. Informe a RBT12 (receita dos últimos 12 meses) — a faixa e a alíquota efetiva saem automaticamente.
        </div>
        {formEditor}
      </AppLayout>
    )
  }
  if (editando) {
    return <AppLayout title="Simples Nacional">{formEditor}</AppLayout>
  }

  return (
    <AppLayout title="Simples Nacional">
      {/* Banner parâmetros fiscais */}
      <div style={parametrosBox}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 10, color: 'var(--text-mid)', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>Configuração Polímata{cfg.atualizado_em ? ` · atualizada em ${fmtDataBR(cfg.atualizado_em)}` : ''}</div>
            <button onClick={abrirEditor} style={btnGhost}>⚙️ Editar</button>
          </div>
          <div style={{ display: 'flex', gap: 24, marginTop: 8, flexWrap: 'wrap' }}>
            <Param label="Anexo" valor={`Anexo ${cfg.anexo || 'III'} (serviços)`} />
            <Param label="Faixa" valor={`Faixa ${faixaInfo.faixa}`} sub={`até ${fmtMoney(faixaInfo.ate)}`} />
            <Param label="RBT12 estimada" valor={fmtMoney(cfg.rbt12_estimada)} />
            <Param label="Alíquota efetiva" valor={fmtPct(aliquotaEf)} />
            <Param label="Município ISS" valor={cfg.municipio_iss || '—'} />
          </div>
        </div>
      </div>

      {/* Seletor de mês + projeção */}
      <div style={projecaoCard}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16, marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-mid)', fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6 }}>Projeção DAS</div>
            <div style={{ fontSize: 13, color: 'var(--navy)' }}>
              Período de apuração:{' '}
              <select value={mesSelecionado} onChange={e => setMesSelecionado(e.target.value)} style={select}>
                {mesesDisponiveis.map(m => <option key={m.iso} value={m.iso}>{m.label}</option>)}
              </select>
              {' '}· Vencimento: <strong>{fmtDataBR(vencimento)}</strong>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 36, fontWeight: 700, color: 'var(--gold-dark)', fontFamily: 'var(--body)' }}>{fmtMoney(projecao.dasLiquido)}</div>
            {tendencia && (
              <div style={{ fontSize: 11, color: tendencia.dif >= 0 ? 'var(--red)' : 'var(--green)', fontWeight: 600 }}>
                {tendencia.dif >= 0 ? '↑' : '↓'} {fmtMoney(Math.abs(tendencia.dif))} vs {tendencia.periodo_anterior} ({fmtPct(Math.abs(tendencia.pct))})
              </div>
            )}
          </div>
        </div>

        {/* Fórmula */}
        <div style={formulaBox}>
          <div style={{ fontSize: 11, color: 'var(--text-mid)' }}>
            Faturamento de {MESES[parseInt(mesSelecionado.split('-')[1], 10) - 1]}/{mesSelecionado.split('-')[0]}: <strong>{fmtMoney(faturamentoMes)}</strong>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-mid)' }}>
            × Alíquota efetiva: <strong>{fmtPct(aliquotaEf)}</strong>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-mid)' }}>
            = <strong style={{ color: 'var(--gold-dark)' }}>{fmtMoney(projecao.dasNominal)}</strong>
          </div>
        </div>

        {/* Composição por tributo */}
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 10, color: 'var(--text-mid)', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>Composição estimada</div>
          <div style={composicaoGrid}>
            <Tributo label="IRPJ" valor={composicao.irpj} cor="var(--navy)" />
            <Tributo label="CSLL" valor={composicao.csll} cor="var(--navy)" />
            <Tributo label="COFINS" valor={composicao.cofins} cor="var(--navy)" />
            <Tributo label="PIS" valor={composicao.pis} cor="var(--navy)" />
            <Tributo label="CPP (INSS)" valor={composicao.cpp} cor="var(--gold)" sub="o maior" />
            <Tributo label="ISS Valinhos" valor={composicao.iss} cor="var(--gold)" />
          </div>
        </div>
      </div>

      {/* Lançamentos que entraram na conta */}
      <div style={tableCard}>
        <div style={{ padding: '18px 24px 14px', borderBottom: '1px solid var(--cream-dark)' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--navy)' }}>NFS-e emitidas no período</div>
          <div style={{ fontSize: 11, color: 'var(--text-mid)', marginTop: 2 }}>Base do cálculo do DAS. {lancamentosDoMes.length} lançamento(s).</div>
        </div>
        {lancamentosDoMes.length === 0 ? (
          <div style={emptyState}>Nenhuma NFS-e emitida neste período.</div>
        ) : (
          <table style={tbl}>
            <thead>
              <tr>
                <th style={th}>Cód.</th>
                <th style={th}>Cliente</th>
                <th style={{ ...th, width: 110 }}>Emissão</th>
                <th style={{ ...th, width: 110 }}>Vencimento</th>
                <th style={{ ...th, width: 130, textAlign: 'right' }}>Valor</th>
              </tr>
            </thead>
            <tbody>
              {lancamentosDoMes.map(r => (
                <tr key={r.id}>
                  <td style={{ ...td, fontFamily: 'monospace', color: 'var(--text-mid)' }}>{r.codigo || '—'}</td>
                  <td style={td}>{r.client || r.data?.client || '—'}</td>
                  <td style={{ ...td, color: 'var(--text-mid)' }}>{fmtDataBR(r.data?.data_competencia)}</td>
                  <td style={{ ...td, color: 'var(--text-mid)' }}>{fmtDataBR(r.due)}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{fmtMoney(r.value)}</td>
                </tr>
              ))}
              <tr style={{ background: 'var(--cream)' }}>
                <td style={{ ...td, fontWeight: 700 }} colSpan={4}>Total</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: 'var(--navy)' }}>{fmtMoney(faturamentoMes)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      {/* Histórico de DAS pagos */}
      {dasHist.length > 0 && (
        <div style={tableCard}>
          <div style={{ padding: '18px 24px 14px', borderBottom: '1px solid var(--cream-dark)' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--navy)' }}>Histórico de DAS</div>
          </div>
          <table style={tbl}>
            <thead>
              <tr>
                <th style={th}>Período</th>
                <th style={{ ...th, width: 110 }}>Venc.</th>
                <th style={th}>Nº Documento</th>
                <th style={{ ...th, width: 130, textAlign: 'right' }}>Valor</th>
              </tr>
            </thead>
            <tbody>
              {dasHist.map(d => (
                <tr key={d.id}>
                  <td style={{ ...td, fontWeight: 600 }}>{d.periodo_apuracao}</td>
                  <td style={{ ...td, color: 'var(--text-mid)' }}>{fmtDataBR(d.data_vencimento)}</td>
                  <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>{d.data?.numero_documento || '—'}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{fmtMoney(d.valor_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppLayout>
  )
}

function Param({ label, valor, sub }) {
  return (
    <div>
      <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-mid)', letterSpacing: 1, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--navy)', marginTop: 3 }}>{valor}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--text-mid)' }}>{sub}</div>}
    </div>
  )
}

function Tributo({ label, valor, cor, sub }) {
  return (
    <div style={{ background: 'var(--white)', borderRadius: 8, padding: 12, border: '1px solid var(--cream-dark)' }}>
      <div style={{ fontSize: 10, color: 'var(--text-mid)', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: cor, marginTop: 4 }}>{fmtMoney(valor)}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--text-mid)', fontStyle: 'italic' }}>{sub}</div>}
    </div>
  )
}

const parametrosBox = { background: 'var(--white)', borderRadius: 10, padding: 18, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)', marginBottom: 18, display: 'flex', gap: 16, alignItems: 'flex-start' }
const projecaoCard = { background: 'var(--white)', borderRadius: 12, padding: 24, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)', marginBottom: 18 }
const formulaBox = { background: 'rgba(204,145,94,0.06)', borderLeft: '3px solid var(--gold)', padding: 14, borderRadius: 6, fontSize: 12, color: 'var(--navy)', display: 'flex', flexDirection: 'column', gap: 4 }
const composicaoGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }
const select = { padding: '6px 10px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 13, color: 'var(--navy)', background: 'var(--white)', outline: 'none' }
const campo = { display: 'flex', flexDirection: 'column', gap: 5, flex: '1 1 240px', minWidth: 200 }
const campoLabel = { fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--text-mid)' }
const input = { padding: '9px 11px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 13, color: 'var(--navy)', background: 'var(--white)', outline: 'none' }
const btnPrimary = { padding: '9px 18px', border: 'none', borderRadius: 6, background: 'var(--gold)', color: '#fff', fontFamily: 'var(--body)', fontSize: 12, fontWeight: 700, letterSpacing: 0.5, cursor: 'pointer' }
const btnGhost = { padding: '7px 14px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, background: 'var(--white)', color: 'var(--navy)', fontFamily: 'var(--body)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }
const tableCard = { background: 'var(--white)', borderRadius: 12, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)', overflow: 'clip', marginBottom: 18 }
const tbl = { width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--body)' }
const th = { textAlign: 'left', padding: '12px 14px', fontSize: 9, fontWeight: 700, letterSpacing: 1.5, color: '#fff', textTransform: 'uppercase', background: 'var(--navy)', borderBottom: '2px solid var(--gold)' }
const td = { padding: '12px 14px', fontSize: 12, color: 'var(--navy)', borderBottom: '1px solid var(--cream-dark)' }
const emptyState = { padding: '60px 24px', textAlign: 'center', fontFamily: 'var(--body)', color: 'var(--text-mid)', fontSize: 13, background: 'var(--white)', borderRadius: 12, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)' }
