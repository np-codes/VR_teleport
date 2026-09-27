import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useVideoElement } from '../hooks/useVideoElement'

// 180° view: the other person's video on the inside of the front half of a sphere, centered on
// the viewer's head so it wraps around you.
//
// For a 3D camera stream (left eye | right eye) in VR, each eye sees its own half: the left-half
// mesh is on layer 1 (left eye) and the right-half mesh on layer 2 (right eye), sharing one
// video texture. On the page, only the left half is shown (layer 0). A normal webcam stream
// covers the whole half-sphere for both eyes.

const RADIUS = 10
const headPosition = new THREE.Vector3()

// Front half-sphere (facing -Z), flipped so the video is on the inside. uStart / uWidth pick
// which part of the video it shows (whole frame, or the left or right half).
function createHalfSphere(uStart, uWidth) {
  const sphere = new THREE.SphereGeometry(RADIUS, 64, 32, Math.PI, Math.PI)
  sphere.scale(-1, 1, 1)
  const uv = sphere.attributes.uv
  for (let i = 0; i < uv.count; i++) uv.setX(i, uStart + uv.getX(i) * uWidth)
  return sphere
}

export default function HalfSphereVideo({ stream, isStereo, isInVR }) {
  const video = useVideoElement(stream)
  const groupRef = useRef(null)
  const materialRef = useRef(null)
  const rightEyeRef = useRef(null)

  const wholeGeometry = useMemo(() => createHalfSphere(0, 1), [])
  const leftGeometry = useMemo(() => createHalfSphere(0, 0.5), [])
  const rightGeometry = useMemo(() => createHalfSphere(0.5, 0.5), [])
  useEffect(() => () => wholeGeometry.dispose(), [wholeGeometry])
  useEffect(() => () => leftGeometry.dispose(), [leftGeometry])
  useEffect(() => () => rightGeometry.dispose(), [rightGeometry])

  // The right-eye mesh reuses the first mesh's material (and so the same video texture).
  useEffect(() => {
    if (rightEyeRef.current && materialRef.current) rightEyeRef.current.material = materialRef.current
  })

  // Keep the half-sphere centered on the head so the video never shifts.
  useFrame(({ camera }) => {
    if (!groupRef.current) return
    camera.getWorldPosition(headPosition)
    groupRef.current.position.copy(headPosition)
  })

  const perEye = isStereo && isInVR

  return (
    <group ref={groupRef}>
      <mesh geometry={isStereo ? leftGeometry : wholeGeometry} layers={perEye ? 1 : 0}>
        <meshBasicMaterial ref={materialRef} toneMapped={false}>
          <videoTexture attach="map" args={[video]} colorSpace={THREE.SRGBColorSpace} />
        </meshBasicMaterial>
      </mesh>
      {perEye && <mesh ref={rightEyeRef} geometry={rightGeometry} layers={2} />}
    </group>
  )
}
