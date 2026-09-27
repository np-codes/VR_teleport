import { useEffect, useMemo } from 'react'

// A muted, playing <video> for a MediaStream, used as a 3D texture source.
// (The page's own video element plays the audio.)
export function useVideoElement(stream) {
  const video = useMemo(() => {
    const element = document.createElement('video')
    element.srcObject = stream
    element.muted = true
    element.playsInline = true
    return element
  }, [stream])

  useEffect(() => {
    video.play().catch(() => {})
    return () => video.pause()
  }, [video])

  return video
}
