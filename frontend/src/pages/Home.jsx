import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useCall } from '../context/CallContext'
import { api } from '../services/api'
import { getSavedCameraId, listCameras, saveCameraId, stopStream } from '../services/media'
import Avatar from '../components/Avatar'
import '../styles/home.css'

// Label on the call button, depending on who is logged in.
const CALL_LABELS = {
  colson: 'Teleport',
  jenil: 'Summon',
}

function ContactCard({ contact, onCall, isBusy, callLabel }) {
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
        aria-label={contact.online ? `${callLabel} ${contact.name}` : `${contact.name} is offline`}
      >
        {contact.online ? callLabel : 'Offline'}
      </button>
    </li>
  )
}

function CameraPicker() {
  const [cameras, setCameras] = useState([])
  const [cameraId, setCameraId] = useState(getSavedCameraId)
  const [error, setError] = useState('')

  const refreshCameras = useCallback(() => {
    return listCameras()
      .then(setCameras)
      .catch(() => setError('Could not list cameras.'))
  }, [])

  useEffect(() => {
    listCameras()
      .then(setCameras)
      .catch(() => setError('Could not list cameras.'))
    navigator.mediaDevices?.addEventListener('devicechange', refreshCameras)
    return () => navigator.mediaDevices?.removeEventListener('devicechange', refreshCameras)
  }, [refreshCameras])

  // Browsers hide camera names until the page is allowed to use the camera.
  const needsPermission = cameras.length > 0 && cameras.every((camera) => !camera.label)

  async function askPermission() {
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true })
      stopStream(stream)
      await refreshCameras()
    } catch {
      setError('Camera access was blocked. Allow it in the browser settings.')
    }
  }

  function handleChange(event) {
    setCameraId(event.target.value)
    saveCameraId(event.target.value)
  }

  const savedCameraMissing = cameraId && !cameras.some((camera) => camera.deviceId === cameraId)

  return (
    <section className="card settings" aria-labelledby="camera-title">
      <h2 id="camera-title" className="section-title">
        Camera
      </h2>
      <label className="field">
        <span className="field__label">Camera used for calls</span>
        <select className="input" value={savedCameraMissing ? '' : cameraId} onChange={handleChange}>
          <option value="">Default camera</option>
          {cameras.map((camera, index) => (
            <option key={camera.deviceId || index} value={camera.deviceId}>
              {camera.label || `Camera ${index + 1}`}
            </option>
          ))}
        </select>
      </label>
      <p className="muted small">Pick your Insta360 EVO or OBS Virtual Camera for 360° / 3D video.</p>
      {needsPermission && (
        <button type="button" className="button button--secondary" onClick={askPermission}>
          Show camera names
        </button>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
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
              <ContactCard
                key={contact.id}
                contact={contact}
                onCall={startCall}
                isBusy={isBusy}
                callLabel={CALL_LABELS[user.id] ?? 'Call'}
              />
            ))}
          </ul>
        </section>

        <CameraPicker />
      </main>
    </div>
  )
}
