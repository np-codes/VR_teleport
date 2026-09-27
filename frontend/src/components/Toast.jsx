import { useEffect } from 'react'
import { Toaster, toast } from 'sonner'
import { useCall } from '../context/CallContext'

// Messages about something going wrong get the error style; the rest (declined, busy, offline,
// ended…) are plain.
const PROBLEM = /failed|lost|could not|blocked|error/i

// Shows why the last call ended ("Call declined", "Jenil is busy", "Connection failed", …).
export default function Toast() {
  const { status, message } = useCall()

  useEffect(() => {
    if (status !== 'ended' || !message) return
    // A fixed id: showing it twice (e.g. React strict mode) updates one toast instead of two.
    const show = PROBLEM.test(message) ? toast.error : toast
    show(message, { id: 'call-ended' })
  }, [status, message])

  return (
    <Toaster
      theme="dark"
      position="bottom-center"
      toastOptions={{
        classNames: {
          toast: 'rounded-2xl! border-edge! bg-hull! text-starlight! text-base! font-sans! min-h-14!',
          error: 'border-danger/50! text-danger!',
        },
      }}
    />
  )
}
