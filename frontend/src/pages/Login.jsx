import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import LoadingScreen from '../components/LoadingScreen'
import '../styles/login.css'

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
    <main className="page page--center">
      <form className="card login-card" onSubmit={handleSubmit} noValidate>
        <div className="login-card__brand">
          <img src="/favicon.svg" alt="" width="56" height="56" />
          <h1>VR Call</h1>
          <p className="muted">Video calls you can step into.</p>
        </div>

        <label className="field">
          <span className="field__label">Username</span>
          <input
            className="input"
            type="text"
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

        <label className="field">
          <span className="field__label">Password</span>
          <input
            className="input"
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="button button--primary button--block" disabled={isSubmitting}>
          {isSubmitting ? 'Logging in…' : 'Log in'}
        </button>
      </form>
    </main>
  )
}
