import { CAMERA_3D, CAMERA_DEFAULT } from '../services/media'

// Camera dropdown: the default webcam, each webcam by name, and the two-webcam 3D camera.
export default function CameraSelect({ id, webcams, value, onChange, disabled = false, className = 'input' }) {
  const isListed = value === CAMERA_DEFAULT || value === CAMERA_3D || webcams.some((cam) => cam.deviceId === value)

  return (
    <select id={id} className={className} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>
      <option value={CAMERA_DEFAULT}>Default webcam</option>
      {webcams.map((cam, index) => (
        <option key={cam.deviceId || index} value={cam.deviceId}>
          {cam.label || `Webcam ${index + 1}`}
        </option>
      ))}
      {/* A webcam chosen earlier whose name the browser isn't showing yet. */}
      {!isListed && <option value={value}>Chosen webcam</option>}
      <option value={CAMERA_3D}>3D camera (2 webcams)</option>
    </select>
  )
}
