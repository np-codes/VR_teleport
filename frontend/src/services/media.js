const CAMERA_KEY = 'vrcall.cameraId'

export function getSavedCameraId() {
  return localStorage.getItem(CAMERA_KEY) || ''
}

export function saveCameraId(deviceId) {
  if (deviceId) localStorage.setItem(CAMERA_KEY, deviceId)
  else localStorage.removeItem(CAMERA_KEY)
}

export async function listCameras() {
  if (!navigator.mediaDevices?.enumerateDevices) return []
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices.filter((device) => device.kind === 'videoinput')
}

// Opens the saved camera and the microphone. Falls back to any camera if the
// saved one is unplugged.
export async function getLocalMedia() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('This browser cannot use the camera. Open the app over https.')
  }

  const cameraId = getSavedCameraId()
  const video = { width: { ideal: 1920 } }

  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: cameraId ? { ...video, deviceId: { exact: cameraId } } : video,
    })
  } catch (error) {
    if (cameraId && (error.name === 'OverconstrainedError' || error.name === 'NotFoundError')) {
      return navigator.mediaDevices.getUserMedia({ audio: true, video })
    }
    throw error
  }
}

export function stopStream(stream) {
  stream?.getTracks().forEach((track) => track.stop())
}
