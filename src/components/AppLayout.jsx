import Sidebar from './Sidebar'
import Topbar from './Topbar'

// stickyTop: ReactNode opcional renderizado em <div position:sticky top:0>
// direto dentro de .scroll-main (sem padding intermediário), permitindo que
// grude no topo da viewport ao rolar. children fica num wrapper padded
// normal logo abaixo.
export default function AppLayout({ title, children, stickyTop }) {
  const hasSticky = stickyTop != null
  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--cream)' }}>
      <Sidebar />
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Topbar title={title} />
        <div className="scroll-main" style={{ flex: 1, overflowY: 'auto' }}>
          {hasSticky && (
            <div style={{ position: 'sticky', top: 0, zIndex: 50, background: 'var(--cream)', padding: '28px 28px 0' }}>
              {stickyTop}
            </div>
          )}
          <div style={{ padding: hasSticky ? '0 28px 28px' : 28 }}>
            {children}
          </div>
        </div>
      </main>
    </div>
  )
}
