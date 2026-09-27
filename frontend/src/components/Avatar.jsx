import { cn } from '../lib/utils'

const COLORS = ['#3d4c80', '#5b3f82', '#2e6168', '#6d4b2c', '#2f5486', '#6a3553']

// Picks the same color for the same person every time.
function colorFor(id = '') {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return COLORS[hash % COLORS.length]
}

// Initials in a circle.
export default function Avatar({ user, size = 48, className }) {
  const initial = user?.name?.charAt(0).toUpperCase() ?? '?'

  return (
    <span
      aria-hidden="true"
      className={cn('inline-grid shrink-0 select-none place-items-center rounded-full font-semibold text-white', className)}
      style={{ width: size, height: size, fontSize: size * 0.4, background: colorFor(user?.id) }}
    >
      {initial}
    </span>
  )
}
