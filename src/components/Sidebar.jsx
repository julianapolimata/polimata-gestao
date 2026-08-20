import { useEffect, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'

const STORAGE_KEY = 'polimata_v2_sidebar_collapsed'

// Item de menu — usa NavLink pra marcar ativo automaticamente
function NavItem({ to, icon, label, collapsed, disabled = false }) {
  if (disabled) {
    return (
      <div style={{ ...itemBase, color: 'rgba(243,238,228,0.35)', cursor: 'not-allowed', justifyContent: collapsed ? 'center' : 'flex-start' }} title={collapsed ? `${label} — em breve` : 'Em breve'}>
        {icon}
        {!collapsed && (<>
          <span style={{ flex: 1 }}>{label}</span>
          <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: 1, background: 'rgba(204,145,94,0.15)', color: 'var(--gold-light)', padding: '2px 6px', borderRadius: 999 }}>EM BREVE</span>
        </>)}
      </div>
    )
  }
  return (
    <NavLink
      to={to}
      title={collapsed ? label : undefined}
      style={({ isActive }) => ({
        ...itemBase,
        justifyContent: collapsed ? 'center' : 'flex-start',
        background: isActive ? 'rgba(204,145,94,0.12)' : 'transparent',
        color: isActive ? 'var(--gold)' : 'rgba(243,238,228,0.75)',
        borderLeft: isActive ? '3px solid var(--gold)' : '3px solid transparent',
      })}
    >
      {icon}
      {!collapsed && <span>{label}</span>}
    </NavLink>
  )
}

const itemBase = {
  display: 'flex', alignItems: 'center', gap: 11,
  padding: '10px 16px 10px 17px',
  fontSize: 12, fontWeight: 500,
  fontFamily: 'var(--body)',
  textDecoration: 'none',
  transition: 'background .15s, color .15s',
  letterSpacing: 0.2,
  whiteSpace: 'nowrap', overflow: 'hidden',
}

const Section = ({ children, collapsed }) => {
  if (collapsed) {
    // Em modo colapsado, vira só um divider sutil
    return (
      <div style={{
        margin: '12px 14px 4px 14px',
        height: 1, background: 'rgba(204,145,94,0.18)',
      }} />
    )
  }
  return (
    <div style={{
      fontSize: 9, fontWeight: 700, letterSpacing: 2.5, textTransform: 'uppercase',
      color: 'rgba(204,145,94,0.7)',
      padding: '18px 20px 6px 20px',
      fontFamily: 'var(--body)',
    }}>{children}</div>
  )
}

const ico = (children) => <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>{children}</svg>

