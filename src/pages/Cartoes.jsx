import { Navigate } from 'react-router-dom'

// Cartões viraram contas (tipo 'cartao') na tela Contas e Cartões.
// A rota /cartoes fica só como redirecionamento pra links antigos.
export default function Cartoes() {
  return <Navigate to="/contas-bancarias" replace />
}
