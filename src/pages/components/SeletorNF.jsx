import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { showToast } from '../../components/Toast'
import { fmtMoney } from '../../lib/finance'
import { rankearNFs, confiancaMatch } from '../../lib/nfMatch'
import { vincularNFEmail, vincularNFArquivo } from '../../lib/vincularNF'

// ===========================================================================
// SELETOR DE NF — prova fiscal de um lançamento "Com NF".
// Fonte 1: notas lidas do e-mail (nf_pending) que casam com o lançamento.
// Fonte 2: subir o arquivo da nota física (digitalizada).
// Ao vincular uma nota do e-mail que já é lançamento, UNE (nota sobrevive).
// ===========================================================================
function fmtDataBR(s) { if (!s) return '—'; const [y, m, d] = String(s).split('T')[0].split('-'); return d ? `${d}/${m}/${y}` : s }

export default function SeletorNF({ open, onClose, compra, compraTabela, classificacao, user, onVinculado, modo = 'consolidar' }) {
  const [nfs, setNfs] = useState([])
  const [loading, setLoading] = useState(true)
  const [processando, setProcessando] = useState(false)
  const [arquivo, setArquivo] = useState(null)
  const [numeroManual, setNumeroManual] = useState('')

  useEffect(() => {
    if (!open || !user) return
    setLoading(true); setArquivo(null); setNumeroManual('')
    supabase.from('nf_pending').select('*').in('status', ['pendente', 'aprovado'])
      .then(({ data }) => { setNfs(data || []); setLoading(false) })
  }, [open, user])

  const ranking = useMemo(() => compra ? rankearNFs(compra, nfs) : [], [compra, nfs])

  async function vincularEmail(nf) {
    setProcessando(true)
    try {
      const r = await vincularNFEmail({ nf, compra, compraTabela, classificacao, modo })
      showToast(r.removidoId ? 'Nota vinculada — compra duplicada unida à nota.' : 'Nota vinculada.', 'success')
      onVinculado?.(r); onClose?.()
    } catch (e) { showToast('Erro ao vincular: ' + e.message, 'error') }
    finally { setProcessando(false) }
  }

  async function vincularArquivo() {
    if (!arquivo) { showToast('Escolha o arquivo da nota.', 'warning'); return }
    if (!numeroManual.trim()) { showToast('Informe o número da nota.', 'warning'); return }
    setProcessando(true)
    try {
      const r = await vincularNFArquivo({ compra, compraTabela, file: arquivo, numero: numeroManual.trim(), classificacao, user })
      showToast('Nota digitalizada vinculada como prova.', 'success')
      onVinculado?.(r); onClose?.()
    } catch (e) { showToast('Erro ao subir a nota: ' + e.message, 'error') }
    finally { setProcessando(false) }
  }

  if (!open) return null
  const cv = Math.abs(Number(compra?.data?.value || compra?.value || 0))

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={e => e.stopPropagation()}>
        <div style={header}>
          <div>
            <h2 style={titulo}>Vincular nota fiscal</h2>
            <div style={{ fontSize: 12, color: 'var(--text-mid)', marginTop: 4 }}>
              {(compra?.data?.supplier || compra?.data?.client || compra?.desc || '—')} · <strong>{fmtMoney(cv)}</strong> · {fmtDataBR(compra?.data?.data_competencia || compra?.data?.due)}
            </div>
          </div>
          <button onClick={onClose} style={btnClose}>×</button>
        </div>

        <div style={{ fontSize: 11, color: 'var(--text-mid)', marginBottom: 10, lineHeight: 1.5 }}>
          "Com NF" precisa de prova. Escolha a nota lida do <strong>e-mail</strong> que corresponde, ou <strong>suba o arquivo</strong> da nota física.
          Ao vincular uma nota que já virou lançamento, os dois são <strong>unidos</strong> (a nota é a verdade; a compra duplicada sai).
        </div>

        {/* Fonte 1: e-mail */}
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-mid)', marginBottom: 6 }}>Notas do e-mail que combinam</div>
        {loading ? (
          <div style={vazio}>Buscando notas…</div>
        ) : ranking.length === 0 ? (
          <div style={vazio}>Nenhuma nota do e-mail casou com este lançamento. Suba o arquivo abaixo.</div>
        ) : (
          <div style={lista}>
            {ranking.map(({ nf, score }) => {
              const c = confiancaMatch(score)
              const d = nf.data || {}
              return (
                <div key={nf.id} style={nfRow}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--navy)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {d.emitente_nome || d.parte || '—'} <span style={{ ...badge, color: c.cor, borderColor: c.cor }}>{c.label}</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-mid)' }}>
                      NF {d.numero || '—'} · {fmtMoney(Math.abs(Number(d.valor || 0)))} · {fmtDataBR(d.data_emissao)} {nf.status === 'aprovado' && '· já lançada'}
                    </div>
                  </div>
                  <button onClick={() => vincularEmail(nf)} disabled={processando} style={btnVincular}>Vincular</button>
                </div>
              )
            })}
          </div>
        )}

        {/* Fonte 2: arquivo físico */}
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-mid)', margin: '16px 0 6px' }}>Ou subir a nota digitalizada</div>
        <div style={uploadBox}>
          <input type="file" accept=".pdf,.xml,.jpg,.jpeg,.png" onChange={e => setArquivo(e.target.files?.[0] || null)} style={{ fontSize: 12 }} />
          <input value={numeroManual} onChange={e => setNumeroManual(e.target.value)} placeholder="Número da nota" style={inpNum} />
          <button onClick={vincularArquivo} disabled={processando || !arquivo} style={{ ...btnVincular, opacity: (processando || !arquivo) ? 0.5 : 1 }}>Vincular arquivo</button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={onClose} style={btnSecondary}>Cancelar</button>
        </div>
      </div>
    </div>
  )
}

