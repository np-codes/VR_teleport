import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

const RADIUS = 50
const headPosition = new THREE.Vector3()

// Puts the remote video stream on the inside of a sphere.
//   mode "360": full sphere, turned -90° so the middle of the video is in front.
//   mode "180": front half-sphere, showing only the left half (left eye) of a
//               side-by-side 3D video for now.
export default function VideoSphere({ stream, mode }) {
  const meshRef = useRef(null)
  const is180 = mode === '180'

  // A muted <video> just for the texture; the page's own video element plays the audio.
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

  const geometry = useMemo(() => {
    const sphere = is180
      ? new THREE.SphereGeometry(RADIUS, 64, 32, Math.PI, Math.PI)
      : new THREE.SphereGeometry(RADIUS, 64, 32)
    // Flip on X so the faces (and the video) point inwards, towards the viewer.
    sphere.scale(-1, 1, 1)
    return sphere
  }, [is180])

  useEffect(() => () => geometry.dispose(), [geometry])

  // Keep the sphere centered on the viewer's head so the video never shifts.
  useFrame(({ camera }) => {
    if (!meshRef.current) return
    camera.getWorldPosition(headPosition)
    meshRef.current.position.copy(headPosition)
  })

  return (
    <mesh ref={meshRef} geometry={geometry} rotation={[0, is180 ? 0 : -Math.PI / 2, 0]}>
      <meshBasicMaterial toneMapped={false}>
        {/* Declared in JSX so react-three-fiber creates and disposes it for us. */}
        <videoTexture
          attach="map"
          args={[video]}
          colorSpace={THREE.SRGBColorSpace}
          repeat={is180 ? [0.5, 1] : [1, 1]}
        />
      </meshBasicMaterial>
    </mesh>
  )
}
