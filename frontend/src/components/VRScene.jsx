import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { IfInSessionMode, XR } from '@react-three/xr'
import * as THREE from 'three'
import { xrStore } from '../services/xrStore'
import HalfSphereVideo from './HalfSphereVideo'
import StereoPanel from './StereoPanel'

const buttonOffset = new THREE.Vector3(0, -0.35, -1)
const headPosition = new THREE.Vector3()

// Draws the button label onto a canvas so no font files need to be downloaded.
function createButtonTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 160
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#c8303a'
  ctx.beginPath()
  ctx.roundRect(0, 0, canvas.width, canvas.height, 80)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 64px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('End call', canvas.width / 2, canvas.height / 2)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

// A floating red button in front of the user, only shown inside VR.
// Works with controller rays and hand-tracking pinches/pokes.
function VREndCallButton({ onPress }) {
  const groupRef = useRef(null)
  const [isHovered, setIsHovered] = useState(false)
  const texture = useMemo(() => createButtonTexture(), [])

  useEffect(() => () => texture.dispose(), [texture])

  useFrame(({ camera }) => {
    if (!groupRef.current) return
    camera.getWorldPosition(headPosition)
    groupRef.current.position.copy(headPosition).add(buttonOffset)
  })

  return (
    <group ref={groupRef}>
      <mesh
        scale={isHovered ? 1.08 : 1}
        onClick={onPress}
        onPointerOver={() => setIsHovered(true)}
        onPointerOut={() => setIsHovered(false)}
      >
        <planeGeometry args={[0.32, 0.1]} />
        <meshBasicMaterial map={texture} transparent toneMapped={false} />
      </mesh>
    </group>
  )
}

// The other person's video in 3D:
//   view "flat": in VR, a panel in front of you (in 3D for the 3D camera); on the page the normal
//                video tile is shown instead and this canvas doesn't render.
//   view "180":  a half-sphere around you, on the page (drag to look around) and in VR.
// showVideo: false while the other person has no video (yet). isStereo: it's a 3D camera stream.
// isActive: render (in VR, or 180° on the page); otherwise the canvas is paused.
export default function VRScene({ stream, showVideo, isStereo, view, isInVR, isActive, onEndCall }) {
  const is180 = view === '180'

  return (
    <Canvas frameloop={isActive ? 'always' : 'never'} camera={{ position: [0, 0, 0.1], fov: 75 }}>
      <XR store={xrStore}>
        {stream && showVideo && is180 && <HalfSphereVideo stream={stream} isStereo={isStereo} isInVR={isInVR} />}

        <IfInSessionMode deny="immersive-vr">
          {/* On the page: drag to look around. No zoom or pan. */}
          {is180 && <OrbitControls enableZoom={false} enablePan={false} rotateSpeed={-0.4} />}
        </IfInSessionMode>

        <IfInSessionMode allow="immersive-vr">
          {stream && showVideo && !is180 && <StereoPanel stream={stream} isStereo={isStereo} />}
          <VREndCallButton onPress={onEndCall} />
        </IfInSessionMode>
      </XR>
    </Canvas>
  )
}
