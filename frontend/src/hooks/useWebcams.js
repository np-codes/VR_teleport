import { useEffect, useState } from 'react'
import { listWebcams } from '../services/media'

// The normal webcams on this device, kept up to date when cameras are plugged in or out.
// Names only appear once the page has used a camera, so pass a changing `refreshKey`
// (e.g. the camera in use) to list them again after that.
export function useWebcams(refreshKey) {
  const [webcams, setWebcams] = useState([])

  useEffect(() => {
    let ignore = false
    const refresh = () =>
      listWebcams()
        .then((list) => {
          if (!ignore) setWebcams(list)
        })
        .catch(() => {})
    refresh()
    navigator.mediaDevices?.addEventListener('devicechange', refresh)
    return () => {
      ignore = true
      navigator.mediaDevices?.removeEventListener('devicechange', refresh)
    }
  }, [refreshKey])

  return webcams
}
