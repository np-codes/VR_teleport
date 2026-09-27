import { api } from './api'

// The camera is chosen on Home or during a call:
//  - a normal webcam ("mono"): the default one or a specific one
//  - the 3D camera: two webcams -> Python (backend) -> OBS Virtual Camera, as one frame with
//    the left eye | right eye side by side ("stereo-sbs")
export const LAYOUT_NONE = 'none' // no video (yet)
export const LAYOUT_MONO = 'mono'
export const LAYOUT_STEREO = 'stereo-sbs'

// Camera choices: '' = default webcam, a deviceId = that webcam, CAMERA_3D = the 3D camera.
export const CAMERA_DEFAULT = ''
export const CAMERA_3D = '3d-camera'

const CAMERA_KEY = 'vrcall.camera'
const OLD_USE_3D_KEY = 'vrcall.use3dCamera' // the earlier on/off switch
const OBS_CAMERA_LABEL = 'OBS Virtual Camera'
// Used by the 3D camera, so they aren't offered as normal webcams.
const HIDDEN_CAMERA = /OBS Virtual Camera|NexiGo N60/i
const POLL_INTERVAL_MS = 500

export function isStereoLayout(layout) {
  return layout === LAYOUT_STEREO
}

export function getSavedCamera() {
  const saved = localStorage.getItem(CAMERA_KEY)
  if (saved !== null) return saved
  return localStorage.getItem(OLD_USE_3D_KEY) === 'true' ? CAMERA_3D : CAMERA_DEFAULT
}

export function saveCamera(camera) {
  localStorage.setItem(CAMERA_KEY, camera)
}

// Normal webcams for the camera list. Browsers only show camera names once the page has used
// a camera (after the first call); until then this is empty and the list shows only
// "Default webcam" and "3D camera". Nothing is opened here.
export async function listWebcams() {
  const cameras = await listVideoInputs()
  if (cameras.every((camera) => !camera.label)) return []
  return cameras.filter((camera) => !HIDDEN_CAMERA.test(camera.label))
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function abortError() {
  const error = new Error('Cancelled')
  error.name = 'AbortError'
  return error
}

// Used when switching away from the 3D camera during a call, or if something goes wrong after
// it started. The backend also turns it off by itself when the call ends or the user disconnects.
export function stopCamera3d() {
  return api('/api/camera3d/stop', { method: 'POST' }).catch((error) =>
    console.warn('[camera3d] Could not stop the 3D camera', error),
  )
}

async function listVideoInputs() {
  if (!navigator.mediaDevices?.enumerateDevices) return []
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices.filter((device) => device.kind === 'videoinput')
}

// Device names are only visible after the page may use a camera. This runs after the call
// was accepted, before the 3D camera starts.
async function findObsCamera() {
  let cameras = await listVideoInputs()
  if (cameras.length > 0 && cameras.every((camera) => !camera.label)) {
    try {
      stopStream(await navigator.mediaDevices.getUserMedia({ video: true }))
      cameras = await listVideoInputs()
    } catch {
      // No camera access at all: treated as "no 3D camera" below.
    }
  }
  return cameras.find((camera) => camera.label.includes(OBS_CAMERA_LABEL)) ?? null
}

export function microphoneErrorMessage(error) {
  if (error.name === 'NotAllowedError') return 'Microphone access was blocked.'
  if (error.name === 'NotFoundError') return 'No microphone was found.'
  return 'The microphone could not be used.'
}

export async function getMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('This browser cannot use the microphone. Open the app over https.')
  }
  return navigator.mediaDevices.getUserMedia({ audio: true })
}

// Starts the two cameras on the backend, waits until they're ready (no time limit: they may be
// slow), then opens OBS Virtual Camera. Returns the video track, or null if this device has no
// 3D camera (for example the Quest). onProgress(text) shows progress; shouldCancel() stops
// waiting when the call has ended.
export async function openCamera3dTrack({ onProgress = () => {}, shouldCancel = () => false } = {}) {
  const obs = await findObsCamera()
  if (!obs) return null
  if (shouldCancel()) throw abortError()

  onProgress('Starting 3D camera…')
  let started = false
  try {
    let status = await api('/api/camera3d/start', { method: 'POST' })
    started = true
    while (status.state !== 'ready') {
      if (status.state === 'error') throw new Error(status.message || 'The 3D camera could not start.')
      if (status.state === 'off') throw new Error('The 3D camera stopped.')
      await wait(POLL_INTERVAL_MS)
      if (shouldCancel()) throw abortError()
      status = await api('/api/camera3d/status')
      onProgress(status.message || 'Starting 3D camera…')
    }

    onProgress('Opening 3D camera…')
    // resizeMode "none": Chrome remembers the sizes OBS Virtual Camera offered while it was idle
    // (up to 1920x1080) and would otherwise crop the real 2560x720 frames, cutting into each eye.
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: obs.deviceId }, width: { ideal: 2560 }, height: { ideal: 720 }, resizeMode: 'none' },
    })
    const track = stream.getVideoTracks()[0]
    if (shouldCancel()) {
      track.stop()
      throw abortError()
    }
    return track
  } catch (error) {
    // When the call ended, the backend already turns the cameras off.
    if (started && error.name !== 'AbortError') stopCamera3d()
    throw error
  } finally {
    onProgress('')
  }
}

const WEBCAM_SIZE = { width: { ideal: 1280 }, height: { ideal: 720 } }

// A normal webcam: the chosen one (deviceId), or the default one if none is chosen or it's
// unplugged. Never OBS Virtual Camera, which only shows a placeholder when the 3D camera isn't
// running. Returns the video track, or null if there's no webcam.
export async function openNormalCameraTrack(deviceId = CAMERA_DEFAULT) {
  let stream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: deviceId ? { ...WEBCAM_SIZE, deviceId: { exact: deviceId } } : WEBCAM_SIZE,
    })
  } catch (error) {
    if (deviceId && (error.name === 'NotFoundError' || error.name === 'OverconstrainedError')) {
      return openNormalCameraTrack(CAMERA_DEFAULT)
    }
    if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') return null
    throw error
  }
  let track = stream.getVideoTracks()[0]
  if (!track.label.includes(OBS_CAMERA_LABEL)) return track

  // The default camera happened to be OBS Virtual Camera: use the first real webcam instead.
  track.stop()
  const webcam = (await listVideoInputs()).find((camera) => !camera.label.includes(OBS_CAMERA_LABEL))
  if (!webcam) return null
  stream = await navigator.mediaDevices.getUserMedia({ video: { ...WEBCAM_SIZE, deviceId: { exact: webcam.deviceId } } })
  track = stream.getVideoTracks()[0]
  return track
}

export function cameraErrorMessage(error) {
  if (error.name === 'NotAllowedError') return 'Camera access was blocked.'
  if (error.name === 'NotReadableError') return 'The camera is being used by another app.'
  return error.message || 'The camera could not be used.'
}

export function stopStream(stream) {
  stream?.getTracks().forEach((track) => track.stop())
}
