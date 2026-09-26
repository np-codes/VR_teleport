import { useEffect } from 'react'
import { useCall } from '../context/CallContext'
import { startRingtone } from '../services/ringtone'
import Avatar from './Avatar'

// Rendered once at the app root, so it appears on any page.
export default function IncomingCallModal() {
  const { status, peer, acceptCall, declineCall } = useCall()
  const isOpen = status === 'incoming'

  // Ring while the modal is open; stops when answered, declined or cancelled.
  useEffect(() => {
    if (!isOpen) return
    return startRingtone()
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div className="modal-backdrop">
      <div
        className="modal card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="incoming-title"
        aria-describedby="incoming-subtitle"
      >
        <div className="pulse-avatar">
          <Avatar user={peer} size={96} />
        </div>
        <h2 id="incoming-title" className="modal__title">
          {peer.name} is calling
        </h2>
        <p id="incoming-subtitle" className="muted">
          Video call
        </p>
        <div className="button-row">
          <button type="button" className="button button--danger" onClick={declineCall}>
            Decline
          </button>
          <button type="button" className="button button--success" onClick={acceptCall} autoFocus>
            Pick up
          </button>
        </div>
      </div>
    </div>
  )
}
