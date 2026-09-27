import { useEffect, useRef, useState } from 'react'
import { isStereoLayout } from '../services/media'

const DEFAULT_EYE_ASPECT = 16 / 9

// Shows a MediaStream inside a box and never lets it overflow.
//   layout "mono":       the whole video, object-fit cover or contain.
//   layout "stereo-sbs": only the LEFT EYE (left half of the frame), fitted the same way,
//                        with a small "3D" badge.
// fit: "cover" fills the box (cropping), "contain" shows everything (bars).
export default function StreamVideo({
  stream,
  layout = 'mono',
  fit = 'cover',
  mirrored = false,
  className = '',
  label,
  muted = false,
  onPlaying,
}) {
  const videoRef = useRef(null)
  const [eyeAspect, setEyeAspect] = useState(DEFAULT_EYE_ASPECT)
  const isStereo = isStereoLayout(layout)

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream ?? null
  }, [stream])

  // One eye is half the frame's width.
  function updateEyeAspect(event) {
    const { videoWidth, videoHeight } = event.currentTarget
    if (videoWidth && videoHeight) setEyeAspect(videoWidth / 2 / videoHeight)
  }

  const classes = [
    'stream-video',
    `stream-video--${fit}`,
    isStereo && 'stream-video--stereo',
    mirrored && 'stream-video--mirrored',
    className,
  ]

  return (
    <div className={classes.filter(Boolean).join(' ')} style={{ '--eye-aspect': eyeAspect }}>
      <div className="stream-video__frame">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={muted}
          aria-label={label}
          onPlaying={onPlaying}
          onLoadedMetadata={updateEyeAspect}
          onResize={updateEyeAspect}
        />
      </div>
      {isStereo && (
        <span className="badge-3d" title="3D video (two cameras)">
          3D
        </span>
      )}
    </div>
  )
}
