import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--cream)' }}>
        <div style={{ fontFamily: 'var(--display)', fontWeight: 300, color: 'var(--navy)', letterSpacing: 2 }}>Carregando…</div>
      </div>
    )
  }
  if (!user) return <Navigate to="/login" replace />
  return children
}
