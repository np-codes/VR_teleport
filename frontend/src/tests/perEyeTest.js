// Isolated WebXR per-eye test (Phase 1: red / blue, no video). Not part of the app.
// Open /stereo-test.html on the Vite dev server.
//
// three.js (0.186, WebXRManager.updateCamera) gives the XR eye cameras these layers every frame:
//   left eye  = normal camera's layers + layer 1, never layer 2
//   right eye = normal camera's layers + layer 2, never layer 1
// So a mesh on layer 1 is drawn only for the left eye and a mesh on layer 2 only for the right.

import * as THREE from 'three'
import { VRButton } from 'three/addons/webxr/VRButton.js'

const EYE_HEIGHT_M = 1.6 // local-floor: y = 0 is the floor
const DISTANCE_M = 1.5
const PLANE_WIDTH_M = 1
const PLANE_HEIGHT_M = PLANE_WIDTH_M * (9 / 16)
const DESKTOP_OFFSET_M = 0.55 // side by side on the laptop only
const LEFT_EYE_LAYER = 1
const RIGHT_EYE_LAYER = 2

const hudElement = document.getElementById('hud')

// ----- Renderer, scene, camera -----

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(window.devicePixelRatio)
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.xr.enabled = true
renderer.xr.setReferenceSpaceType('local-floor')
document.body.appendChild(renderer.domElement)
document.body.appendChild(VRButton.createButton(renderer))

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x202020)

// The desktop camera sees layers 0, 1 and 2, so both planes show on the laptop.
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 100)
camera.position.set(0, EYE_HEIGHT_M, 0)
camera.layers.enable(LEFT_EYE_LAYER)
camera.layers.enable(RIGHT_EYE_LAYER)

// ----- Planes -----

// A colored card with a big label, drawn on a canvas (no font files needed).
function createLabelTexture(background, text) {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 288
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = background
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 56px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, canvas.width / 2, canvas.height / 2)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function createEyePlane(background, text, layer) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(PLANE_WIDTH_M, PLANE_HEIGHT_M),
    new THREE.MeshBasicMaterial({ map: createLabelTexture(background, text) }),
  )
  mesh.layers.set(layer)
  mesh.position.set(0, EYE_HEIGHT_M, -DISTANCE_M)
  scene.add(mesh)
  return mesh
}

const redPlane = createEyePlane('#ff0000', 'LEFT EYE', LEFT_EYE_LAYER)
const bluePlane = createEyePlane('#0000ff', 'RIGHT EYE', RIGHT_EYE_LAYER)

// ----- HUD (page text + a small panel in VR, on layer 0 so both eyes see it) -----

const hudCanvas = document.createElement('canvas')
hudCanvas.width = 1024
hudCanvas.height = 256
const hudTexture = new THREE.CanvasTexture(hudCanvas)
hudTexture.colorSpace = THREE.SRGBColorSpace
const hudPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 0.25),
  new THREE.MeshBasicMaterial({ map: hudTexture, transparent: true }),
)
hudPlane.position.set(0, EYE_HEIGHT_M - 0.5, -DISTANCE_M)
scene.add(hudPlane)

function describeMask(mask) {
  const layers = []
  for (let i = 0; i < 32; i++) if (mask & (1 << i)) layers.push(i)
  return `0b${mask.toString(2).padStart(3, '0')} (layers ${layers.join(',')})`
}

let lastHudText = ''

function updateHud() {
  const presenting = renderer.xr.isPresenting
  const lines = [
    `XR session: ${presenting ? 'presenting' : 'not presenting'}`,
    `desktop camera: ${describeMask(camera.layers.mask)}`,
  ]
  if (presenting) {
    const [leftEye, rightEye] = renderer.xr.getCamera().cameras
    lines.push(`left eye camera:  ${leftEye ? describeMask(leftEye.layers.mask) : '-'}`)
    lines.push(`right eye camera: ${rightEye ? describeMask(rightEye.layers.mask) : '-'}`)
  }
  lines.push(`red plane:  ${describeMask(redPlane.layers.mask)}`)
  lines.push(`blue plane: ${describeMask(bluePlane.layers.mask)}`)

  const text = lines.join('\n')
  if (text === lastHudText) return
  lastHudText = text
  console.log(`[per-eye test]\n${text}`)
  hudElement.textContent = text

  const ctx = hudCanvas.getContext('2d')
  ctx.clearRect(0, 0, hudCanvas.width, hudCanvas.height)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.75)'
  ctx.fillRect(0, 0, hudCanvas.width, hudCanvas.height)
  ctx.fillStyle = '#ffffff'
  ctx.font = '26px ui-monospace, Consolas, monospace'
  lines.forEach((line, i) => ctx.fillText(line, 20, 38 + i * 36))
  hudTexture.needsUpdate = true
}

renderer.xr.addEventListener('sessionstart', () => console.log('[per-eye test] XR session started'))
renderer.xr.addEventListener('sessionend', () => console.log('[per-eye test] XR session ended'))

// ----- Loop -----

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

// setAnimationLoop drives both the page and the XR session (XR frames while presenting).
renderer.setAnimationLoop(() => {
  // In VR both planes sit in the same place (each eye sees one); on the laptop, side by side.
  const offset = renderer.xr.isPresenting ? 0 : DESKTOP_OFFSET_M
  redPlane.position.x = -offset
  bluePlane.position.x = offset
  renderer.render(scene, camera)
  updateHud() // after render: the eye cameras' masks are updated during render
})
