import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import EmConstrucao from './pages/EmConstrucao'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter basename="/v2">
        <Routes>
          <Route path="/" element={<EmConstrucao />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
