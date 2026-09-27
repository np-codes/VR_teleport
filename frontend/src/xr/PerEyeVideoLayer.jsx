import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { mountPerEyeVideo } from './perEyeVideo'

// Connects mountPerEyeVideo to the app's existing react-three-fiber scene: mounts it while this
// component is rendered, updates it every frame (XR frames while in VR), and unmounts it
// (disposing everything) when the component goes away, e.g. when the call ends.
// onSessionEnd: called when the XR session ends.
export default function PerEyeVideoLayer({ video, onSessionEnd }) {
  const { scene, camera, gl } = useThree()
  const handleRef = useRef(null)

  useEffect(() => {
    if (!video) return
    const handle = mountPerEyeVideo({ scene, camera, renderer: gl, video })
    handleRef.current = handle
    return () => {
      handle.unmount()
      handleRef.current = null
    }
  }, [scene, camera, gl, video])

  useEffect(() => {
    if (!onSessionEnd) return
    gl.xr.addEventListener('sessionend', onSessionEnd)
    return () => gl.xr.removeEventListener('sessionend', onSessionEnd)
  }, [gl, onSessionEnd])

  useFrame(() => handleRef.current?.update())

  return null
}
