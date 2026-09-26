import { useEffect, useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useCall } from '../context/CallContext'
import { xrStore } from '../services/xrStore'
import Avatar from '../components/Avatar'
import VRScene from '../components/VRScene'
import '../styles/call.css'

const VIEWS = [
  { id: 'flat', label: 'Flat', description: 'Normal flat video' },
  { id: '360', label: '360°', description: '360° video' },
  { id: '180', label: '180° 3D', description: '180° 3D side by side video' },
]

function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function useCallTimer(isRunning) {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (!isRunning) return
    const startedAt = Date.now()
    const interval = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    return () => clearInterval(interval)
  }, [isRunning])
  return seconds
}

function useVRSupported() {
  const [isSupported, setIsSupported] = useState(false)
  useEffect(() => {
    let ignore = false
    navigator.xr
      ?.isSessionSupported('immersive-vr')
      .then((supported) => {
        if (!ignore) setIsSupported(supported)
      })
      .catch(() => {})
    return () => {
      ignore = true
    }
  }, [])
  return isSupported
}

function StreamVideo({ stream, ...props }) {
  const videoRef = useRef(null)
  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream
  }, [stream])
  return <video ref={videoRef} autoPlay playsInline {...props} />
}

function Icon({ path }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={path} />
    </svg>
  )
}

const ICONS = {
  mic: 'M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11z',
  micOff:
    'M19 11a7 7 0 0 1-1.2 3.9l-1.45-1.45A5 5 0 0 0 17 11zM15 11V5a3 3 0 0 0-5.94-.6L15 10.34zM4.27 3 3 4.27l6 6V11a3 3 0 0 0 4.52 2.59l1.46 1.46A5 5 0 0 1 7 11H5a7 7 0 0 0 6 6.92V21h2v-3.08a6.9 6.9 0 0 0 3.4-1.33L19.73 21 21 19.73z',
  camera: 'M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11z',
  cameraOff:
    'M21 6.5l-4 4V7a1 1 0 0 0-1-1H9.82L21 17.18zM3.27 2 2 3.27 4.73 6H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12c.21 0 .39-.08.55-.18L19.73 21 21 19.73z',
  vr: 'M20.7 6H3.3C2.6 6 2 6.6 2 7.3v9.4c0 .7.6 1.3 1.3 1.3h4.8l1.9-2.7c.5-.7 1.2-1.1 2-1.1s1.5.4 2 1.1l1.9 2.7h4.8c.7 0 1.3-.6 1.3-1.3V7.3C22 6.6 21.4 6 20.7 6zM7.5 13.5a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm9 0a2 2 0 1 1 0-4 2 2 0 0 1 0 4z',
  hangUp:
    'M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85a.99.99 0 0 1-1.41-.01L.29 13.08a1 1 0 0 1 0-1.41C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67a1 1 0 0 1 0 1.41l-2.48 2.48a1 1 0 0 1-1.41.01 11.1 11.1 0 0 0-2.66-1.85 1 1 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z',
}

function OutgoingCall({ peer, isRinging, onCancel }) {
  return (
    <main className="page page--center">
      <div className="card outgoing">
        <div className="pulse-avatar">
          <Avatar user={peer} size={112} />
        </div>
        <h1 className="outgoing__title">Calling {peer.name}…</h1>
        <p className="muted" role="status">
          {isRinging ? 'Ringing…' : 'Starting your camera…'}
        </p>
        <button type="button" className="button button--danger button--wide" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </main>
  )
}

function InCall() {
  const {
    status,
    peer,
    localStream,
    remoteStream,
    isMuted,
    isCameraOff,
    toggleMute,
    toggleCamera,
    endCall,
  } = useCall()
  const [view, setView] = useState('flat')
  const [isRemotePlaying, setIsRemotePlaying] = useState(false)
  const [vrError, setVrError] = useState('')
  const isVRSupported = useVRSupported()
  const seconds = useCallTimer(status === 'in-call')
  const isConnecting = status === 'connecting' || !isRemotePlaying

  // Leave VR when the call screen goes away (for example when the call ends).
  useEffect(() => () => xrStore.getState().session?.end(), [])

  async function enterVR() {
    setVrError('')
    if (view === 'flat') setView('360')
    try {
      await xrStore.enterVR()
    } catch (error) {
      console.error('[vr] Could not enter VR', error)
      setVrError('Could not start VR on this device.')
    }
  }

  return (
    <main className="call-stage">
      {/* The 3D scene stays mounted so "Enter VR" always has a canvas to use. */}
      <div className="call-stage__scene">
        <VRScene stream={remoteStream} mode={view} isActive={view !== 'flat'} onEndCall={endCall} />
      </div>

      {/* The flat video also plays the other person's audio, even when hidden. */}
      <StreamVideo
        stream={remoteStream}
        className={`call-stage__remote ${view === 'flat' ? '' : 'is-hidden'}`}
        onPlaying={() => setIsRemotePlaying(true)}
        aria-label={`${peer.name}'s video`}
      />

      {isConnecting && (
        <div className="call-connecting" role="status">
          <Avatar user={peer} size={96} />
          <p>Connecting…</p>
        </div>
      )}

      <header className="call-top">
        <div>
          <h1 className="call-top__name">{peer.name}</h1>
          <p className="call-top__timer">{isConnecting ? 'Connecting…' : formatDuration(seconds)}</p>
        </div>
        <div className="segmented" role="group" aria-label="Video type">
          {VIEWS.map((option) => (
            <button
              key={option.id}
              type="button"
              className="segmented__option"
              aria-pressed={view === option.id}
              aria-label={option.description}
              onClick={() => setView(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>

      {view !== 'flat' && <p className="call-hint">Drag to look around</p>}

      <StreamVideo
        stream={localStream}
        muted
        className={`call-self ${isCameraOff ? 'is-off' : ''}`}
        aria-label="Your video"
      />

      <footer className="call-controls">
        {vrError && (
          <p className="call-controls__error" role="alert">
            {vrError}
          </p>
        )}
        <div className="call-controls__row">
          <button type="button" className="control" aria-pressed={isMuted} onClick={toggleMute}>
            <Icon path={isMuted ? ICONS.micOff : ICONS.mic} />
            <span>{isMuted ? 'Unmute' : 'Mute'}</span>
          </button>
          <button type="button" className="control" aria-pressed={isCameraOff} onClick={toggleCamera}>
            <Icon path={isCameraOff ? ICONS.cameraOff : ICONS.camera} />
            <span>{isCameraOff ? 'Camera on' : 'Camera off'}</span>
          </button>
          <button
            type="button"
            className="control"
            onClick={enterVR}
            disabled={!isVRSupported}
            title={isVRSupported ? undefined : 'Open this page in a VR headset browser to use VR'}
          >
            <Icon path={ICONS.vr} />
            <span>Enter VR</span>
          </button>
          <button type="button" className="control control--danger" onClick={endCall}>
            <Icon path={ICONS.hangUp} />
            <span>End call</span>
          </button>
        </div>
      </footer>
    </main>
  )
}

export default function Call() {
  const { status, peer, isRinging, cancelCall } = useCall()

  if (status === 'outgoing') return <OutgoingCall peer={peer} isRinging={isRinging} onCancel={cancelCall} />
  if (status === 'connecting' || status === 'in-call') return <InCall />
  return <Navigate to="/home" replace />
}
