import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../services/api'
import { getLocalMedia, stopStream } from '../services/media'
import { useAuth } from './AuthContext'

const CALL_TIMEOUT_MS = 30_000
const TOAST_DURATION_MS = 4000
const FALLBACK_ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }]

// ---------------------------------------------------------------------------
// Call state machine:
//   idle → outgoing | incoming → connecting → in-call → ended → idle
// "ended" holds the message shown in the toast, then goes back to idle.
// Any action that doesn't fit the current status is ignored.
// ---------------------------------------------------------------------------
const initialState = { status: 'idle', peer: null, isRinging: false, message: '' }

function callReducer(state, action) {
  const isFree = state.status === 'idle' || state.status === 'ended'

  switch (action.type) {
    case 'START_OUTGOING':
      return isFree ? { ...initialState, status: 'outgoing', peer: action.peer } : state
    case 'INCOMING':
      return isFree ? { ...initialState, status: 'incoming', peer: action.peer } : state
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

function mediaErrorMessage(error) {
  if (error.name === 'NotAllowedError') return 'Camera or microphone access was blocked.'
  if (error.name === 'NotFoundError') return 'No camera or microphone was found.'
  if (error.name === 'NotReadableError') return 'Your camera is being used by another app.'
  return error.message || 'Could not start your camera.'
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

  // Refs hold the live call objects so socket handlers always see current values.
  const peerRef = useRef(null) // { id, name } of the other person, or null when free
  const pcRef = useRef(null)
  const localStreamRef = useRef(null)
  const pendingCandidatesRef = useRef([])
  const iceServersRef = useRef(null)
  const timeoutRef = useRef(null)

  // Stops everything: tracks, peer connection, timers.
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
    pendingCandidatesRef.current = []
    iceServersRef.current = null
    peerRef.current = null
    setLocalStream(null)
    setRemoteStream(null)
    setIsMuted(false)
    setIsCameraOff(false)
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

  const openLocalMedia = useCallback(async (peer) => {
    const stream = await getLocalMedia()
    // The call may have ended while the camera was starting.
    if (peerRef.current !== peer) {
      stopStream(stream)
      return false
    }
    localStreamRef.current = stream
    setLocalStream(stream)
    return true
  }, [])

  const createPeerConnection = useCallback(
    (iceServers) => {
      const pc = new RTCPeerConnection({ iceServers })
      const stream = localStreamRef.current
      stream?.getTracks().forEach((track) => pc.addTrack(track, stream))

      pc.onicecandidate = (event) => {
        if (event.candidate) sendToPeer('webrtc:ice-candidate', { candidate: event.candidate.toJSON() })
      }
      pc.ontrack = (event) => {
        if (event.streams[0]) setRemoteStream(event.streams[0])
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

  // ----- Actions used by the UI -----

  const startCall = useCallback(
    async (contact) => {
      if (!socket || peerRef.current) return
      const peer = { id: contact.id, name: contact.name }
      peerRef.current = peer
      dispatch({ type: 'START_OUTGOING', peer })
      navigate('/call')
      getIceServers()

      try {
        if (!(await openLocalMedia(peer))) return
      } catch (error) {
        finishCall(mediaErrorMessage(error))
        return
      }

      socket.emit('call:invite', { to: peer.id })
      timeoutRef.current = setTimeout(() => {
        sendToPeer('call:cancel', { reason: 'no-answer' })
        finishCall('No answer')
      }, CALL_TIMEOUT_MS)
    },
    [socket, navigate, getIceServers, openLocalMedia, finishCall, sendToPeer],
  )

  const acceptCall = useCallback(async () => {
    const peer = peerRef.current
    if (!peer || state.status !== 'incoming') return
    dispatch({ type: 'ACCEPTED' })
    navigate('/call')

    try {
      if (!(await openLocalMedia(peer))) return
    } catch (error) {
      sendToPeer('call:decline')
      finishCall(mediaErrorMessage(error))
      return
    }

    const iceServers = await getIceServers()
    if (peerRef.current !== peer) return
    // Ready for the caller's offer before telling them we accepted.
    createPeerConnection(iceServers)
    sendToPeer('call:accept')
  }, [state.status, navigate, openLocalMedia, getIceServers, createPeerConnection, sendToPeer, finishCall])

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
    localStreamRef.current?.getVideoTracks().forEach((track) => {
      track.enabled = !nextOff
    })
    setIsCameraOff(nextOff)
  }, [isCameraOff])

  // ----- Socket events from the other person (relayed by the server) -----

  useEffect(() => {
    if (!socket) return

    const isFromPeer = (data) => Boolean(peerRef.current) && data?.from === peerRef.current.id
    const peerName = () => peerRef.current?.name ?? 'They'

    const handlers = {
      'call:invite': ({ from, fromName }) => {
        if (peerRef.current) {
          socket.emit('call:busy', { to: from })
          return
        }
        const peer = { id: from, name: fromName }
        peerRef.current = peer
        dispatch({ type: 'INCOMING', peer })
        socket.emit('call:ringing', { to: from })
        getIceServers()
      },

      'call:ringing': (data) => {
        if (isFromPeer(data)) dispatch({ type: 'RINGING' })
      },

      // Caller side: the other person picked up, so start WebRTC with an offer.
      'call:accept': async (data) => {
        if (!isFromPeer(data)) return
        clearTimeout(timeoutRef.current)
        dispatch({ type: 'ACCEPTED' })
        const peer = peerRef.current
        const iceServers = await getIceServers()
        if (peerRef.current !== peer) return

        try {
          const pc = createPeerConnection(iceServers)
          const offer = await pc.createOffer()
          await pc.setLocalDescription(offer)
          sendToPeer('webrtc:offer', { description: { type: offer.type, sdp: offer.sdp } })
        } catch (error) {
          console.error('[webrtc] Could not create offer', error)
          sendToPeer('call:end', { reason: 'failed' })
          finishCall('Could not start the call.')
        }
      },

      // Receiver side: answer the caller's offer.
      'webrtc:offer': async (data) => {
        const pc = pcRef.current
        if (!isFromPeer(data) || !pc) return
        try {
          await pc.setRemoteDescription(data.description)
          await addPendingCandidates(pc)
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          sendToPeer('webrtc:answer', { description: { type: answer.type, sdp: answer.sdp } })
        } catch (error) {
          console.error('[webrtc] Could not answer', error)
          sendToPeer('call:end', { reason: 'failed' })
          finishCall('Could not start the call.')
        }
      },

      'webrtc:answer': async (data) => {
        const pc = pcRef.current
        if (!isFromPeer(data) || !pc) return
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
  }, [socket, getIceServers, createPeerConnection, addPendingCandidates, sendToPeer, finishCall])

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
      startCall,
      acceptCall,
      declineCall,
      cancelCall,
      endCall,
      toggleMute,
      toggleCamera,
    }),
    [state, localStream, remoteStream, isMuted, isCameraOff, startCall, acceptCall, declineCall, cancelCall, endCall, toggleMute, toggleCamera],
  )

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCall() {
  return useContext(CallContext)
}
