import { useEffect, useState } from 'react'

// Toast simples — fila no canto inferior direito. 4 variantes (success/error/warning/info).
// Uso: import { showToast } from '../components/Toast'; showToast('Salvo!', 'success')
// Renderizar <ToastContainer /> uma vez (raiz da app) pra ativar.

let _add = null

export function showToast(msg, kind = 'info') {
  if (_add) _add(msg, kind)
}

export function ToastContainer() {
  const [toasts, setToasts] = useState([])
  useEffect(() => {
    _add = (msg, kind) => {
      const id = Math.random().toString(36).slice(2)
      setToasts(t => [...t, { id, msg, kind }])
      setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500)
    }
    return () => { _add = null }
  }, [])
  return (
    <div style={wrap} aria-live="polite" aria-atomic="false">
      {toasts.map(t => (
        <div key={t.id} style={{ ...item, ...byKind[t.kind] }} role="status">{t.msg}</div>
      ))}
    </div>
  )
}

const wrap = {
  position: 'fixed', bottom: 24, right: 24,
  display: 'flex', flexDirection: 'column', gap: 8,
  zIndex: 200, pointerEvents: 'none',
}
const item = {
  padding: '12px 18px', borderRadius: 8,
  fontSize: 13, fontWeight: 500, fontFamily: 'var(--body)',
  boxShadow: '0 6px 20px rgba(0,0,0,0.18)',
  minWidth: 240, maxWidth: 420,
  pointerEvents: 'auto',
}
const byKind = {
  success: { background: 'var(--green)', color: '#fff' },
  error: { background: 'var(--red)', color: '#fff' },
  warning: { background: 'var(--orange)', color: '#fff' },
  info: { background: 'var(--navy)', color: '#fff' },
}
