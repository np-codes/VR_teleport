// A simple phone-style ringtone made with the Web Audio API (no audio files).
// Returns a function that stops it.
export function startRingtone() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext
  if (!AudioContextClass) return () => {}

  const ctx = new AudioContextClass()
  ctx.resume().catch(() => {})

  // One short "brring": two mixed tones with a soft fade in and out.
  const beep = (start) => {
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(0.12, start + 0.02)
    gain.gain.setValueAtTime(0.12, start + 0.33)
    gain.gain.linearRampToValueAtTime(0, start + 0.38)
    gain.connect(ctx.destination)

    for (const frequency of [440, 480]) {
      const oscillator = ctx.createOscillator()
      oscillator.frequency.value = frequency
      oscillator.connect(gain)
      oscillator.start(start)
      oscillator.stop(start + 0.4)
    }
  }

  const ring = () => {
    const start = ctx.currentTime + 0.05
    beep(start)
    beep(start + 0.5)
  }

  ring()
  const interval = setInterval(ring, 2500)

  return () => {
    clearInterval(interval)
    ctx.close().catch(() => {})
  }
}
