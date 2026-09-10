import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { showToast } from '../../components/Toast'
import { fmtMoney } from '../../lib/finance'
import { pontuarNF, tabelaDaNF, confiancaMatch } from '../../lib/nfMatch'
import { vincularNFEmail } from '../../lib/vincularNF'

// ===========================================================================
// SELETOR DE LANÇAMENTO — o inverso do SeletorNF.
// Parte de uma nota da caixa de entrada (nf_pending) e procura o lançamento
// que JÁ existe (compra do cartão importada, conta já lançada) para anexar a
// nota como prova fiscal. O valor NÃO é lançado de novo: só o lançamento
// ganha número da NF + arquivo + situação fiscal "Com NF", e a nota sai da
// caixa apontando pra ele.
// ===========================================================================
function fmtDataBR(s) { if (!s) return '—'; const [y, m, d] = String(s).split('T')[0].split('-'); return d ? `${d}/${m}/${y}` : s }

const TOP_N = 8

// Lançamento ainda sem nota: sem número de NF, sem arquivo, não marcado "Com NF",
// e não é provisão (provisão não é saída real — não recebe prova).
function semNota(row) {
  const d = row.data || {}
  return !d.numero_nf && !row.anexo_path && d.doc_status !== 'vinculado' && d.status !== 'Provisão'
}

export default function SeletorLancamento({ open, onClose, nf, user, onVinculado }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [processando, setProcessando] = useState(false)
  const [busca, setBusca] = useState('')

  const tabela = useMemo(() => (nf ? tabelaDaNF(nf) : 'payable'), [nf])
  const nd = nf?.data || {}

  useEffect(() => {
    if (!open || !user || !nf) return
    setLoading(true); setBusca('')
    supabase.from(tabela).select('*')
      .then(({ data, error }) => {
        if (error) { showToast('Erro ao buscar lançamentos: ' + error.message, 'error'); setRows([]) }
        else setRows((data || []).filter(semNota))
        setLoading(false)
      })
  }, [open, user, nf, tabela])

  // Todos os candidatos pontuados, maior primeiro. Pontuação zero fica no fim
  // (ainda é escolhível pela busca — a nota pode não ter nada em comum com o texto).
  const ranking = useMemo(() => {
    if (!nf) return []
    return rows
      .map(lanc => ({ lanc, score: pontuarNF(lanc, nf) }))
      .sort((a, b) => b.score - a.score || String(b.lanc.data?.due || '').localeCompare(String(a.lanc.data?.due || '')))
  }, [rows, nf])

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return ranking.slice(0, TOP_N)
    return ranking.filter(({ lanc }) => {
      const d = lanc.data || {}
      const blob = [lanc.codigo, d.supplier, d.client, d.desc, d.numero_nf].filter(Boolean).join(' ').toLowerCase()
      return blob.includes(q)
    }).slice(0, 40)
  }, [ranking, busca])

  async function anexar(lanc) {
    if (processando) return
    // Nota que já virou lançamento não passa por aqui — no modo consolidar a
    // função APAGA a compra. A caixa de entrada só lista pendentes, mas o guarda fica.
    if (nf.lancamento_id) { showToast('Esta nota já é um lançamento — use "Vincular nota" pela edição do lançamento.', 'warning'); return }
    setProcessando(true)
    try {
      const r = await vincularNFEmail({ nf, compra: lanc, compraTabela: tabela, classificacao: {}, modo: 'anexar', user })
      // vincularNFEmail (modo anexar) já baixa a nf_pending: status aprovado + lancamento_id.
      // Confirma por segurança — se por algum motivo ficou pendente, a nota voltaria pra caixa.
      const { data: chk } = await supabase.from('nf_pending').select('status').eq('id', nf.id).single()
      if (chk && chk.status === 'pendente') {
        await supabase.from('nf_pending').update({
          status: 'aprovado', approved_at: new Date().toISOString(), lancamento_tipo: tabela, lancamento_id: lanc.id,
        }).eq('id', nf.id)
      }
      showToast(`Nota anexada ao lançamento ${lanc.codigo || lanc.id.slice(0, 8)}.`, 'success')
      onVinculado?.(r); onClose?.()
    } catch (e) { showToast('Erro ao anexar: ' + e.message, 'error') }
    finally { setProcessando(false) }
  }

  if (!open || !nf) return null
  const nv = Math.abs(Number(nd.valor || 0))
  const isReceita = tabela === 'receivable'

  return (
    <div style={overlay} onClick={processando ? undefined : onClose}>
      <div style={modal} onClick={e => e.stopPropagation()}>
        <div style={header}>
          <div>
            <h2 style={titulo}>Anexar a lançamento existente</h2>
            <div style={{ fontSize: 12, color: 'var(--text-mid)', marginTop: 4 }}>
              NF {nd.numero || '—'} · {nd.parte || nd.emitente_nome || '—'} · <strong>{fmtMoney(nv)}</strong> · {fmtDataBR(nd.data_emissao)} · {isReceita ? 'receita' : 'despesa'}
            </div>
          </div>
          <button onClick={onClose} style={btnClose} disabled={processando}>×</button>
        </div>

        <div style={{ fontSize: 11, color: 'var(--text-mid)', marginBottom: 10, lineHeight: 1.5 }}>
          A nota vira a <strong>prova fiscal</strong> deste lançamento (situação fiscal = Com NF). O valor <strong>NÃO</strong> é lançado de novo.
          Mostrando só lançamentos de <strong>{isReceita ? 'Contas a Receber' : 'Contas a Pagar'}</strong> que ainda não têm nota.
        </div>

        <input
          value={busca}
          onChange={e => setBusca(e.target.value)}
          placeholder="Buscar por código, fornecedor/cliente ou descrição…"
          style={inpBusca}
          autoFocus
        />

        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-mid)', margin: '12px 0 6px' }}>
          {busca.trim() ? `${visiveis.length} resultado(s)` : `Melhores candidatos (${Math.min(TOP_N, ranking.length)} de ${ranking.length})`}
        </div>

        {loading ? (
          <div style={vazio}>Buscando lançamentos…</div>
        ) : visiveis.length === 0 ? (
          <div style={vazio}>
            {ranking.length === 0
              ? 'Nenhum lançamento sem nota nesta direção. Se a compra ainda não foi lançada, use "Aprovar e lançar".'
              : 'Nada encontrado com esse texto.'}
          </div>
        ) : (
          <div style={lista}>
            {visiveis.map(({ lanc, score }) => {
              const d = lanc.data || {}
              const c = score > 0 ? confiancaMatch(score) : null
              const nomeParte = d.supplier || d.client || '—'
              const dia = d.data_competencia || d.due
              return (
                <button key={lanc.id} onClick={() => anexar(lanc)} disabled={processando} style={row} title="Anexar a nota a este lançamento">
                  <div style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--navy)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      <span style={{ fontFamily: 'monospace', color: 'var(--text-mid)', marginRight: 6 }}>{lanc.codigo || '—'}</span>
                      {nomeParte}
                      {c
                        ? <span style={{ ...badge, color: c.cor, borderColor: c.cor }}>{c.label}</span>
                        : <span style={{ ...badge, color: 'var(--text-mid)', borderColor: 'var(--cream-dark)' }}>sem indício</span>}
                      {lanc.cartao_id && <span style={{ ...badge, color: 'var(--gold-dark)', borderColor: 'var(--gold-dark)' }}>cartão</span>}
                      {lanc.conciliado_em && <span style={{ ...badge, color: 'var(--green)', borderColor: 'var(--green)' }}>conciliado</span>}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-mid)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {fmtDataBR(dia)} · {d.status || '—'}{d.desc ? ` · ${d.desc}` : ''}
                    </div>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: isReceita ? 'var(--green)' : 'var(--red)', whiteSpace: 'nowrap' }}>
                    {fmtMoney(Math.abs(Number(d.value || 0)))}
                  </div>
                </button>
              )
            })}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={onClose} style={btnSecondary} disabled={processando}>{processando ? 'Anexando…' : 'Cancelar'}</button>
        </div>
      </div>
    </div>
  )
}

