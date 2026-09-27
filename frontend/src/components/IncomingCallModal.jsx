import { useEffect } from 'react'
import { motion } from 'motion/react'
import { Check, X } from 'lucide-react'
import { useCall } from '../context/CallContext'
import { startRingtone } from '../services/ringtone'
import { INCOMING } from '../constants/callCopy'
import Avatar from './Avatar'
import PortalRing from './PortalRing'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'

// Rendered once at the app root, so it appears on any page. Full screen and can't be dismissed
// by accident (Escape / clicking outside do nothing): the person answers or declines.
export default function IncomingCallModal() {
  const { status, peer, mode, acceptCall, declineCall } = useCall()
  const isOpen = status === 'incoming'

  // Ring while it's open; stops when answered, declined or cancelled.
  useEffect(() => {
    if (!isOpen) return
    return startRingtone()
  }, [isOpen])

  if (!isOpen) return null
  const copy = INCOMING[mode]

  return (
    <Dialog open>
      <DialogContent
        role="alertdialog"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
          className="flex max-w-xl flex-col items-center gap-10 text-center"
        >
          <PortalRing mode={mode} size={260}>
            <Avatar user={peer} size={128} />
          </PortalRing>
          <div className="space-y-3">
            <DialogTitle className="text-3xl font-semibold leading-tight tracking-tight md:text-4xl">
              {copy.text(peer.name)}
            </DialogTitle>
            <DialogDescription className="text-lg text-mist">Video call from {peer.name}</DialogDescription>
          </div>
          <div className="grid w-full max-w-md grid-cols-2 gap-4">
            <Button variant="danger" size="lg" onClick={declineCall}>
              <X aria-hidden="true" />
              {INCOMING.decline}
            </Button>
            <Button variant={mode} size="lg" onClick={acceptCall} autoFocus>
              <Check aria-hidden="true" />
              {copy.accept}
            </Button>
          </div>
        </motion.div>
      </DialogContent>
    </Dialog>
  )
}
