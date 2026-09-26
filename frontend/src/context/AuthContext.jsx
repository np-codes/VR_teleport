import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api, clearToken, getToken, saveToken, setUnauthorizedHandler } from '../services/api'
import { connectSocket, disconnectSocket } from '../services/socket'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [token, setToken] = useState(null)
  const [socket, setSocket] = useState(null)
  // Only "loading" if there is a saved session to restore.
  const [isLoading, setIsLoading] = useState(() => Boolean(getToken()))

  const logout = useCallback(() => {
    disconnectSocket()
    clearToken()
    setSocket(null)
    setToken(null)
    setUser(null)
  }, [])

  const startSession = useCallback(
    (newToken, newUser) => {
      saveToken(newToken)
      const newSocket = connectSocket(newToken)
      newSocket.on('connect_error', (error) => {
        if (error.message === 'unauthorized') logout()
      })
      setToken(newToken)
      setUser(newUser)
      setSocket(newSocket)
    },
    [logout],
  )

  const login = useCallback(
    async (username, password) => {
      const data = await api('/api/auth/login', { method: 'POST', body: { username, password } })
      startSession(data.token, data.user)
      return data.user
    },
    [startSession],
  )

  useEffect(() => {
    setUnauthorizedHandler(logout)
  }, [logout])

  // Restore the session saved in this tab, if any.
  useEffect(() => {
    const savedToken = getToken()
    if (!savedToken) return

    let ignore = false
    api('/api/auth/me')
      .then((data) => {
        if (!ignore) startSession(savedToken, data.user)
      })
      .catch(() => {
        if (!ignore) logout()
      })
      .finally(() => {
        if (!ignore) setIsLoading(false)
      })

    return () => {
      ignore = true
    }
  }, [startSession, logout])

  const value = useMemo(
    () => ({ user, token, socket, isLoading, login, logout }),
    [user, token, socket, isLoading, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  return useContext(AuthContext)
}
