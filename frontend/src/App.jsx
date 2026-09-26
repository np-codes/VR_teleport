import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { CallProvider } from './context/CallContext'
import ProtectedRoute from './components/ProtectedRoute'
import IncomingCallModal from './components/IncomingCallModal'
import Toast from './components/Toast'
import Login from './pages/Login'
import Home from './pages/Home'
import Call from './pages/Call'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <CallProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              path="/home"
              element={
                <ProtectedRoute>
                  <Home />
                </ProtectedRoute>
              }
            />
            <Route
              path="/call"
              element={
                <ProtectedRoute>
                  <Call />
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<Navigate to="/home" replace />} />
          </Routes>
          <IncomingCallModal />
          <Toast />
        </CallProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
