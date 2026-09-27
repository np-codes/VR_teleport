import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../services/api'
import {
  CAMERA_3D,
  LAYOUT_MONO,
  LAYOUT_NONE,
  LAYOUT_STEREO,
  cameraErrorMessage,
  getMicrophone,
  getSavedCamera,
  isStereoLayout,
  microphoneErrorMessage,
  openCamera3dTrack,
  openNormalCameraTrack,
  saveCamera,
  stopCamera3d,
  stopStream,
} from '../services/media'
import { useAuth } from './AuthContext'
import { MODE_SUMMON, toCallMode } from '../constants/callCopy'

const CALL_TIMEOUT_MS = 30_000
const TOAST_DURATION_MS = 4000
const FALLBACK_ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }]


// mode: 'summon' | 'teleport' (see constants/callCopy.js). isCaller: I started the call.
const initialState = { status: 'idle', peer: null, mode: null, isCaller: false, isRinging: false, message: '' }

function callReducer(state, action) {
  const isFree = state.status === 'idle' || state.status === 'ended'

  switch (action.type) {
    case 'START_OUTGOING':
      return isFree
        ? { ...initialState, status: 'outgoing', peer: action.peer, mode: action.mode, isCaller: true }
        : state
    case 'INCOMING':
      return isFree ? { ...initialState, status: 'incoming', peer: action.peer, mode: action.mode } : state
    case 'RINGING':
      return state.status === 'outgoing' ? { ...state, isRinging: true } : state
    case 'ACCEPTED':
      return state.status === 'outgoing' || state.status === 'incoming'
        ? { ...state, status: 'connecting' }
        : state
    case 'CONNECTED':
      return state.status === 'connecting' ? { ...state, status: 'in-call' } : state
    case 'ENDED':
      return isFree ? state : { ...initialState, status: 'ended', peer: state.peer, message: action.message }
    case 'RESET':
      return state.status === 'ended' ? initialState : state
    default:
      return state
  }
}

const toLayout = (value) => ([LAYOUT_STEREO, LAYOUT_MONO].includes(value) ? value : LAYOUT_NONE)

// The video "slot" of the call. It exists from the start (empty), so the camera can be put in
// later without renegotiating.
function videoTransceiver(pc) {
  return pc?.getTransceivers().find((transceiver) => transceiver.receiver.track?.kind === 'video') ?? null
}

// A 2560-wide stereo frame should stay sharp: drop frame rate rather than resolution.
function keepResolution(sender) {
  const params = sender.getParameters()
  params.degradationPreference = 'maintain-resolution'
  sender.setParameters(params).catch(() => {})
}

const CallContext = createContext(null)

