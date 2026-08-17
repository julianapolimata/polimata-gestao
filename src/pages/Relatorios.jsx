import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import AppLayout from '../components/AppLayout'
import EstadoErro from '../components/EstadoErro'
import { showToast } from '../components/Toast'
import { fmtMoney } from '../lib/finance'
import { fetchPlanoContas } from '../lib/planoContas'
import { construirRelatorio, exportarPDF, exportarExcel } from '../lib/relatorios'

// =====================================================================
// RELATÓRIOS — exportação em PDF e Excel (branded) de Contas a Receber,
// Contas a Pagar e Movimento consolidado. Bibliotecas carregadas sob
// demanda dentro de lib/relatorios.
// =====================================================================

const TIPOS = [
  { v: 'receber', l: 'Contas a Receber' },
  { v: 'pagar', l: 'Contas a Pagar' },
  { v: 'movimento', l: 'Movimento Consolidado' },
  { v: 'dre_realizado', l: 'DRE Gerencial (Realizado)' },
  { v: 'dre_projetado', l: 'DRE Gerencial (Projetado)' },
  { v: 'fluxo', l: 'Fluxo de Caixa (anual)' },
]
const TIPOS_ANUAIS = ['dre_realizado', 'dre_projetado', 'fluxo']

function primeiroDiaMes() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}
function ultimoDiaMes() {
  const d = new Date()
  const u = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  return `${u.getFullYear()}-${String(u.getMonth() + 1).padStart(2, '0')}-${String(u.getDate()).padStart(2, '0')}`
}

