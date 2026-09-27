import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { Navigate } from 'react-router-dom'
import { useCall } from '../context/CallContext'
import { LAYOUT_NONE, isStereoLayout } from '../services/media'
import { xrStore } from '../services/xrStore'
import { useWebcams } from '../hooks/useWebcams'
import { Glasses, Mic, MicOff, PhoneOff, Radio, Video, VideoOff, X } from 'lucide-react'
import { OUTGOING_TEXT, spaceLabel } from '../constants/callCopy'
import { cn } from '../lib/utils'
import Avatar from '../components/Avatar'
import PortalRing from '../components/PortalRing'
import { Button } from '../components/ui/button'
import CameraSelect from '../components/CameraSelect'
import StreamVideo from '../components/StreamVideo'
import VRScene from '../components/VRScene'

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

const VIEWS = [
  { id: 'flat', label: 'Flat', description: 'Flat view' },
  { id: '180', label: '180°', description: '180 degree view' },
  { id: 'per-eye', label: 'Per-eye', description: 'Per-eye 3D view' },
]

// A labelled control-bar button (the label is always visible: no hover on Quest).
function ControlButton({ icon: Icon, label, pressed, className, ...props }) {
  return (
    <Button
      aria-pressed={pressed}
      className={cn('px-4', pressed && 'bg-starlight text-void hover:bg-white', className)}
      {...props}
    >
      <Icon aria-hidden="true" />
      <span>{label}</span>
    </Button>
  )
}

function InCall() {
  const {
    status,
    peer,
    mode,
    isCaller,
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
    isRelayed,
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
    <main className="fixed inset-0 overflow-hidden bg-black">
      {/* The 3D scene stays mounted so "Enter VR" always has a canvas. It renders in VR and for the
          180° / per-eye views; otherwise it's paused behind the flat video. */}
      <div className={cn('absolute inset-0 touch-none', shownView === '180' && 'cursor-grab active:cursor-grabbing')}>
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
          their audio: hidden in 180°, invisible (but still the texture source) in per-eye. */}
      <StreamVideo
        stream={remoteStream}
        layout={remoteLayout}
        fit="contain"
        className={cn('remote-video absolute inset-0 size-full', shownView === '180' && 'hidden', shownView === 'per-eye' && 'opacity-0')}
        label={`${peer.name}'s video`}
        onVideoElement={setRemoteVideoElement}
      />

      {(isConnecting || !hasRemoteVideo) && (
        <div role="status" className="absolute inset-0 flex flex-col items-center justify-center gap-6 bg-void">
          <PortalRing mode={mode} size={200} active={isConnecting}>
            <Avatar user={peer} size={104} />
          </PortalRing>
          <p className="text-xl font-medium">{isConnecting ? 'Opening the portal…' : `${peer.name} has no video`}</p>
        </div>
      )}

      {/* Top: whose space, who, and how long. */}
      <header className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-start justify-between gap-3 bg-gradient-to-b from-black/70 to-transparent p-4 pb-12 md:p-6">
        <div className="pointer-events-auto flex flex-wrap items-center gap-3">
          <span
            className={cn(
              'flex min-h-10 items-center gap-2 rounded-full border bg-hull px-4 text-sm font-semibold',
              mode === 'teleport' ? 'border-teleport/60 text-teleport' : 'border-summon/60 text-summon',
            )}
          >
            <span aria-hidden="true" className={cn('size-2 rounded-full', mode === 'teleport' ? 'bg-teleport' : 'bg-summon')} />
            {spaceLabel({ mode, isCaller, peerName: peer.name })}
          </span>
          <div>
            <h1 className="text-xl font-semibold leading-tight">{peer.name}</h1>
            <p className="text-sm tabular-nums text-mist">{isConnecting ? 'Connecting…' : formatDuration(seconds)}</p>
          </div>
        </div>
        {isRelayed && (
          <p className="pointer-events-auto flex min-h-10 items-center gap-2 rounded-full border border-edge bg-hull px-4 text-sm text-mist">
            <Radio className="size-4" aria-hidden="true" />
            Relayed through a TURN server; video may lag a little
          </p>
        )}
      </header>

      {shownView === '180' && !isInVR && (
        <p className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/60 px-4 py-2 text-sm">
          Drag to look around
        </p>
      )}

      {/* My own video, small, above the control bar. */}
      {hasLocalVideo ? (
        <StreamVideo
          stream={localStream}
          layout={localLayout}
          muted
          mirrored
          className={cn(
            'absolute right-4 top-28 aspect-video md:bottom-32 md:top-auto w-[clamp(120px,22vw,260px)] rounded-2xl border-2 border-white/20 md:right-6',
            isCameraOff && 'opacity-35',
          )}
          label="Your video"
        />
      ) : (
        <p className="absolute right-4 top-28 grid aspect-video md:bottom-32 md:top-auto w-[clamp(120px,22vw,260px)] place-items-center rounded-2xl border-2 border-white/15 bg-hull p-2 text-center text-sm text-mist md:right-6">
          {cameraProgress || 'Your camera is off'}
        </p>
      )}

      {/* Floating control bar. Solid background (no blur: expensive on Quest). */}
      <footer className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 p-3 md:p-5">
        {(vrError || mediaNotice) && (
          <p role="alert" className="max-w-2xl rounded-2xl border border-danger/40 bg-[#2a0d14] px-4 py-3 text-center text-danger">
            {vrError || mediaNotice}
          </p>
        )}
        <div className="flex max-w-full flex-wrap items-center justify-center gap-2 rounded-[2rem] border border-edge bg-hull p-2">
          <ControlButton icon={isMuted ? MicOff : Mic} label={isMuted ? 'Unmute' : 'Mute'} pressed={isMuted} onClick={toggleMute} />
          <ControlButton
            icon={isCameraOff ? VideoOff : Video}
            label={isCameraOff ? 'Camera on' : 'Camera off'}
            pressed={isCameraOff}
            onClick={toggleCamera}
            disabled={!hasLocalVideo}
          />
          <CameraSelect
            webcams={webcams}
            value={currentCamera}
            onChange={switchCamera}
            disabled={isConnecting || isSwitchingCamera || Boolean(cameraProgress)}
            className="w-56"
          />
          <div role="group" aria-label="View" className="flex rounded-full border border-edge bg-void p-1">
            {VIEWS.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={shownView === option.id}
                aria-label={option.description}
                onClick={() => setView(option.id)}
                disabled={option.id !== 'flat' && !hasRemoteVideo}
                className="min-h-11 rounded-full px-4 font-semibold text-mist transition-colors hover:text-starlight disabled:cursor-not-allowed disabled:opacity-40 aria-pressed:bg-starlight aria-pressed:text-void"
              >
                {option.label}
              </button>
            ))}
          </div>
          <Button
            variant="primary"
            className="px-6"
            onClick={enterVR}
            disabled={!isVRSupported}
            aria-describedby={isVRSupported ? undefined : 'vr-unavailable'}
          >
            <Glasses aria-hidden="true" />
            Enter VR
          </Button>
          <Button variant="danger" onClick={endCall}>
            <PhoneOff aria-hidden="true" />
            End call
          </Button>
        </div>
        {!isVRSupported && (
          <p id="vr-unavailable" className="text-sm text-mist">
            Enter VR works in a headset browser, like the Meta Quest browser.
          </p>
        )}
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
