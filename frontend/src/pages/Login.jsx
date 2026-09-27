import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { APP_NAME, TAGLINE } from '../constants/callCopy'
import LoadingScreen from '../components/LoadingScreen'
import PortalRing from '../components/PortalRing'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'

export default function Login() {
  const { user, isLoading, login } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  if (isLoading) return <LoadingScreen />
  if (user) return <Navigate to="/home" replace />

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setIsSubmitting(true)
    try {
      await login(username, password)
      navigate('/home', { replace: true })
    } catch (err) {
      setError(err.message)
      setIsSubmitting(false)
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-12">
      <div className="w-full max-w-md">
        <header className="mb-10 flex flex-col items-center text-center">
          <PortalRing size={112} className="mb-8" />
          <h1 className="text-[2.6rem] font-semibold leading-none tracking-tight">{APP_NAME}</h1>
          <p className="mt-4 max-w-[26ch] text-lg leading-snug text-mist">{TAGLINE}</p>
        </header>

        <form onSubmit={handleSubmit} noValidate className="space-y-5 rounded-3xl border border-edge bg-hull p-7">
          <label className="block space-y-2">
            <span className="text-sm font-medium text-mist">Username</span>
            <Input
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck="false"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoFocus
              required
            />
          </label>
          <label className="block space-y-2">
            <span className="text-sm font-medium text-mist">Password</span>
            <Input
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>

          {error && (
            <p role="alert" className="rounded-2xl border border-danger/40 bg-danger/10 px-4 py-3 text-danger">
              {error}
            </p>
          )}

          <Button type="submit" variant="primary" size="lg" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Logging in…' : 'Log in'}
          </Button>
        </form>
      </div>
    </main>
  )
}
