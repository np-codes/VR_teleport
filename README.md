# VR Call

A two-person video calling app that works in a normal desktop browser and in the
Meta Quest browser (WebXR). Pick the camera on Home or during the call: a normal webcam, or
two webcams as a 3D camera (on the page you see the left eye, and with **Enter VR** you see
the other person in 3D). A **Flat / 180°** switch changes how you see the other person.

```
vr-call/
  frontend/   Vite + React app (UI, WebRTC, WebXR)
  backend/    Node.js server (login, contacts, Socket.IO signaling)
```

## Setup

You need Node.js 20.19+ or 22.12+ (required by Vite).

```bash
cd backend
npm install
cp .env.example .env      # then set JWT_SECRET to a long random string

cd ../frontend
npm install
```

## Run

Use two terminals.

```bash
# Terminal 1
cd backend
npm run dev               # http://localhost:4000

# Terminal 2
cd frontend
npm run dev               # https://localhost:5173
```

The frontend only calls relative URLs (`/api/...`, `/socket.io`). Vite serves the
page over HTTPS and forwards those requests to the backend, so there are no
mixed-content or CORS problems, even on the Quest.

## Demo users

| Name   | Username | Password |
| ------ | -------- | -------- |
| Colson | colson   | demo123  |
| Jenil  | jenil    | demo123  |

They're defined in `backend/src/data/users.js` and will move to a database later.

## Test on one computer

1. Open **two tabs** at <https://localhost:5173> and accept the certificate warning
   (the dev certificate is self-signed).
2. Log in as **Colson** in one tab and **Jenil** in the other. Each tab keeps its
   own login because the token is stored in `sessionStorage`.
3. In Colson's tab, click **Call** next to Jenil.
4. In Jenil's tab, click **Pick up**.
5. Try **Mute**, **Camera off**, and the **Flat / 180°** switch (180° wraps the video around
   you; drag to look around, or press **Enter VR** to be inside it). If a side has no camera,
   the other side sees "No video" and the call continues with audio.
6. Click **End call**. Both tabs go back to Home and show "Call ended".

Also worth trying: **Decline**, **Cancel**, and not answering for 30 seconds ("No answer").

## Test on the Meta Quest

1. Put the computer and the Quest on the **same Wi-Fi**.
2. When you run `npm run dev` in `frontend`, Vite prints a **Network** URL like
   `https://192.168.1.20:5173`.
3. Open that URL in the **Quest Browser**, accept the certificate warning
   (Advanced → Proceed), and log in as the user who isn't logged in on the computer.
4. Call or pick up as usual, then press **Enter VR**. Inside VR, a red
   **End call** button floats in front of you. It works with controllers and hand
   tracking.

If Windows asks, allow Node.js through the firewall so the Quest can reach port 5173.

## Calls between different networks

STUN (`stun:stun.l.google.com:19302`) is enough on the same network. For calls
across different networks (for example, home Wi-Fi to mobile data), you need a TURN
server. Set it in `backend/.env`:

```
TURN_URL=turn:your-turn-server.example.com:3478
TURN_USERNAME=user
TURN_PASSWORD=secret
```

## 3D Camera (two webcams)

Two USB webcams (for example 2x NexiGo N60) can act as a left and right eye. The
backend starts `backend\src\utils\two_cams\view.py`, which puts both pictures side by
side (**left eye | right eye**, 2560x720) and sends them to **OBS Virtual Camera**. The
browser then uses that as its camera. The other person sees the left eye on the page, and
true 3D (each eye sees its own half) after pressing **Enter VR**.

**This only works when the backend runs on the laptop the two cameras are plugged
into**, and you use the browser on that same laptop.

Setup (once):

1. Install **OBS Studio**. You don't need to open it. Don't press its own
   **Start Virtual Camera** button: the script drives the virtual camera itself.
2. Install the Python packages into the Python you'll use (for example the conda env):

   ```powershell
   C:\Users\nisar\miniforge3\envs\vrteleport\python.exe -m pip install -r backend\src\utils\two_cams\requirements.txt
   ```

3. Set these in `backend\.env`:

   | Variable          | Default                          | Meaning                                                    |
   | ----------------- | -------------------------------- | ---------------------------------------------------------- |
   | `PYTHON_PATH`     | `python`                         | Full path to the Python that has opencv, numpy, pyvirtualcam |
   | `TWO_CAMS_SCRIPT` | `src/utils/two_cams/view.py`     | The script (relative to `backend`, or a full path)         |
   | `TWO_CAMS_ARGS`   | (empty)                          | Extra options, e.g. `--left 3 --right 2 --backend msmf`     |

How it behaves:

- Pick **3D camera (2 webcams)** in the **Camera** dropdown on Home, or during the call
  (the other choices are the default webcam and each webcam by name). Switching during the
  call doesn't reconnect it. Leaving the 3D camera turns its two webcams off right away.
- Cameras and microphone stay **off until the call is accepted**. Then the call connects
  right away (audio first), and the 3D camera starts in the background ("Starting 3D
  camera…"). Its video appears when it's ready, however long that takes; a slow start never
  ends the call. The backend refuses to start the cameras outside an accepted call.
- A device without the 3D camera (for example the Quest) joins without video, and the
  other side sees "No video".
- The webcams turn off when the call ends, if you disconnect, and when the backend stops.

To test the cameras on their own, see `backend\src\utils\two_cams\README.md`.

## API

| Method | Path                     | Auth   | Response                                                    |
| ------ | ------------------------ | ------ | ----------------------------------------------------------- |
| POST   | `/api/auth/login`        | –      | `{ token, user: { id, name } }` or 401                      |
| GET    | `/api/auth/me`           | Bearer | `{ user }`                                                  |
| GET    | `/api/contacts`          | Bearer | `{ contacts: [{ id, name, online }] }`                      |
| GET    | `/api/ice-servers`       | Bearer | `{ iceServers: [...] }`                                     |
| POST   | `/api/camera3d/start`    | Bearer | Starts the 3D camera (only during an accepted call, else 409), returns its status right away |
| POST   | `/api/camera3d/stop`     | Bearer | Stops it (kills it after 3 s if needed), returns status     |
| GET    | `/api/camera3d/status`   | Bearer | `{ state: "off"\|"starting"\|"ready"\|"error", message, width, height, fps, gap_ms }` |
| GET    | `/api/health`            | –      | `{ ok: true }`                                              |

Try the 3D camera API from PowerShell:

```powershell
$token = (Invoke-RestMethod -Method Post http://localhost:4000/api/auth/login -ContentType 'application/json' -Body '{"username":"colson","password":"demo123"}').token
$h = @{ Authorization = "Bearer $token" }
Invoke-RestMethod -Method Post http://localhost:4000/api/camera3d/start -Headers $h   # 409 unless you're in an accepted call
Invoke-RestMethod http://localhost:4000/api/camera3d/status -Headers $h
Invoke-RestMethod -Method Post http://localhost:4000/api/camera3d/stop -Headers $h
```

Socket.IO connects with `auth: { token }`. The server relays `call:*` and `webrtc:*`
events only between the two people in a call. It replies `call:unavailable` when
the other person is offline and `call:busy` when they're already in a call.
`webrtc:offer` / `webrtc:answer` carry `layout: "none" | "stereo-sbs"`, and `call:layout`
announces when someone's 3D video starts.

## Scripts

- `backend`: `npm run dev` (auto-restart), `npm start`
- `frontend`: `npm run dev`, `npm run build`, `npm run lint`
