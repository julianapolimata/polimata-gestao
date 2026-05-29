import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import EmConstrucao from './pages/EmConstrucao'
import Login from './pages/Login'

function RootRedirect() {
  const { user, loading } = useAuth()
  if (loading) return null
  // Se já logado, redireciona pro legado (até migrarmos as outras telas)
  if (user) {
    window.location.href = '/'
    return null
  }
  return <Navigate to="/login" replace />
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter basename="/v2">
        <Routes>
          <Route path="/" element={<RootRedirect />} />
          <Route path="/login" element={<Login />} />
          <Route path="/em-construcao" element={<EmConstrucao />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