const SCROLL_KEY = 'polimata_v2_sidebar_scroll'

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) === '1' } catch { return false }
  })
  const [cadAberto, setCadAberto] = useState(false)
  const scrollRef = useRef(null)

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0') } catch { /* noop */ }
  }, [collapsed])

  // Preserva scrollTop da sidebar entre navegações (cada page remonta Sidebar)
  useEffect(() => {
    if (!scrollRef.current) return
    try {
      const saved = sessionStorage.getItem(SCROLL_KEY)
      if (saved) scrollRef.current.scrollTop = parseInt(saved, 10) || 0
    } catch { /* noop */ }
    const el = scrollRef.current
    function onScroll() {
      try { sessionStorage.setItem(SCROLL_KEY, String(el.scrollTop)) } catch { /* noop */ }
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  const width = collapsed ? 56 : 240

  return (
    <nav style={{
      width, background: 'var(--navy)', color: 'var(--cream)',
      display: 'flex', flexDirection: 'column',
      borderRight: '1px solid var(--navy-mid)',
      flexShrink: 0,
      transition: 'width .2s',
      position: 'relative',
    }}>
      {/* Logo + toggle */}
      <div style={{
        padding: collapsed ? '16px 12px' : '20px 18px 16px 18px',
        borderBottom: '1px solid var(--navy-mid)',
        display: 'flex', alignItems: 'center', gap: 12, justifyContent: collapsed ? 'center' : 'flex-start',
      }}>
        <img src="/v2-assets/logo-polimata.png" alt="Polímata" style={{ width: 32, height: 45, flexShrink: 0 }} />
        {!collapsed && (
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'var(--display)', fontSize: 20, fontWeight: 300, color: 'var(--cream)', letterSpacing: 0.5, lineHeight: 1 }}>Polímata</div>
            <div style={{ fontFamily: 'var(--display)', fontSize: 8, fontWeight: 400, color: 'var(--gold)', letterSpacing: 2.5, textTransform: 'uppercase', marginTop: 3 }}>Consultoria em GRC</div>
          </div>
        )}
      </div>

      {/* Toggle button */}
      <button
        onClick={() => setCollapsed(c => !c)}
        title={collapsed ? 'Expandir sidebar' : 'Colapsar sidebar'}
        aria-label={collapsed ? 'Expandir' : 'Colapsar'}
        style={toggleBtn}
      >{collapsed ? '›' : '‹'}</button>

      {/* Navegação */}
      <div ref={scrollRef} className="scroll-sidebar" style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '8px 0' }}>
        <Section collapsed={collapsed}>Visão Geral</Section>
        <NavItem to="/dashboard" collapsed={collapsed} label="Início" icon={ico(<><path d="M3 12l9-9 9 9"/><path d="M5 10v10h14V10"/></>)} />

        <Section collapsed={collapsed}>No dia a dia</Section>
        <NavItem to="/receber" collapsed={collapsed} label="Contas a Receber" icon={ico(<><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></>)} />
        <NavItem to="/pagar" collapsed={collapsed} label="Contas a Pagar" icon={ico(<><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></>)} />
        <NavItem to="/conciliacao" collapsed={collapsed} label="Conciliação" icon={ico(<><circle cx="12" cy="12" r="9"/><polyline points="9 12 11 14 15 10"/></>)} />
        <NavItem to="/recorrencias" collapsed={collapsed} label="Recorrências" icon={ico(<><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></>)} />

        <Section collapsed={collapsed}>Análise &amp; Decisão</Section>
        <NavItem to="/fluxo-caixa" collapsed={collapsed} label="Fluxo de Caixa" icon={ico(<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>)} />
        <NavItem to="/dre" collapsed={collapsed} label="DRE Gerencial" icon={ico(<><line x1="3" y1="3" x2="3" y2="21"/><line x1="3" y1="21" x2="21" y2="21"/><polyline points="7 14 11 10 14 13 19 7"/></>)} />
        <NavItem to="/fechamento-mensal" collapsed={collapsed} label="Fechamento Mensal" icon={ico(<><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M9 16l2 2 4-4"/></>)} />
        <NavItem to="/relatorios" collapsed={collapsed} label="Exportar Relatório" icon={ico(<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></>)} />

        <Section collapsed={collapsed}>Fiscal</Section>
        <NavItem to="/importar-nfs" collapsed={collapsed} label="Importar NFs" icon={ico(<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></>)} />
        <NavItem to="/emitir-nf" collapsed={collapsed} label="Emitir NF" icon={ico(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></>)} />
        <NavItem to="/simples-nacional" collapsed={collapsed} label="Simples Nacional" icon={ico(<><circle cx="12" cy="12" r="10"/><path d="M9 12l2 2 4-4"/></>)} />

        {collapsed
          ? <Section collapsed={collapsed}>Cadastros</Section>
          : (
            <button type="button" onClick={() => setCadAberto(o => !o)} style={cadHeader} aria-expanded={cadAberto}>
              Cadastros
              <span style={{ marginLeft: 'auto', fontSize: 11, opacity: .8 }}>{cadAberto ? '▾' : '▸'}</span>
            </button>
          )}
        {(collapsed || cadAberto) && (
          <>
            <NavItem to="/clientes" collapsed={collapsed} label="Clientes" icon={ico(<><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>)} />
            <NavItem to="/fornecedores" collapsed={collapsed} label="Fornecedores" icon={ico(<><path d="M16 11V7a4 4 0 0 0-8 0v4"/><rect x="3" y="11" width="18" height="11" rx="2"/></>)} />
            <NavItem to="/funcionarios" collapsed={collapsed} label="Funcionários" icon={ico(<><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></>)} />
            <NavItem to="/orgaos-publicos" collapsed={collapsed} label="Órgãos Públicos" icon={ico(<><path d="M3 21h18"/><path d="M3 10h18"/><path d="M5 21V10l7-7 7 7v11"/></>)} />
            <NavItem to="/projetos" collapsed={collapsed} label="Projetos" icon={ico(<><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></>)} />
            <NavItem to="/contratos" collapsed={collapsed} label="Contratos" icon={ico(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></>)} />
            <NavItem to="/contas-bancarias" collapsed={collapsed} label="Contas Bancárias" icon={ico(<><path d="M3 21h18"/><polyline points="5 21 5 10 12 4 19 10 19 21"/></>)} />
            <NavItem to="/cartoes" collapsed={collapsed} label="Cartões" icon={ico(<><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></>)} />
            <NavItem to="/emprestimos" collapsed={collapsed} label="Empréstimos" icon={ico(<><path d="M12 2v6"/><path d="M9 19l3 3 3-3"/><path d="M5 12h14"/><circle cx="12" cy="12" r="10"/></>)} />
            <NavItem to="/conferencia-fatura" collapsed={collapsed} label="Conferência de Fatura" icon={ico(<><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="2" y1="9" x2="22" y2="9"/><circle cx="7" cy="14" r="1"/></>)} />
            <NavItem to="/importacoes" collapsed={collapsed} label="Importações" icon={ico(<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></>)} />
            <NavItem to="/nfse-config" collapsed={collapsed} label="Configurar NFS-e" icon={ico(<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>)} />
          </>
        )}
      </div>

      {/* Footer */}
      {!collapsed && (
        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--navy-mid)', fontSize: 9, color: 'rgba(243,238,228,0.4)', textAlign: 'center', letterSpacing: 1 }}>
          © 2026 Polímata GRC
        </div>
      )}
    </nav>
  )
}

const cadHeader = {
  display: 'flex', alignItems: 'center', width: '100%',
  background: 'none', border: 'none', cursor: 'pointer',
  fontSize: 9, fontWeight: 700, letterSpacing: 2.5, textTransform: 'uppercase',
  color: 'rgba(204,145,94,0.7)',
  padding: '18px 20px 6px 20px',
  fontFamily: 'var(--body)', textAlign: 'left',
}

const toggleBtn = {
  position: 'absolute', top: 22, right: -12,
  width: 24, height: 24, borderRadius: '50%',
  border: '1px solid var(--navy-mid)',
  background: 'var(--navy)',
  color: 'var(--cream)',
  cursor: 'pointer',
  fontSize: 14, fontWeight: 700,
  lineHeight: 1,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 5,
  fontFamily: 'monospace',
}
