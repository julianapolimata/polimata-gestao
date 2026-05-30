import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Login from './pages/Login'
import EsqueciSenha from './pages/EsqueciSenha'
import RedefinirSenha from './pages/RedefinirSenha'
import Dashboard from './pages/Dashboard'
import Receber from './pages/Receber'
import Pagar from './pages/Pagar'
import Pessoas from './pages/Pessoas'
import Catalogo from './pages/Catalogo'

function RootRedirect() {
  const { user, loading } = useAuth()
  if (loading) return null
  return <Navigate to={user ? '/dashboard' : '/login'} replace />
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter basename="/v2">
        <Routes>
          <Route path="/" element={<RootRedirect />} />
          <Route path="/login" element={<Login />} />
          <Route path="/esqueci-senha" element={<EsqueciSenha />} />
          <Route path="/redefinir-senha" element={<RedefinirSenha />} />
          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/receber" element={<ProtectedRoute><Receber /></ProtectedRoute>} />
          <Route path="/pagar" element={<ProtectedRoute><Pagar /></ProtectedRoute>} />
          <Route path="/fornecedores" element={<ProtectedRoute><Pessoas tipo="Fornecedor" titulo="Fornecedores" /></ProtectedRoute>} />
          <Route path="/clientes" element={<ProtectedRoute><Pessoas tipo="Cliente" titulo="Clientes" /></ProtectedRoute>} />
          <Route path="/funcionarios" element={<ProtectedRoute><Pessoas tipo="Funcionário" titulo="Funcionários" labelDoc="CPF" /></ProtectedRoute>} />
          <Route path="/orgaos-publicos" element={<ProtectedRoute><Pessoas tipo="Órgão Público" titulo="Órgãos Públicos" /></ProtectedRoute>} />
          <Route path="/projetos" element={<ProtectedRoute><Catalogo tabela="projects" titulo="Projetos" /></ProtectedRoute>} />
          <Route path="/contratos" element={<ProtectedRoute><Catalogo tabela="contracts" titulo="Contratos" /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
