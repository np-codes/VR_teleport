import { useCall } from '../context/CallContext'

// Shows why the last call ended ("Call declined", "Jenil is busy", …).
export default function Toast() {
  const { status, message } = useCall()

  return (
    <div className="toast-region" role="status" aria-live="polite">
      {status === 'ended' && message && <div className="toast">{message}</div>}
    </div>
  )
}
