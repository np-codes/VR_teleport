import PortalRing from './PortalRing'

export default function LoadingScreen() {
  return (
    <main className="grid min-h-dvh place-items-center" role="status">
      <PortalRing size={72} />
      <span className="sr-only">Loading…</span>
    </main>
  )
}
