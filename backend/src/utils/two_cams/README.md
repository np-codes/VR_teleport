# two_cams: 3D camera from two webcams

Two USB webcams (for example 2x NexiGo N60) act as the left and right eye.
`view.py` opens both at the same moment, puts their pictures side by side
(**left eye | right eye**, e.g. 2560x720 for 1280x720 per eye) and sends that frame to
**OBS Virtual Camera**. The browser then uses "OBS Virtual Camera" as its camera.

The web app backend starts and stops this script for you when you choose
**3D Camera (2 cameras)**. You only need to run it by hand to test the cameras.

## Requirements

- Windows, Python 3.11+.
- **OBS Studio** installed (it provides the "OBS Virtual Camera" device).
  Do **not** press OBS's own **Start Virtual Camera** button. This script drives the
  virtual camera itself, and OBS can't share it. OBS doesn't even need to be open.
- Python packages:

```powershell
cd C:\VR_teleport_web_app\vr-call\backend\src\utils\two_cams
C:\Users\nisar\miniforge3\envs\vrteleport\python.exe -m pip install -r requirements.txt
```

## Try it

```powershell
# preview window + send to OBS Virtual Camera (press q in the window to quit)
C:\Users\nisar\miniforge3\envs\vrteleport\python.exe view.py --preview

# only look at the cameras, don't touch the virtual camera
C:\Users\nisar\miniforge3\envs\vrteleport\python.exe view.py --preview --no-vcam
```

Ctrl+C also stops it. Both cameras and the virtual camera are always released.

## Options

| Option                        | Default | Meaning                                                   |
| ----------------------------- | ------- | --------------------------------------------------------- |
| `--left` / `--right`          | 2 / 3   | Camera indexes for the left and right eye                 |
| `--width` / `--height`        | 1280/720| Size **per eye** (output is twice as wide)                |
| `--fps`                       | 30      | Frames per second                                         |
| `--backend`                   | dshow   | `dshow`, `msmf` or `any` (try `msmf` if opening is slow)  |
| `--mjpg` / `--no-mjpg`        | on      | Compressed camera video; two USB 2.0 cameras usually need it. A warning is printed if a camera doesn't switch to MJPG |
| `--preview` / `--no-preview`  | off     | Show an OpenCV window                                     |
| `--vcam` / `--no-vcam`        | on      | Send to OBS Virtual Camera                                |
| `--open-timeout`              | 10      | Seconds to wait for both cameras                          |

If the left and right eyes are swapped, swap the indexes: `--left 3 --right 2`.

## Status lines (read by the backend)

One per line on stdout:

```
STATUS starting
STATUS ready 2560x720 30
STATS fps=30.0 gap_ms=14.8        (every 2 s; gap_ms = time between left and right frames)
STATUS error <message>
STATUS stopped
```

The script stops cleanly when its stdin closes (that's how the backend stops it).

## VS Code / Pylance

`vr-call\pyrightconfig.json` points Pylance at the `vrteleport` env's packages, so `cv2`
resolves even when VS Code's interpreter is a different Python. Pylance reads it only when
VS Code has the `vr-call` folder open (or select the `vrteleport` interpreter instead).

## If a camera doesn't work

- Close other apps that may use it (OBS preview, Camo, the browser, Teams).
- Plug the two cameras into different USB ports, not the same hub.
- Keep MJPG on, or lower the resolution: `--width 640 --height 480`.
- Try the other backend: `--backend msmf`.
