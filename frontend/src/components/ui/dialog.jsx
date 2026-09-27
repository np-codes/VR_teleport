import * as DialogPrimitive from '@radix-ui/react-dialog'
import { cn } from '../../lib/utils'

// shadcn/ui-style dialog (Radix): focus trap, screen-reader roles, and Escape handling.
export const Dialog = DialogPrimitive.Root
export const DialogTitle = DialogPrimitive.Title
export const DialogDescription = DialogPrimitive.Description

export function DialogContent({ className, children, ...props }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-void/90" />
      <DialogPrimitive.Content
        className={cn('fixed inset-0 z-50 flex items-center justify-center p-4 outline-none', className)}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}
