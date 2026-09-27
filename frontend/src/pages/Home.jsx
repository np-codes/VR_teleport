import { useEffect, useState } from 'react'
import { LogOut, Magnet, Orbit, Users } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useCall } from '../context/CallContext'
import { api } from '../services/api'
import { getSavedCamera, saveCamera } from '../services/media'
import { useWebcams } from '../hooks/useWebcams'
import { ACTIONS, APP_NAME, MODE_SUMMON, MODE_TELEPORT } from '../constants/callCopy'
import Avatar from '../components/Avatar'
import CameraSelect from '../components/CameraSelect'
import PortalRing from '../components/PortalRing'
import { Button } from '../components/ui/button'

const ACTION_ICONS = { [MODE_SUMMON]: Magnet, [MODE_TELEPORT]: Orbit }

// Summon or Teleport, with its one-line meaning under the label (no hover needed on Quest).
function ModeButton({ mode, contact, disabled, onStart }) {
  const Icon = ACTION_ICONS[mode]
  const { label, hint } = ACTIONS[mode]
  return (
    <Button
      variant={mode}
      size="lg"
      className="h-auto flex-1 flex-col gap-0 whitespace-normal py-2.5 leading-tight"
      disabled={disabled}
      onClick={() => onStart(contact, mode)}
      aria-label={`${label} ${contact.name}: ${hint.toLowerCase()}`}
    >
      <span className="flex items-center gap-2">
        <Icon aria-hidden="true" />
        {label}
      </span>
      <span className="text-sm font-medium opacity-75">{hint}</span>
    </Button>
  )
}

function ContactRow({ contact, isBusy, onStart }) {
  const disabled = !contact.online || isBusy
  return (
    <li className="flex flex-col gap-5 rounded-3xl border border-edge bg-hull p-5 md:flex-row md:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <span className="relative">
          <Avatar user={contact} size={56} />
          <span
            aria-hidden="true"
            className={`absolute bottom-0 right-0 size-4 rounded-full ring-4 ring-hull ${contact.online ? 'bg-online' : 'bg-mist/40'}`}
          />
        </span>
        <div className="min-w-0">
          <p className="truncate text-xl font-semibold">{contact.name}</p>
          <p className={`text-sm ${contact.online ? 'text-online' : 'text-mist'}`}>{contact.online ? 'Online' : 'Offline'}</p>
        </div>
      </div>
      <div className="flex flex-col gap-3 min-[480px]:flex-row md:w-[25rem]">
        <ModeButton mode={MODE_SUMMON} contact={contact} disabled={disabled} onStart={onStart} />
        <ModeButton mode={MODE_TELEPORT} contact={contact} disabled={disabled} onStart={onStart} />
      </div>
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
    <section aria-labelledby="camera-title" className="rounded-3xl border border-edge bg-hull p-5">
      <h2 id="camera-title" className="text-lg font-semibold">
        Camera
      </h2>
      <p className="mb-4 mt-1 text-sm text-mist">It turns on only after a call is accepted. You can change it during the call too.</p>
      <CameraSelect webcams={webcams} value={camera} onChange={handleChange} disabled={disabled} className="md:max-w-sm" />
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
  const nobodyOnline = !isLoading && contacts.length > 0 && contacts.every((contact) => !contact.online)

  return (
    <div className="mx-auto min-h-dvh max-w-3xl px-4 pb-16 md:px-6">
      <header className="flex items-center justify-between gap-4 py-6">
        <div className="flex items-center gap-3">
          <PortalRing size={34} active={false} />
          <span className="hidden text-lg font-semibold tracking-tight min-[480px]:inline">{APP_NAME}</span>
        </div>
        <div className="flex items-center gap-3">
          <Avatar user={user} size={40} />
          <span className="hidden font-medium md:inline">{user.name}</span>
          <Button variant="ghost" onClick={logout}>
            <LogOut aria-hidden="true" />
            Log out
          </Button>
        </div>
      </header>

      <main className="space-y-8 pt-6">
        <section aria-labelledby="people-title">
          <h1 id="people-title" className="text-3xl font-semibold tracking-tight md:text-4xl">
            Hi, {user.name}
          </h1>
          <p className="mt-3 max-w-[52ch] text-mist">Summon brings someone into your space. Teleport takes you into theirs.</p>

          {isLoading && <p className="mt-8 text-mist">Loading people…</p>}
          {error && (
            <p role="alert" className="mt-8 rounded-2xl border border-danger/40 bg-danger/10 px-4 py-3 text-danger">
              {error}
            </p>
          )}
          {!isLoading && !error && contacts.length === 0 && (
            <p className="mt-8 rounded-3xl border border-dashed border-edge p-6 text-mist">No one has been added yet.</p>
          )}
          {nobodyOnline && (
            <div role="status" className="mt-8 flex items-start gap-3 rounded-3xl border border-dashed border-edge p-5">
              <Users className="mt-0.5 size-5 shrink-0 text-mist" aria-hidden="true" />
              <p className="text-mist">No one is online right now. Summon and Teleport switch on as soon as someone logs in.</p>
            </div>
          )}

          <ul className="mt-6 space-y-4">
            {contacts.map((contact) => (
              <ContactRow key={contact.id} contact={contact} isBusy={isBusy} onStart={startCall} />
            ))}
          </ul>
        </section>

        <CameraOption disabled={isBusy} />
      </main>
    </div>
  )
}