export function CallProvider({ children }) {
  const { socket } = useAuth()
  const navigate = useNavigate()
  const [state, dispatch] = useReducer(callReducer, initialState)
  const [localStream, setLocalStream] = useState(null)
  const [remoteStream, setRemoteStream] = useState(null)
  const [isMuted, setIsMuted] = useState(false)
  const [isCameraOff, setIsCameraOff] = useState(false)
  // "none" (no video yet), "mono" (normal webcam) or "stereo-sbs" (3D camera: left eye | right
  // eye), mine and the other person's.
  const [localLayout, setLocalLayout] = useState(LAYOUT_NONE)
  const [remoteLayout, setRemoteLayout] = useState(LAYOUT_NONE)
  const [cameraProgress, setCameraProgress] = useState('')
  // The camera in use in this call ('' default webcam, a deviceId, or the 3D camera).
  const [currentCamera, setCurrentCamera] = useState('')
  const [isSwitchingCamera, setIsSwitchingCamera] = useState(false)
  const [mediaNotice, setMediaNotice] = useState('')

  // Refs hold the live call objects so socket handlers always see current values.
  const peerRef = useRef(null) // { id, name } of the other person, or null when free
  const pcRef = useRef(null)
  const localStreamRef = useRef(null)
  const localVideoTrackRef = useRef(null)
  const localLayoutRef = useRef(LAYOUT_NONE)
  const isCameraOffRef = useRef(false)
  const currentCameraRef = useRef('')
  const isSwitchingRef = useRef(false)
  const pendingCandidatesRef = useRef([])
  const pendingOfferRef = useRef(null)
  const iceServersRef = useRef(null)
  const timeoutRef = useRef(null)

  // Stops everything: tracks, peer connection, timers. (The backend turns the 3D camera off
  // itself when the call ends.)
  const cleanup = useCallback(() => {
    clearTimeout(timeoutRef.current)
    const pc = pcRef.current
    if (pc) {
      pc.onicecandidate = null
      pc.ontrack = null
      pc.onconnectionstatechange = null
      pc.close()
    }
    pcRef.current = null
    stopStream(localStreamRef.current)
    localStreamRef.current = null
    localVideoTrackRef.current?.stop()
    localVideoTrackRef.current = null
    localLayoutRef.current = LAYOUT_NONE
    isCameraOffRef.current = false
    currentCameraRef.current = ''
    isSwitchingRef.current = false
    pendingCandidatesRef.current = []
    pendingOfferRef.current = null
    iceServersRef.current = null
    peerRef.current = null
    setLocalStream(null)
    setRemoteStream(null)
    setIsMuted(false)
    setIsCameraOff(false)
    setLocalLayout(LAYOUT_NONE)
    setRemoteLayout(LAYOUT_NONE)
    setCameraProgress('')
    setMediaNotice('')
    setCurrentCamera('')
    setIsSwitchingCamera(false)
  }, [])

  const finishCall = useCallback(
    (message) => {
      if (!peerRef.current) return
      console.log(`[call] ${message}`)
      cleanup()
      dispatch({ type: 'ENDED', message })
    },
    [cleanup],
  )

  const sendToPeer = useCallback(
    (event, data = {}) => {
      if (socket && peerRef.current) socket.emit(event, { ...data, to: peerRef.current.id })
    },
    [socket],
  )

  const getIceServers = useCallback(() => {
    if (!iceServersRef.current) {
      iceServersRef.current = api('/api/ice-servers')
        .then((data) => data.iceServers)
        .catch(() => FALLBACK_ICE_SERVERS)
    }
    return iceServersRef.current
  }, [])

  // The microphone opens after the call is accepted. Without one the call still goes ahead.
  const openMicrophone = useCallback(async (peer) => {
    let stream
    try {
      stream = await getMicrophone()
    } catch (error) {
      setMediaNotice(microphoneErrorMessage(error))
      stream = new MediaStream()
    }
    if (peerRef.current !== peer) {
      stopStream(stream)
      return false
    }
    localStreamRef.current = stream
    setLocalStream(stream)
    return true
  }, [])

  const createPeerConnection = useCallback(
    (iceServers, { addVideoSlot }) => {
      const pc = new RTCPeerConnection({ iceServers })
      const stream = localStreamRef.current
      stream?.getAudioTracks().forEach((track) => pc.addTrack(track, stream))
      // Caller: an empty video slot, filled when my camera is ready. (The callee gets its
      // slot from the caller's offer.)
      if (addVideoSlot) pc.addTransceiver('video', { direction: 'sendrecv' })

      pc.onicecandidate = (event) => {
        if (event.candidate) sendToPeer('webrtc:ice-candidate', { candidate: event.candidate.toJSON() })
      }
      // Collect the other person's audio and video into one stream for the page.
      pc.ontrack = (event) => {
        setRemoteStream((current) => new MediaStream([...(current?.getTracks() ?? []), event.track]))
      }
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') dispatch({ type: 'CONNECTED' })
        if (pc.connectionState === 'failed') {
          sendToPeer('call:end', { reason: 'failed' })
          finishCall('Connection failed. Please try again.')
        }
      }

      pcRef.current = pc
      return pc
    },
    [sendToPeer, finishCall],
  )

  const addPendingCandidates = useCallback(async (pc) => {
    const candidates = pendingCandidatesRef.current
    pendingCandidatesRef.current = []
    for (const candidate of candidates) {
      await pc.addIceCandidate(candidate).catch((error) => console.warn('[webrtc] Bad ICE candidate', error))
    }
  }, [])

  // Puts my current camera (or no video) into the call's video slot, once the slot exists.
  const attachVideo = useCallback(async () => {
    const track = localVideoTrackRef.current
    const transceiver = videoTransceiver(pcRef.current)
    if (!transceiver) return
    if (track) transceiver.direction = 'sendrecv'
    await transceiver.sender.replaceTrack(track)
    if (track && isStereoLayout(localLayoutRef.current)) keepResolution(transceiver.sender)
    sendToPeer('call:layout', { layout: track ? localLayoutRef.current : LAYOUT_NONE })
  }, [sendToPeer])

  // Makes `track` my video (null = no video): shows it on my tile and sends it in the call.
  const setVideoTrack = useCallback(
    async (track, layout) => {
      if (track) track.enabled = !isCameraOffRef.current
      localVideoTrackRef.current = track
      localLayoutRef.current = track ? layout : LAYOUT_NONE
      const audio = localStreamRef.current?.getAudioTracks() ?? []
      const stream = new MediaStream(track ? [...audio, track] : audio)
      localStreamRef.current = stream
      setLocalStream(stream)
      setLocalLayout(localLayoutRef.current)
      await attachVideo()
    },
    [attachVideo],
  )

  // Opens a camera: the 3D camera (may take a while) or a normal webcam. Returns the track, or
  // null (with a notice) if it isn't available. Never ends the call.
  const openCamera = useCallback(async (camera, isCancelled) => {
    const is3d = camera === CAMERA_3D
    try {
      const track = is3d
        ? await openCamera3dTrack({ onProgress: setCameraProgress, shouldCancel: isCancelled })
        : await openNormalCameraTrack(camera)
      if (isCancelled()) {
        track?.stop()
        return null
      }
      if (!track) setMediaNotice(is3d ? 'There is no 3D camera on this device.' : 'No camera was found.')
      return track
    } catch (error) {
      if (error.name !== 'AbortError' && !isCancelled()) {
        setMediaNotice(is3d ? `3D camera: ${error.message}` : cameraErrorMessage(error))
      }
      return null
    }
  }, [])

  // Runs in the background after the call is connected, with the camera chosen on Home.
  // A missing or failing camera never ends the call; it continues without my video.
  const startVideo = useCallback(
    async (peer) => {
      const camera = getSavedCamera()
      currentCameraRef.current = camera
      setCurrentCamera(camera)
      const track = await openCamera(camera, () => peerRef.current !== peer)
      if (track) await setVideoTrack(track, camera === CAMERA_3D ? LAYOUT_STEREO : LAYOUT_MONO)
    },
    [openCamera, setVideoTrack],
  )

  // Switches the camera during the call without reconnecting (the video slot gets a new track).
  const switchCamera = useCallback(
    async (camera) => {
      const peer = peerRef.current
      const previous = currentCameraRef.current
      if (!peer || isSwitchingRef.current || camera === previous) return
      const isCancelled = () => peerRef.current !== peer
      isSwitchingRef.current = true
      setIsSwitchingCamera(true)
      setMediaNotice('')
      currentCameraRef.current = camera
      setCurrentCamera(camera)

      const oldTrack = localVideoTrackRef.current
      const leaving3d = previous === CAMERA_3D
      // Leaving the 3D camera: turn it off first, so its two webcams are free again.
      if (leaving3d) {
        oldTrack?.stop()
        await stopCamera3d()
      }

      const track = await openCamera(camera, isCancelled)
      if (!isCancelled()) {
        if (track) {
          if (!leaving3d) oldTrack?.stop()
          await setVideoTrack(track, camera === CAMERA_3D ? LAYOUT_STEREO : LAYOUT_MONO)
          saveCamera(camera)
        } else if (leaving3d) {
          await setVideoTrack(null) // the old camera is already off
          saveCamera(camera)
        } else {
          // Keep using the old camera.
          currentCameraRef.current = previous
          setCurrentCamera(previous)
        }
      }
      isSwitchingRef.current = false
      setIsSwitchingCamera(false)
    },
    [openCamera, setVideoTrack],
  )

  // Callee: answer the caller's offer.
  const answerOffer = useCallback(
    async (data) => {
      const pc = pcRef.current
      setRemoteLayout(toLayout(data.layout))
      try {
        await pc.setRemoteDescription(data.description)
        await addPendingCandidates(pc)
        // Send video back in the same slot (my camera goes in when it's ready).
        const transceiver = videoTransceiver(pc)
        if (transceiver) transceiver.direction = 'sendrecv'
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        sendToPeer('webrtc:answer', {
          description: { type: answer.type, sdp: answer.sdp },
          layout: localVideoTrackRef.current ? localLayoutRef.current : LAYOUT_NONE,
        })
        await attachVideo()
      } catch (error) {
        console.error('[webrtc] Could not answer', error)
        sendToPeer('call:end', { reason: 'failed' })
        finishCall('Could not start the call.')
      }
    },
    [addPendingCandidates, attachVideo, sendToPeer, finishCall],
  )

  // ----- Actions used by the UI -----

  // No camera or microphone until the other person accepts.
  const startCall = useCallback(
    (contact, mode = MODE_SUMMON) => {
      if (!socket || peerRef.current) return
      const peer = { id: contact.id, name: contact.name }
      peerRef.current = peer
      dispatch({ type: 'START_OUTGOING', peer, mode: toCallMode(mode) })
      navigate('/call')
      getIceServers()

      socket.emit('call:invite', { to: peer.id, mode: toCallMode(mode) })
      timeoutRef.current = setTimeout(() => {
        sendToPeer('call:cancel', { reason: 'no-answer' })
        finishCall('No answer')
      }, CALL_TIMEOUT_MS)
    },
    [socket, navigate, getIceServers, finishCall, sendToPeer],
  )

  const acceptCall = useCallback(async () => {
    const peer = peerRef.current
    if (!peer || state.status !== 'incoming') return
    dispatch({ type: 'ACCEPTED' })
    navigate('/call')
    // Accept first: the server only allows the 3D camera once the call is accepted.
    sendToPeer('call:accept')

    if (!(await openMicrophone(peer))) return
    const iceServers = await getIceServers()
    if (peerRef.current !== peer) return
    createPeerConnection(iceServers, { addVideoSlot: false })

    // The caller's offer may already be waiting.
    const offer = pendingOfferRef.current
    pendingOfferRef.current = null
    if (offer) answerOffer(offer)

    startVideo(peer)
  }, [state.status, navigate, sendToPeer, openMicrophone, getIceServers, createPeerConnection, answerOffer, startVideo])

  const declineCall = useCallback(() => {
    sendToPeer('call:decline')
    finishCall('Call declined')
  }, [sendToPeer, finishCall])

  const cancelCall = useCallback(() => {
    sendToPeer('call:cancel')
    finishCall('Call cancelled')
  }, [sendToPeer, finishCall])

  const endCall = useCallback(() => {
    sendToPeer('call:end')
    finishCall('Call ended')
  }, [sendToPeer, finishCall])

  const toggleMute = useCallback(() => {
    const nextMuted = !isMuted
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted
    })
    setIsMuted(nextMuted)
  }, [isMuted])

  const toggleCamera = useCallback(() => {
    const nextOff = !isCameraOff
    isCameraOffRef.current = nextOff
    if (localVideoTrackRef.current) localVideoTrackRef.current.enabled = !nextOff
    setIsCameraOff(nextOff)
  }, [isCameraOff])

  // ----- Socket events from the other person (relayed by the server) -----

  useEffect(() => {
    if (!socket) return

    const isFromPeer = (data) => Boolean(peerRef.current) && data?.from === peerRef.current.id
    const peerName = () => peerRef.current?.name ?? 'They'

    const handlers = {
      'call:invite': ({ from, fromName, mode }) => {
        if (peerRef.current) {
          socket.emit('call:busy', { to: from })
          return
        }
        const peer = { id: from, name: fromName }
        peerRef.current = peer
        dispatch({ type: 'INCOMING', peer, mode: toCallMode(mode) })
        socket.emit('call:ringing', { to: from })
        getIceServers()
      },

      'call:ringing': (data) => {
        if (isFromPeer(data)) dispatch({ type: 'RINGING' })
      },

      // Caller side: the other person picked up. Open the microphone, connect right away, then
      // start the camera in the background.
      'call:accept': async (data) => {
        if (!isFromPeer(data)) return
        clearTimeout(timeoutRef.current)
        dispatch({ type: 'ACCEPTED' })
        const peer = peerRef.current
        if (!(await openMicrophone(peer))) return
        const iceServers = await getIceServers()
        if (peerRef.current !== peer) return

        try {
          const pc = createPeerConnection(iceServers, { addVideoSlot: true })
          const offer = await pc.createOffer()
          await pc.setLocalDescription(offer)
          sendToPeer('webrtc:offer', { description: { type: offer.type, sdp: offer.sdp }, layout: LAYOUT_NONE })
        } catch (error) {
          console.error('[webrtc] Could not create offer', error)
          sendToPeer('call:end', { reason: 'failed' })
          finishCall('Could not start the call.')
          return
        }
        startVideo(peer)
      },

      // Receiver side: answer now, or once Pick up has set up the connection.
      'webrtc:offer': (data) => {
        if (!isFromPeer(data)) return
        if (pcRef.current) answerOffer(data)
        else pendingOfferRef.current = data
      },

      'webrtc:answer': async (data) => {
        const pc = pcRef.current
        if (!isFromPeer(data) || !pc) return
        setRemoteLayout(toLayout(data.layout))
        try {
          await pc.setRemoteDescription(data.description)
          await addPendingCandidates(pc)
        } catch (error) {
          console.error('[webrtc] Could not use answer', error)
          sendToPeer('call:end', { reason: 'failed' })
          finishCall('Could not start the call.')
        }
      },

      'webrtc:ice-candidate': async (data) => {
        if (!isFromPeer(data) || !data.candidate) return
        const pc = pcRef.current
        if (pc?.remoteDescription) {
          await pc.addIceCandidate(data.candidate).catch((error) => console.warn('[webrtc] Bad ICE candidate', error))
        } else {
          // Too early: keep it until the remote description is set.
          pendingCandidatesRef.current.push(data.candidate)
        }
      },

      // The other person's video started (normal webcam or 3D camera).
      'call:layout': (data) => {
        if (isFromPeer(data)) setRemoteLayout(toLayout(data.layout))
      },

      'call:decline': (data) => {
        if (isFromPeer(data)) finishCall('Call declined')
      },
      'call:cancel': (data) => {
        if (isFromPeer(data)) finishCall(data.reason === 'no-answer' ? `Missed call from ${peerName()}` : 'Call cancelled')
      },
      'call:end': (data) => {
        if (!isFromPeer(data)) return
        if (data.reason === 'disconnected') finishCall(`${peerName()} disconnected`)
        else if (data.reason === 'failed') finishCall('Connection failed. Please try again.')
        else finishCall('Call ended')
      },
      'call:busy': (data) => {
        if (isFromPeer(data)) finishCall(`${peerName()} is busy`)
      },
      'call:unavailable': (data) => {
        if (isFromPeer(data)) finishCall(`${peerName()} is offline`)
      },
      'call:error': (data) => {
        finishCall(data?.error || 'Something went wrong with the call.')
      },
      disconnect: () => {
        finishCall('Lost connection to the server')
      },
    }

    Object.entries(handlers).forEach(([event, handler]) => socket.on(event, handler))
    return () => {
      Object.entries(handlers).forEach(([event, handler]) => socket.off(event, handler))
      finishCall('Call ended')
    }
  }, [
    socket,
    getIceServers,
    openMicrophone,
    createPeerConnection,
    addPendingCandidates,
    answerOffer,
    startVideo,
    sendToPeer,
    finishCall,
  ])

  // Show the "ended" toast for a few seconds, then go back to idle.
  useEffect(() => {
    if (state.status !== 'ended') return
    const timer = setTimeout(() => dispatch({ type: 'RESET' }), TOAST_DURATION_MS)
    return () => clearTimeout(timer)
  }, [state])

  // Release the camera if the whole app unmounts.
  useEffect(() => cleanup, [cleanup])

  const value = useMemo(
    () => ({
      ...state,
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
      startCall,
      acceptCall,
      declineCall,
      cancelCall,
      endCall,
      toggleMute,
      toggleCamera,
      switchCamera,
    }),
    [
      state,
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
      startCall,
      acceptCall,
      declineCall,
      cancelCall,
      endCall,
      toggleMute,
      toggleCamera,
      switchCamera,
    ],
  )

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCall() {
  return useContext(CallContext)
}
