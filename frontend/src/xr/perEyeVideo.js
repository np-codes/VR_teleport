// Per-eye video: shows the existing remote <video> (a 2560x720 side-by-side frame) so that
// the LEFT eye sees the left half and the RIGHT eye sees the right half.
//
// three.js gives the XR eye cameras these layers every frame (verified on Quest 3):
//   left eye = normal camera's layers + layer 1, right eye = normal camera's layers + layer 2.
// So the left-half mesh is on layer 1 and the right-half mesh on layer 2, both in the same spot.
// Outside XR (laptop) the two halves are shown side by side with labels.
//
// Usage:
//   const perEye = mountPerEyeVideo({ scene, camera, renderer, video })
//   perEye.update()   // once per frame
//   perEye.unmount()  // removes and disposes everything; never stops or pauses `video`

import * as THREE from 'three'

const LEFT_EYE_LAYER = 1
const RIGHT_EYE_LAYER = 2
const PLANE_WIDTH_M = 1.2
const XR_POSITION = new THREE.Vector3(0, 1.6, -1.5) // same spot as the red/blue test (local-floor)
const DESKTOP_POSITION = new THREE.Vector3(0, 0, -1.5) // the page camera sits at eye level y = 0
const DESKTOP_GAP_M = 0.1
const EXPECTED_SIZE = '2560x720'
const HUD_REFRESH_MS = 250

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

// Samples one half of the side-by-side frame: uOffsetX 0.0 = left half, 0.5 = right half.
const fragmentShader = /* glsl */ `
  uniform sampler2D map;
  uniform float uOffsetX;
  varying vec2 vUv;
  void main() {
    gl_FragColor = texture2D(map, vUv * vec2(0.5, 1.0) + vec2(uOffsetX, 0.0));
    #include <colorspace_fragment>
  }
`

// A small canvas-backed plane for text (no font files needed).
function createTextPlane(width, height, canvasWidth, canvasHeight) {
  const canvas = document.createElement('canvas')
  canvas.width = canvasWidth
  canvas.height = canvasHeight
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false }),
  )
  const draw = (lines, { font = 28, color = '#ffffff', background = 'rgba(0, 0, 0, 0.75)' } = {}) => {
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = background
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.font = `${font}px ui-monospace, Consolas, monospace`
    ctx.textBaseline = 'middle'
    const lineHeight = font * 1.35
    const top = (canvas.height - lineHeight * (lines.length - 1)) / 2
    lines.forEach((line, i) => {
      ctx.fillStyle = line.startsWith('WARNING') ? '#ffcc4d' : color
      ctx.fillText(line, 20, top + i * lineHeight)
    })
    texture.needsUpdate = true
  }
  return { mesh, draw }
}

