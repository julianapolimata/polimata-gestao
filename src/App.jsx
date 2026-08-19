import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import ErrorBoundary from './components/ErrorBoundary'
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
import EmConstrucaoModulo from './pages/EmConstrucaoModulo'
import Cartoes from './pages/Cartoes'
import ContasBancarias from './pages/ContasBancarias'
import Emprestimos from './pages/Emprestimos'
import Importacoes from './pages/Importacoes'
import ConferenciaFatura from './pages/ConferenciaFatura'
import { ToastContainer } from './components/Toast'
import FluxoCaixa from './pages/FluxoCaixa'
import DRE from './pages/DRE'
import Conciliacao from './pages/Conciliacao'
import ImportarNFs from './pages/ImportarNFs'
import SimplesNacional from './pages/SimplesNacional'
import NfseConfig from './pages/NfseConfig'
import Recorrencias from './pages/Recorrencias'
import Relatorios from './pages/Relatorios'
import FechamentoMensal from './pages/FechamentoMensal'

function RootRedirect() {
  const { user, loading } = useAuth()
  if (loading) return null
  return <Navigate to={user ? '/dashboard' : '/login'} replace />
}

export default function App() {
  return (
    <AuthProvider>
      <ToastContainer />
      <BrowserRouter>
        <ErrorBoundary>
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
          <Route path="/fluxo-caixa" element={<ProtectedRoute><FluxoCaixa /></ProtectedRoute>} />
          <Route path="/dre" element={<ProtectedRoute><DRE /></ProtectedRoute>} />
          <Route path="/fechamento-mensal" element={<ProtectedRoute><FechamentoMensal /></ProtectedRoute>} />
          <Route path="/conciliacao" element={<ProtectedRoute><Conciliacao /></ProtectedRoute>} />
          <Route path="/nfse-config" element={<ProtectedRoute><NfseConfig /></ProtectedRoute>} />
          <Route path="/emitir-nf" element={<ProtectedRoute><EmConstrucaoModulo titulo="Emitir NF" descricao="Emissão automática de NFS-e pela API Nacional. Em desenvolvimento." /></ProtectedRoute>} />
          <Route path="/simples-nacional" element={<ProtectedRoute><SimplesNacional /></ProtectedRoute>} />
          <Route path="/importar-nfs" element={<ProtectedRoute><ImportarNFs /></ProtectedRoute>} />
          <Route path="/recorrencias" element={<ProtectedRoute><Recorrencias /></ProtectedRoute>} />
          <Route path="/cartoes" element={<ProtectedRoute><Cartoes /></ProtectedRoute>} />
          <Route path="/contas-bancarias" element={<ProtectedRoute><ContasBancarias /></ProtectedRoute>} />
          <Route path="/emprestimos" element={<ProtectedRoute><Emprestimos /></ProtectedRoute>} />
          <Route path="/importacoes" element={<ProtectedRoute><Importacoes /></ProtectedRoute>} />
          <Route path="/conferencia-fatura" element={<ProtectedRoute><ConferenciaFatura /></ProtectedRoute>} />
          <Route path="/relatorios" element={<ProtectedRoute><Relatorios /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </ErrorBoundary>
      </BrowserRouter>
    </AuthProvider>
  )
}
