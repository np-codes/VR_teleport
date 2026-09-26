# VR Call

A two-person video calling app that works in a normal desktop browser and in the
Meta Quest browser (WebXR). You can watch the other person as flat video, as a
360° sphere, or as 180° 3D, and step into it with **Enter VR**.

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
5. Try **Mute**, **Camera off**, and the **Flat / 360° / 180° 3D** switch. In 360°
   and 180° you can drag to look around.
6. Click **End call**. Both tabs go back to Home and show "Call ended".

Also worth trying: **Decline**, **Cancel**, and not answering for 30 seconds ("No answer").

To use an Insta360 EVO or OBS Virtual Camera, pick it in the **Camera** dropdown
on Home before calling. The choice is remembered in this browser.

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

## API

| Method | Path               | Auth   | Response                                   |
| ------ | ------------------ | ------ | ------------------------------------------ |
| POST   | `/api/auth/login`  | –      | `{ token, user: { id, name } }` or 401     |
| GET    | `/api/auth/me`     | Bearer | `{ user }`                                 |
| GET    | `/api/contacts`    | Bearer | `{ contacts: [{ id, name, online }] }`     |
| GET    | `/api/ice-servers` | Bearer | `{ iceServers: [...] }`                    |
| GET    | `/api/health`      | –      | `{ ok: true }`                             |

Socket.IO connects with `auth: { token }`. The server relays `call:*` and `webrtc:*`
events only between the two people in a call. It replies `call:unavailable` when
the other person is offline and `call:busy` when they're already in a call.

## Scripts

- `backend`: `npm run dev` (auto-restart), `npm start`
- `frontend`: `npm run dev`, `npm run build`, `npm run lint`