export default function Relatorios() {
  const { user } = useAuth()
  const [receivable, setReceivable] = useState([])
  const [payable, setPayable] = useState([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState(null)
  const [tipo, setTipo] = useState('receber')
  const [de, setDe] = useState(primeiroDiaMes())
  const [ate, setAte] = useState(ultimoDiaMes())
  const [ano, setAno] = useState(String(new Date().getFullYear()))
  const [plano, setPlano] = useState([])
  const [recurringMasters, setRecurringMasters] = useState([])
  const [exportando, setExportando] = useState(null)

  const carregar = useCallback(() => {
    if (!user) return
    setLoading(true)
    Promise.all([
      supabase.from('receivable').select('*'),
      supabase.from('payable').select('*'),
      supabase.from('recurring_masters').select('*'),
      fetchPlanoContas(),
    ]).then(([rR, rP, rM, planoData]) => {
      if (rR.error || rP.error) { setErro(rR.error || rP.error); setLoading(false); return }
      setErro(null)
      setReceivable(rR.data || [])
      setPayable(rP.data || [])
      setRecurringMasters(rM.data || [])
      setPlano(planoData || [])
      setLoading(false)
    }).catch(e => { setErro(e); setLoading(false) })
  }, [user])

  useEffect(() => { carregar() }, [carregar])

  const isAnual = TIPOS_ANUAIS.includes(tipo)
  const rel = useMemo(
    () => construirRelatorio(tipo, { receivable, payable, plano, recurringMasters, de: de || null, ate: ate || null, ano }),
    [tipo, receivable, payable, plano, recurringMasters, de, ate, ano],
  )

  async function baixar(formato) {
    if (!rel.linhas.length) { showToast('Nenhum lançamento no período selecionado.', 'warning'); return }
    setExportando(formato)
    try {
      if (formato === 'pdf') await exportarPDF(rel, { de, ate })
      else await exportarExcel(rel, { de, ate })
    } catch (e) {
      console.error(e)
      showToast('Erro ao gerar o arquivo: ' + (e?.message || e), 'error')
    } finally {
      setExportando(null)
    }
  }

  if (loading) return <AppLayout title="Relatórios"><div style={emptyState}>Carregando…</div></AppLayout>
  if (erro) return <AppLayout title="Relatórios"><EstadoErro onRetry={carregar} /></AppLayout>

  const preview = rel.linhas.slice(0, 12)
  const anoAtual = new Date().getFullYear()
  const anosOpcoes = [anoAtual + 1, anoAtual, anoAtual - 1, anoAtual - 2].map(String)

  return (
    <AppLayout title="Relatórios">
      {/* Controles */}
      <div style={card}>
        <div style={filtros}>
          <div style={{ minWidth: 200 }}>
            <label style={labelStyle}>Relatório</label>
            <select value={tipo} onChange={e => setTipo(e.target.value)} style={input}>
              {TIPOS.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
            </select>
          </div>
          {isAnual ? (
            <div>
              <label style={labelStyle}>Ano</label>
              <select value={ano} onChange={e => setAno(e.target.value)} style={input}>
                {anosOpcoes.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          ) : (
            <>
              <div>
                <label style={labelStyle}>De (vencimento)</label>
                <input type="date" value={de} onChange={e => setDe(e.target.value)} style={input} />
              </div>
              <div>
                <label style={labelStyle}>Até</label>
                <input type="date" value={ate} onChange={e => setAte(e.target.value)} style={input} />
              </div>
            </>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginLeft: 'auto' }}>
            <button type="button" onClick={() => baixar('pdf')} disabled={!!exportando} style={btnPdf}>
              {exportando === 'pdf' ? 'Gerando…' : '⬇ PDF'}
            </button>
            <button type="button" onClick={() => baixar('xlsx')} disabled={!!exportando} style={btnExcel}>
              {exportando === 'xlsx' ? 'Gerando…' : '⬇ Excel'}
            </button>
          </div>
        </div>
      </div>

      {/* Prévia */}
      <div style={tableCard}>
        <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--cream-dark)', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--navy)' }}>{rel.titulo}</div>
          <div style={{ fontSize: 12, color: 'var(--text-mid)' }}>{isAnual ? (rel.nota || `Ano ${ano}`) : <>{rel.linhas.length} lançamento(s) no período · <strong style={{ color: 'var(--navy)' }}>{rel.totais ? fmtMoney(rel.totais.valor) : ''}</strong></>}</div>
        </div>

        {rel.linhas.length === 0 ? (
          <div style={emptyState}>Nenhum lançamento no período. Ajuste as datas acima.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={tbl}>
              <thead>
                <tr>{rel.colunas.map((c, i) => <th key={i} style={{ ...th, textAlign: c.align === 'right' ? 'right' : 'left' }}>{c.header}</th>)}</tr>
              </thead>
              <tbody>
                {preview.map((linha, i) => (
                  <tr key={i}>
                    {linha.map((cel, j) => (
                      <td key={j} style={{ ...td, textAlign: rel.colunas[j]?.align === 'right' ? 'right' : 'left', fontWeight: j === rel.colunas.length - 1 ? 600 : 400 }}>{cel}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {rel.linhas.length > preview.length && (
              <div style={{ padding: '10px 20px', fontSize: 11, color: 'var(--text-mid)', fontStyle: 'italic' }}>
                Mostrando {preview.length} de {rel.linhas.length}. O arquivo exportado traz todos.
              </div>
            )}
          </div>
        )}
      </div>

      <div style={notaBox}>
        Os arquivos saem com a <strong>identidade Polímata</strong> (navy + gold), prontos pra enviar ao contador ou ao banco.
        As bibliotecas de exportação só carregam quando você clica — o app segue leve.
      </div>
    </AppLayout>
  )
}

const card = { background: 'var(--white)', borderRadius: 12, padding: 20, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)', marginBottom: 18 }
const filtros = { display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap' }
const labelStyle = { display: 'block', fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-mid)', marginBottom: 6, fontFamily: 'var(--body)' }
const input = { width: '100%', padding: '9px 12px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 13, color: 'var(--navy)', background: 'var(--white)', outline: 'none', boxSizing: 'border-box' }
const btnPdf = { padding: '10px 18px', border: 'none', borderRadius: 6, background: 'var(--gold)', color: '#fff', fontFamily: 'var(--body)', fontSize: 12, fontWeight: 700, cursor: 'pointer', letterSpacing: 0.5 }
const btnExcel = { padding: '10px 18px', border: '1.5px solid var(--navy)', borderRadius: 6, background: 'var(--navy)', color: '#fff', fontFamily: 'var(--body)', fontSize: 12, fontWeight: 700, cursor: 'pointer', letterSpacing: 0.5 }
const tableCard = { background: 'var(--white)', borderRadius: 12, border: '1px solid var(--cream-dark)', boxShadow: 'var(--shadow)', overflow: 'clip', marginBottom: 18 }
const tbl = { width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--body)', minWidth: 640 }
const th = { textAlign: 'left', padding: '11px 14px', fontSize: 9, fontWeight: 700, letterSpacing: 1.2, color: '#fff', textTransform: 'uppercase', background: 'var(--navy)', borderBottom: '2px solid var(--gold)', whiteSpace: 'nowrap' }
const td = { padding: '10px 14px', fontSize: 12, color: 'var(--navy)', borderBottom: '1px solid var(--cream-dark)', whiteSpace: 'nowrap' }
const notaBox = { fontSize: 12, color: 'var(--navy)', background: 'rgba(204,145,94,0.08)', borderLeft: '3px solid var(--gold)', borderRadius: 6, padding: '12px 16px', lineHeight: 1.5 }
const emptyState = { padding: '48px 24px', textAlign: 'center', fontFamily: 'var(--body)', color: 'var(--text-mid)', fontSize: 13 }
