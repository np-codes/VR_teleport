import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useCall } from '../context/CallContext'
import { api } from '../services/api'
import { getSavedCamera, saveCamera } from '../services/media'
import { useWebcams } from '../hooks/useWebcams'
import Avatar from '../components/Avatar'
import CameraSelect from '../components/CameraSelect'
import '../styles/home.css'

function ContactCard({ contact, onCall, isBusy }) {
  return (
    <li className="contact card">
      <span className="contact__avatar">
        <Avatar user={contact} size={56} />
        <span className={`status-dot ${contact.online ? 'status-dot--online' : ''}`} aria-hidden="true" />
      </span>
      <span className="contact__info">
        <span className="contact__name">{contact.name}</span>
        <span className="muted">{contact.online ? 'Online' : 'Offline'}</span>
      </span>
      <button
        type="button"
        className="button button--primary"
        onClick={() => onCall(contact)}
        disabled={!contact.online || isBusy}
        aria-label={contact.online ? `Call ${contact.name}` : `${contact.name} is offline`}
      >
        {contact.online ? 'Call' : 'Offline'}
      </button>
    </li>
  )
}

// Chosen before a call (it can also be changed during the call). The camera itself only turns
// on after a call is accepted; there is no test or preview here.
function CameraOption({ disabled }) {
  const [camera, setCamera] = useState(getSavedCamera)
  const webcams = useWebcams()

  function handleChange(value) {
    setCamera(value)
    saveCamera(value)
  }

  return (
    <section className="card camera-option">
      <label className="field">
        <span className="section-title">Camera</span>
        <CameraSelect webcams={webcams} value={camera} onChange={handleChange} disabled={disabled} />
      </label>
      <p className="muted small">
        The camera turns on only after a call is accepted. You can also change it during the call.
      </p>
    </section>
  )
}

export default function Home() {
  const { user, socket, logout } = useAuth()
  const { status, startCall } = useCall()
  const [contacts, setContacts] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!socket) return

    const loadContacts = () => {
      api('/api/contacts')
        .then((data) => {
          setContacts(data.contacts)
          setError('')
        })
        .catch((err) => setError(err.message))
        .finally(() => setIsLoading(false))
    }

    const handlePresence = ({ userId, online }) => {
      setContacts((current) => current.map((contact) => (contact.id === userId ? { ...contact, online } : contact)))
    }

    loadContacts()
    socket.on('connect', loadContacts)
    socket.on('presence', handlePresence)
    return () => {
      socket.off('connect', loadContacts)
      socket.off('presence', handlePresence)
    }
  }, [socket])

  const isBusy = status !== 'idle' && status !== 'ended'

  return (
    <div className="page">
      <header className="topbar">
        <div className="topbar__user">
          <Avatar user={user} size={44} />
          <span className="topbar__greeting">Hi, {user.name}</span>
        </div>
        <button type="button" className="button button--ghost" onClick={logout}>
          Log out
        </button>
      </header>

      <main className="home">
        <section aria-labelledby="contacts-title">
          <h1 id="contacts-title" className="section-title">
            Contacts
          </h1>
          {isLoading && <p className="muted">Loading contacts…</p>}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {!isLoading && !error && contacts.length === 0 && <p className="muted">No contacts yet.</p>}
          <ul className="contact-list">
            {contacts.map((contact) => (
              <ContactCard key={contact.id} contact={contact} onCall={startCall} isBusy={isBusy} />
            ))}
          </ul>
        </section>

        <CameraOption disabled={isBusy} />
      </main>
    </div>
  )
}
