import { CAMERA_3D, CAMERA_DEFAULT } from '../services/media'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'

// Radix Select can't use '' as a value, so the default webcam gets its own key here.
const DEFAULT_KEY = 'default-webcam'

// Camera picker: the default webcam, each webcam by name, and the two-webcam 3D camera.
export default function CameraSelect({ webcams, value, onChange, disabled = false, className, label = 'Camera' }) {
  const listed = webcams.filter((cam) => cam.deviceId)
  const isListed = value === CAMERA_DEFAULT || value === CAMERA_3D || listed.some((cam) => cam.deviceId === value)

  return (
    <Select
      value={value === CAMERA_DEFAULT ? DEFAULT_KEY : value}
      onValueChange={(next) => onChange(next === DEFAULT_KEY ? CAMERA_DEFAULT : next)}
      disabled={disabled}
    >
      <SelectTrigger aria-label={label} className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={DEFAULT_KEY}>Default webcam</SelectItem>
        {listed.map((cam, index) => (
          <SelectItem key={cam.deviceId} value={cam.deviceId}>
            {cam.label || `Webcam ${index + 1}`}
          </SelectItem>
        ))}
        {/* A webcam chosen earlier whose name the browser isn't showing yet. */}
        {!isListed && <SelectItem value={value}>Chosen webcam</SelectItem>}
        <SelectItem value={CAMERA_3D}>3D camera (2 webcams)</SelectItem>
      </SelectContent>
    </Select>
  )
}
