import { cva } from 'class-variance-authority'
import { cn } from '../../lib/utils'

// shadcn/ui-style button. Every size is at least 48px tall for the Quest browser.
// eslint-disable-next-line react-refresh/only-export-components
export const buttonVariants = cva(
  'inline-flex min-h-12 items-center justify-center gap-2 whitespace-nowrap rounded-full px-6 text-base font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 [&_svg]:size-5 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        summon: 'bg-summon text-summon-ink hover:bg-[#ffd27a]',
        teleport: 'bg-teleport text-teleport-ink hover:bg-[#aeacff]',
        danger: 'bg-danger text-danger-ink hover:bg-[#ff7d88]',
        primary: 'bg-starlight text-void hover:bg-white',
        secondary: 'border border-edge bg-hull-2 text-starlight hover:bg-edge',
        ghost: 'border border-edge text-starlight hover:bg-hull',
      },
      size: {
        default: '',
        lg: 'min-h-14 px-8 text-lg',
        icon: 'size-12 px-0',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'default' },
  },
)

export function Button({ className, variant, size, ...props }) {
  return <button type="button" className={cn(buttonVariants({ variant, size }), className)} {...props} />
}