const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,32,62,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 16 }
const modal = { background: 'var(--white)', borderRadius: 12, padding: 22, width: '100%', maxWidth: 620, maxHeight: '88vh', overflowY: 'auto', boxShadow: 'var(--shadow-lg)', fontFamily: 'var(--body)' }
const header = { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid var(--cream-dark)' }
const titulo = { margin: 0, fontSize: 17, fontWeight: 600, color: 'var(--navy)' }
const btnClose = { background: 'none', border: 'none', fontSize: 26, color: 'var(--text-mid)', cursor: 'pointer', padding: 0, lineHeight: 1 }
const lista = { display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 240, overflowY: 'auto' }
const nfRow = { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: '1px solid var(--cream-dark)', borderRadius: 8, background: 'var(--white)' }
const badge = { fontSize: 8, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', border: '1px solid', borderRadius: 4, padding: '1px 5px', marginLeft: 4 }
const btnVincular = { border: 'none', borderRadius: 6, padding: '7px 14px', fontSize: 11, fontWeight: 700, background: 'var(--navy)', color: '#fff', fontFamily: 'var(--body)', cursor: 'pointer', whiteSpace: 'nowrap' }
const btnSecondary = { padding: '9px 16px', background: 'var(--white)', color: 'var(--navy)', border: '1.5px solid var(--cream-dark)', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'var(--body)' }
const uploadBox = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: 10, background: 'var(--cream)', borderRadius: 8, border: '1px dashed var(--gold)' }
const inpNum = { flex: 1, minWidth: 120, padding: '7px 10px', border: '1.5px solid var(--cream-dark)', borderRadius: 6, fontFamily: 'var(--body)', fontSize: 12, color: 'var(--navy)', outline: 'none' }
const vazio = { padding: '16px', textAlign: 'center', color: 'var(--text-mid)', fontSize: 12, background: 'var(--cream)', borderRadius: 8 }
