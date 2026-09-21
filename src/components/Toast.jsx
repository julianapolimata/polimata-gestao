import { useCallback, useEffect, useRef, useState } from 'react'

// Toast — fila no canto inferior direito. 4 variantes (success/error/warning/info).
// Uso: import { showToast } from '../components/Toast'; showToast('Salvo!', 'success')
// Com ação:  showToast('Excluído.', 'info', { acao: { label: 'Desfazer', onClick: fn } })
// Com duração própria: showToast('…', 'info', { duracao: 0 })  // 0 = não some sozinho
// Renderizar <ToastContainer /> uma vez (raiz da app) pra ativar.
//
// Por que duração por tipo: erro que some em 3,5s é erro que ninguém leu. Erro
// fica até fechar (ou 15s), aviso 8s, sucesso/info 4s — e TODOS têm o "×".

let _add = null

const DURACAO_PADRAO = {
  error: 15000,
  warning: 8000,
  success: 4000,
  info: 4000,
}

export function showToast(msg, kind = 'info', opts = {}) {
  if (_add) _add(msg, kind, opts)
}

export function ToastContainer() {
  const [toasts, setToasts] = useState([])
  const timers = useRef(new Map())

  const fechar = useCallback(id => {
    const t = timers.current.get(id)
    if (t) { clearTimeout(t); timers.current.delete(id) }
    setToasts(list => list.filter(x => x.id !== id))
  }, [])

  useEffect(() => {
    const mapa = timers.current
    _add = (msg, kind, opts) => {
      const id = Math.random().toString(36).slice(2)
      const duracao = opts && typeof opts.duracao === 'number'
        ? opts.duracao
        : (DURACAO_PADRAO[kind] ?? DURACAO_PADRAO.info)
      setToasts(t => [...t, { id, msg, kind, acao: opts?.acao || null }])
      if (duracao > 0) mapa.set(id, setTimeout(() => fechar(id), duracao))
    }
    return () => {
      _add = null
      for (const t of mapa.values()) clearTimeout(t)
      mapa.clear()
    }
  }, [fechar])

  function executarAcao(t) {
    try { t.acao?.onClick?.() } finally { fechar(t.id) }
  }

  return (
    <div style={wrap}>
      {toasts.map(t => {
        const erro = t.kind === 'error'
        return (
          <div
            key={t.id}
            style={{ ...item, ...(byKind[t.kind] || byKind.info) }}
            role={erro ? 'alert' : 'status'}
            aria-live={erro ? 'assertive' : 'polite'}
            aria-atomic="true"
          >
            <div style={texto}>{t.msg}</div>
            {t.acao && (
              <button
                onClick={() => executarAcao(t)}
                style={btnAcao}
                type="button"
              >{t.acao.label}</button>
            )}
            <button
              onClick={() => fechar(t.id)}
              style={btnFechar}
              aria-label="Fechar aviso"
              title="Fechar"
              type="button"
            >×</button>
          </div>
        )
      })}
    </div>
  )
}

const wrap = {
  position: 'fixed', bottom: 24, right: 24,
  display: 'flex', flexDirection: 'column', gap: 8,
  zIndex: 200, pointerEvents: 'none',
}
const item = {
  display: 'flex', alignItems: 'center', gap: 10,
  padding: '12px 12px 12px 18px', borderRadius: 8,
  fontSize: 13, fontWeight: 500, fontFamily: 'var(--body)',
  boxShadow: '0 6px 20px rgba(0,0,0,0.18)',
  minWidth: 240, maxWidth: 440,
  pointerEvents: 'auto',
}
const texto = { flex: 1, lineHeight: 1.45 }
const btnAcao = {
  flexShrink: 0,
  background: 'rgba(255,255,255,0.18)',
  border: '1px solid rgba(255,255,255,0.55)',
  borderRadius: 6, color: '#fff',
  fontFamily: 'var(--body)', fontSize: 11, fontWeight: 700,
  letterSpacing: 0.5, textTransform: 'uppercase',
  padding: '5px 10px', cursor: 'pointer',
}
const btnFechar = {
  flexShrink: 0,
  background: 'none', border: 'none', color: '#fff',
  fontSize: 20, lineHeight: 1, cursor: 'pointer',
  padding: 0, width: 24, height: 24, opacity: 0.85,
}
const byKind = {
  success: { background: 'var(--green)', color: '#fff' },
  error: { background: 'var(--red)', color: '#fff' },
  warning: { background: 'var(--orange)', color: '#fff' },
  info: { background: 'var(--navy)', color: '#fff' },
}
