import { useEffect } from 'react'

// Modal genérico — overlay + container + ESC + click off + scroll lock.
// Inclui slot title (string), corpo (children) e footer (nó React) opcionais.
export default function Modal({ open, onClose, title, children, footer, width = 640 }) {
  useEffect(() => {
    if (!open) return undefined
    const handler = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', handler)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose])
  if (!open) return null
  return (
    <div style={overlay} onClick={onClose} role="presentation">
      <div
        style={{ ...container, maxWidth: width }}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
      >
        <div style={header}>
          <div style={titleStyle}>{title}</div>
          <button onClick={onClose} style={closeBtn} aria-label="Fechar">×</button>
        </div>
        <div style={body}>{children}</div>
        {footer && <div style={footerStyle}>{footer}</div>}
      </div>
    </div>
  )
}

const overlay = {
  position: 'fixed', inset: 0,
  background: 'rgba(0,32,62,0.5)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 100, padding: 16,
}
const container = {
  background: 'var(--white)', borderRadius: 12,
  width: '100%', maxHeight: '92vh',
  display: 'flex', flexDirection: 'column',
  boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
  fontFamily: 'var(--body)',
}
const header = {
  padding: '18px 24px', borderBottom: '1px solid var(--cream-dark)',
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  flexShrink: 0,
}
const titleStyle = { fontSize: 16, fontWeight: 600, color: 'var(--navy)' }
const closeBtn = {
  background: 'none', border: 'none', fontSize: 26, color: 'var(--text-mid)',
  cursor: 'pointer', lineHeight: 1, padding: 0, width: 28, height: 28,
}
const body = { padding: 24, overflowY: 'auto', flex: 1 }
const footerStyle = {
  padding: '14px 24px', borderTop: '1px solid var(--cream-dark)',
  display: 'flex', gap: 8, justifyContent: 'flex-end', background: 'var(--cream)',
  flexShrink: 0,
}
