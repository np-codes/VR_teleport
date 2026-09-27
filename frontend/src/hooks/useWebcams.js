import { useEffect, useState } from 'react'
import { listWebcams } from '../services/media'


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
