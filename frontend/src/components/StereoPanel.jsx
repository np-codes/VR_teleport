import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useVideoElement } from '../hooks/useVideoElement'

const DISTANCE_M = 1.5

const CAMERA_HFOV_DEG = 100
const PANEL_WIDTH_M = 2 * DISTANCE_M * Math.tan(THREE.MathUtils.degToRad(CAMERA_HFOV_DEG / 2))
// two_cams/view.py sends 1280x720 per eye by default.
const PANEL_HEIGHT_M = PANEL_WIDTH_M / (16 / 9)

const headPosition = new THREE.Vector3()

// A plane that shows only one half (0 = left, 0.5 = right) of the video.
function createHalfPlane(width, height, uStart) {
  const plane = new THREE.PlaneGeometry(width, height)
  const uv = plane.attributes.uv
  for (let i = 0; i < uv.count; i++) uv.setX(i, uStart + uv.getX(i) * 0.5)
  return plane
}

export default function StereoPanel({ stream, isStereo }) {
  const video = useVideoElement(stream)
  const groupRef = useRef(null)
  const materialRef = useRef(null)
  const rightEyeRef = useRef(null)
  const isPlacedRef = useRef(false)

  const monoGeometry = useMemo(() => new THREE.PlaneGeometry(PANEL_WIDTH_M, PANEL_HEIGHT_M), [])
  const leftGeometry = useMemo(() => createHalfPlane(PANEL_WIDTH_M, PANEL_HEIGHT_M, 0), [])
  const rightGeometry = useMemo(() => createHalfPlane(PANEL_WIDTH_M, PANEL_HEIGHT_M, 0.5), [])
  useEffect(() => () => monoGeometry.dispose(), [monoGeometry])
  useEffect(() => () => leftGeometry.dispose(), [leftGeometry])
  useEffect(() => () => rightGeometry.dispose(), [rightGeometry])

  // The right-eye mesh reuses the left mesh's material (and so the same video texture).
  useEffect(() => {
    if (rightEyeRef.current && materialRef.current) rightEyeRef.current.material = materialRef.current
  })

  // Placed once, 1.5 m in front of the head at eye height, then fixed in the room so moving
  // your head gives real depth.
  useFrame(({ camera }) => {
    const group = groupRef.current
    if (!group || isPlacedRef.current) return
    camera.getWorldPosition(headPosition)
    if (headPosition.y < 0.2) return // the headset pose isn't known yet
    group.position.set(headPosition.x, headPosition.y, headPosition.z - DISTANCE_M)
    isPlacedRef.current = true
  })

  return (
    <group ref={groupRef}>
      {/* Stereo: left half on layer 1 (left eye only). Mono: whole frame on layer 0 (both eyes). */}
      <mesh geometry={isStereo ? leftGeometry : monoGeometry} layers={isStereo ? 1 : 0}>
        <meshBasicMaterial ref={materialRef} toneMapped={false}>
          <videoTexture attach="map" args={[video]} colorSpace={THREE.SRGBColorSpace} />
        </meshBasicMaterial>
      </mesh>
      {isStereo && <mesh ref={rightEyeRef} geometry={rightGeometry} layers={2} />}
    </group>
  )
}