const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,32,62,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 16 }
const modal = { background: 'var(--white)', borderRadius: 12, padding: 22, width: '100%', maxWidth: 640, maxHeight: '88vh', overflowY: 'auto', boxShadow: 'var(--shadow-lg)', fontFamily: 'var(--body)' }
const header = { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid var(--cream-dark)' }
const titulo = { margin: 0, fontSize: 17, fontWeight: 600, color: 'var(--navy)' }
const btnClose = { background: 'none', border: 'none', fontSize: 26, color: 'var(--text-mid)', cursor: 'pointer', padding: 0, lineHeight: 1 }
const inpBusca = { width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 12, color: 'var(--navy)', outline: 'none' }
const lista = { display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 340, overflowY: 'auto' }
const row = { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: '1px solid var(--cream-dark)', borderRadius: 8, background: 'var(--white)', cursor: 'pointer', fontFamily: 'var(--body)', width: '100%' }
const badge = { fontSize: 8, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', border: '1px solid', borderRadius: 4, padding: '1px 5px', marginLeft: 4, verticalAlign: 'middle' }
const btnSecondary = { padding: '9px 16px', background: 'var(--white)', color: 'var(--navy)', border: '1.5px solid var(--cream-dark)', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'var(--body)' }
const vazio = { padding: '16px', textAlign: 'center', color: 'var(--text-mid)', fontSize: 12, background: 'var(--cream)', borderRadius: 8, lineHeight: 1.5 }