export function mountPerEyeVideo({ scene, camera, renderer, video }) {
  // One texture from the app's existing remote video element, shared by both eyes.
  const texture = new THREE.VideoTexture(video)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false

  const createEyeMaterial = (offsetX) =>
    new THREE.ShaderMaterial({
      uniforms: { map: { value: texture }, uOffsetX: { value: offsetX } },
      vertexShader,
      fragmentShader,
      toneMapped: false,
    })

  // Both eyes share one geometry, so they always have the same size.
  let eyeAspect = 16 / 9
  let geometry = new THREE.PlaneGeometry(PLANE_WIDTH_M, PLANE_WIDTH_M / eyeAspect)
  const leftMaterial = createEyeMaterial(0.0)
  const rightMaterial = createEyeMaterial(0.5)
  const leftMesh = new THREE.Mesh(geometry, leftMaterial)
  const rightMesh = new THREE.Mesh(geometry, rightMaterial)
  leftMesh.layers.set(LEFT_EYE_LAYER)
  rightMesh.layers.set(RIGHT_EYE_LAYER)

  // Labels (laptop only) and the HUD (layer 0: both eyes, and the laptop).
  const leftLabel = createTextPlane(PLANE_WIDTH_M, 0.08, 768, 52)
  const rightLabel = createTextPlane(PLANE_WIDTH_M, 0.08, 768, 52)
  leftLabel.draw(['LEFT half -> left eye (layer 1)'], { font: 26 })
  rightLabel.draw(['RIGHT half -> right eye (layer 2)'], { font: 26 })
  const hud = createTextPlane(1.2, 0.3, 1024, 256)

  const group = new THREE.Group()
  group.add(leftMesh, rightMesh, leftLabel.mesh, rightLabel.mesh, hud.mesh)
  scene.add(group)

  // The page camera normally sees only layer 0; let it see both halves while mounted.
  const originalCameraMask = camera.layers.mask
  camera.layers.enable(LEFT_EYE_LAYER)
  camera.layers.enable(RIGHT_EYE_LAYER)

  // Plane aspect = one half of the frame (videoWidth / 2 : videoHeight), e.g. 1280:720.
  const updateAspect = () => {
    if (!video.videoWidth || !video.videoHeight) return
    const nextAspect = video.videoWidth / 2 / video.videoHeight
    if (Math.abs(nextAspect - eyeAspect) < 0.001) return
    eyeAspect = nextAspect
    const oldGeometry = geometry
    geometry = new THREE.PlaneGeometry(PLANE_WIDTH_M, PLANE_WIDTH_M / eyeAspect)
    leftMesh.geometry = geometry
    rightMesh.geometry = geometry
    oldGeometry.dispose()
  }
  updateAspect()
  video.addEventListener('loadedmetadata', updateAspect)
  video.addEventListener('resize', updateAspect)

  // Are frames arriving? Count decoded frames with requestVideoFrameCallback when available,
  // otherwise watch currentTime.
  let frameCount = 0
  let frameCallbackId = null
  const countFrame = () => {
    frameCount++
    frameCallbackId = video.requestVideoFrameCallback(countFrame)
  }
  if (video.requestVideoFrameCallback) frameCallbackId = video.requestVideoFrameCallback(countFrame)

  let lastHudAt = performance.now()
  let lastFrameCount = 0
  let lastCurrentTime = video.currentTime
  let warnedSize = ''

  function updateHud(now, presenting) {
    const seconds = (now - lastHudAt) / 1000
    const fps = video.requestVideoFrameCallback ? (frameCount - lastFrameCount) / seconds : null
    const advancing = video.currentTime !== lastCurrentTime
    lastFrameCount = frameCount
    lastCurrentTime = video.currentTime
    lastHudAt = now

    const size = `${video.videoWidth}x${video.videoHeight}`
    const updating = fps === null ? advancing : fps > 0
    const lines = [
      `XR: ${presenting ? 'presenting' : 'not presenting'}`,
      `remote video: ${size}`,
      `frames: ${updating ? 'updating' : 'NOT updating'}${fps === null ? '' : ` (${fps.toFixed(0)} fps)`}`,
    ]
    if (video.videoWidth && size !== EXPECTED_SIZE) lines.push(`WARNING expected ${EXPECTED_SIZE}`)
    hud.draw(lines)

    if (video.videoWidth && size !== warnedSize) {
      warnedSize = size
      if (size === EXPECTED_SIZE) console.log(`[per-eye] remote video is ${size}`)
      else console.warn(`[per-eye] remote video is ${size}, expected ${EXPECTED_SIZE}`)
    }
  }

  function update() {
    const presenting = renderer.xr.isPresenting
    const halfHeight = PLANE_WIDTH_M / eyeAspect / 2

    if (presenting) {
      // Same spot for both eyes; each eye sees only its own mesh.
      leftMesh.position.copy(XR_POSITION)
      rightMesh.position.copy(XR_POSITION)
      leftLabel.mesh.visible = false
      rightLabel.mesh.visible = false
      // Above the video in VR, clear of the app's floating End call button below it.
      hud.mesh.position.set(XR_POSITION.x, XR_POSITION.y + halfHeight + 0.2, XR_POSITION.z)
    } else {
      // Laptop: side by side, labelled.
      const dx = (PLANE_WIDTH_M + DESKTOP_GAP_M) / 2
      leftMesh.position.set(DESKTOP_POSITION.x - dx, DESKTOP_POSITION.y, DESKTOP_POSITION.z)
      rightMesh.position.set(DESKTOP_POSITION.x + dx, DESKTOP_POSITION.y, DESKTOP_POSITION.z)
      leftLabel.mesh.visible = true
      rightLabel.mesh.visible = true
      leftLabel.mesh.position.set(leftMesh.position.x, halfHeight + 0.07, DESKTOP_POSITION.z)
      rightLabel.mesh.position.set(rightMesh.position.x, halfHeight + 0.07, DESKTOP_POSITION.z)
      hud.mesh.position.set(DESKTOP_POSITION.x, DESKTOP_POSITION.y - halfHeight - 0.2, DESKTOP_POSITION.z)
    }

    const now = performance.now()
    if (now - lastHudAt >= HUD_REFRESH_MS) updateHud(now, presenting)
  }

  function unmount() {
    video.removeEventListener('loadedmetadata', updateAspect)
    video.removeEventListener('resize', updateAspect)
    if (frameCallbackId !== null && video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(frameCallbackId)
    camera.layers.mask = originalCameraMask
    scene.remove(group)
    geometry.dispose()
    leftMaterial.dispose()
    rightMaterial.dispose()
    texture.dispose()
    for (const { mesh } of [leftLabel, rightLabel, hud]) {
      mesh.geometry.dispose()
      mesh.material.map.dispose()
      mesh.material.dispose()
    }
    // The video element belongs to the app: it is never stopped or paused here.
  }

  return { update, unmount }
}
