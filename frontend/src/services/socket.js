import { io } from 'socket.io-client'

let socket = null

// Connects to the same origin; Vite proxies /socket.io to the backend.
export function connectSocket(token) {
  disconnectSocket()
  socket = io({ auth: { token } })
  return socket
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect()
    socket = null
  }
}
