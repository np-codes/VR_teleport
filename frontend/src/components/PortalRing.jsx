import { cn } from '../lib/utils'

// The portal: a slowly turning gradient ring with a soft glow, wrapped around its children
// (an avatar, or nothing for the logo). mode tints it gold (summon) or iris (teleport).
// Only transform/opacity animate, which stays cheap on Quest; reduced motion stops it.
export default function PortalRing({ mode, size = 160, active = true, className, children }) {
  const glow = mode === 'teleport' ? 'rgb(143 140 255 / 0.28)' : mode === 'summon' ? 'rgb(255 194 75 / 0.26)' : 'rgb(180 170 255 / 0.2)'

  return (
    <div className={cn('relative grid shrink-0 place-items-center', className)} style={{ width: size, height: size }}>
      <span
        aria-hidden="true"
        className={cn('absolute -inset-[18%] rounded-full', active && 'animate-portal-breathe')}
        style={{ background: `radial-gradient(circle, ${glow} 0%, transparent 68%)` }}
      />
      <span aria-hidden="true" className={cn('portal-ring', mode && `portal-ring--${mode}`, active && 'animate-portal-spin')} />
      <div className="relative">{children}</div>
    </div>
  )
}
