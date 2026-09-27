import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { Navigate } from 'react-router-dom'
import { useCall } from '../context/CallContext'
import { LAYOUT_NONE, isStereoLayout } from '../services/media'
import { xrStore } from '../services/xrStore'
import { useWebcams } from '../hooks/useWebcams'
import { X } from 'lucide-react'
import { OUTGOING_TEXT } from '../constants/callCopy'
import Avatar from '../components/Avatar'
import PortalRing from '../components/PortalRing'
import { Button } from '../components/ui/button'
import CameraSelect from '../components/CameraSelect'
import StreamVideo from '../components/StreamVideo'
import VRScene from '../components/VRScene'
import '../styles/call.css'

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

// True while an immersive VR session is running.
function useIsInVR() {
  return useSyncExternalStore(xrStore.subscribe, () => Boolean(xrStore.getState().session))
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

// Caller, while it rings: the other person inside a portal tinted by the mode.
function OutgoingCall({ peer, mode, isRinging, onCancel }) {
  return (
    <main className="fixed inset-0 flex flex-col items-center justify-center gap-10 bg-void px-6 text-center">
      <PortalRing mode={mode} size={260}>
        <Avatar user={peer} size={128} />
      </PortalRing>
      <div className="max-w-xl space-y-3">
        <h1 className="text-3xl font-semibold leading-tight tracking-tight md:text-4xl">{OUTGOING_TEXT[mode](peer.name)}</h1>
        <p role="status" className="text-lg text-mist">
          {isRinging ? `Waiting for ${peer.name} to answer` : 'Connecting to the server'}
        </p>
      </div>
      <Button variant="danger" size="lg" className="min-w-48" onClick={onCancel}>
        <X aria-hidden="true" />
        Cancel
      </Button>
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
    localLayout,
    remoteLayout,
    cameraProgress,
    mediaNotice,
    currentCamera,
    isSwitchingCamera,
    toggleMute,
    toggleCamera,
    switchCamera,
    endCall,
  } = useCall()
  // Listed again once a camera is open, because only then does the browser show camera names.
  const webcams = useWebcams(localLayout)
  const [view, setView] = useState('flat') // 'flat', '180' or 'per-eye'
  const [remoteVideoElement, setRemoteVideoElement] = useState(null)
  const exitPerEye = useCallback(() => setView('flat'), [])
  const [vrError, setVrError] = useState('')
  const isVRSupported = useVRSupported()
  const isInVR = useIsInVR()
  const seconds = useCallTimer(status === 'in-call')
  const isConnecting = status === 'connecting'
  const hasRemoteVideo = remoteLayout !== LAYOUT_NONE
  const hasLocalVideo = localLayout !== LAYOUT_NONE
  // 180° needs the other person's video; without it, stay flat.
  const shownView = hasRemoteVideo ? view : 'flat'

  // Leave VR when the call screen goes away (for example when the call ends).
  useEffect(() => () => xrStore.getState().session?.end(), [])

  async function enterVR() {
    setVrError('')
    try {
      await xrStore.enterVR()
    } catch (error) {
      console.error('[vr] Could not enter VR', error)
      setVrError('Could not start VR on this device.')
    }
  }

  return (
    <main className="call-stage">
      {/* The 3D scene stays mounted so "Enter VR" always has a canvas. It renders in VR and for the
          180° view; otherwise it's paused behind the flat video. */}
      <div className="call-stage__scene">
        <VRScene
          stream={remoteStream}
          showVideo={hasRemoteVideo}
          isStereo={isStereoLayout(remoteLayout)}
          view={shownView}
          isInVR={isInVR}
          isActive={isInVR || shownView !== 'flat'}
          onEndCall={endCall}
          videoElement={remoteVideoElement}
          onPerEyeExit={exitPerEye}
        />
      </div>

      {/* Flat view: the other person's video (only the left eye of a 3D video). It always plays
          their audio, even while hidden in the 180° view. */}
      <StreamVideo
        stream={remoteStream}
        layout={remoteLayout}
        fit="contain"
        className={`call-stage__remote ${shownView === '180' ? 'is-hidden' : ''} ${shownView === 'per-eye' ? 'is-behind' : ''}`}
        label={`${peer.name}'s video`}
        onVideoElement={setRemoteVideoElement}
      />

      {(isConnecting || !hasRemoteVideo) && (
        <div className="call-connecting" role="status">
          <Avatar user={peer} size={96} />
          <p>{isConnecting ? 'Connecting…' : 'No video'}</p>
        </div>
      )}

      <header className="call-top">
        <div>
          <h1 className="call-top__name">{peer.name}</h1>
          <p className="call-top__timer">{isConnecting ? 'Connecting…' : formatDuration(seconds)}</p>
        </div>
        <div className="call-top__tools">
          <label>
            <span className="visually-hidden">Camera</span>
            <CameraSelect
              webcams={webcams}
              value={currentCamera}
              onChange={switchCamera}
              disabled={isConnecting || isSwitchingCamera || Boolean(cameraProgress)}
              className="call-camera__select"
            />
          </label>
          <div className="segmented" role="group" aria-label="View">
            <button
              type="button"
              className="segmented__option"
              aria-pressed={shownView === 'flat'}
              onClick={() => setView('flat')}
            >
              Flat
            </button>
            <button
              type="button"
              className="segmented__option"
              aria-pressed={shownView === '180'}
              aria-label="180 degree view"
              onClick={() => setView('180')}
              disabled={!hasRemoteVideo}
              title={hasRemoteVideo ? undefined : "Available once the other person's video arrives"}
            >
              180°
            </button>
            <button
              type="button"
              className="segmented__option"
              aria-pressed={shownView === 'per-eye'}
              aria-label="Per-eye 3D test view"
              onClick={() => setView('per-eye')}
              disabled={!hasRemoteVideo}
            >
              Per-eye
            </button>
          </div>
        </div>
      </header>

      {shownView === '180' && !isInVR && <p className="call-hint">Drag to look around</p>}

      {hasLocalVideo ? (
        <StreamVideo
          stream={localStream}
          layout={localLayout}
          muted
          mirrored
          className={`call-self ${isCameraOff ? 'is-off' : ''}`}
          label="Your video"
        />
      ) : (
        <p className="call-self call-self--empty">{cameraProgress || 'No video'}</p>
      )}

      <footer className="call-controls">
        {(vrError || mediaNotice) && (
          <p className="call-controls__error" role="alert">
            {vrError || mediaNotice}
          </p>
        )}
        <div className="call-controls__row">
          <button type="button" className="control" aria-pressed={isMuted} onClick={toggleMute}>
            <Icon path={isMuted ? ICONS.micOff : ICONS.mic} />
            <span>{isMuted ? 'Unmute' : 'Mute'}</span>
          </button>
          <button
            type="button"
            className="control"
            aria-pressed={isCameraOff}
            onClick={toggleCamera}
            disabled={!hasLocalVideo}
          >
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
  const { status, peer, mode, isRinging, cancelCall } = useCall()

  if (status === 'outgoing') return <OutgoingCall peer={peer} mode={mode} isRinging={isRinging} onCancel={cancelCall} />
  if (status === 'connecting' || status === 'in-call') return <InCall />
  return <Navigate to="/home" replace />
}
