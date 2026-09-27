import { cn } from '../../lib/utils'

// shadcn/ui-style text input, 48px tall.
export function Input({ className, ...props }) {
  return (
    <input
      className={cn(
        'h-12 w-full rounded-2xl border border-edge bg-void px-4 text-base text-starlight placeholder:text-mist/60 focus-visible:border-starlight focus-visible:outline-none',
        className,
      )}
      {...props}
    />
  )
}
