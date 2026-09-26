import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { IfInSessionMode, XR } from '@react-three/xr'
import * as THREE from 'three'
import { xrStore } from '../services/xrStore'
import VideoSphere from './VideoSphere'

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

// isActive: false pauses rendering while the flat view is shown on top.
export default function VRScene({ stream, mode, isActive, onEndCall }) {
  return (
    <Canvas frameloop={isActive ? 'always' : 'never'} camera={{ position: [0, 0, 0.1], fov: 75 }}>
      <XR store={xrStore}>
        {stream && <VideoSphere stream={stream} mode={mode} />}

        <IfInSessionMode deny="immersive-vr">
          {/* Desktop: drag to look around. No zoom or pan. */}
          <OrbitControls enableZoom={false} enablePan={false} rotateSpeed={-0.4} />
        </IfInSessionMode>

        <IfInSessionMode allow="immersive-vr">
          <VREndCallButton onPress={onEndCall} />
        </IfInSessionMode>
      </XR>
    </Canvas>
  )
}
