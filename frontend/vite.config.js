import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { defineConfig } from 'vite'

// HTTPS (self-signed) is required for camera access and WebXR on the Quest.
// The frontend only calls relative URLs, and Vite forwards them to the backend.
export default defineConfig({
  plugins: [react(), basicSsl()],
  optimizeDeps: {
  include: ['three', 'three/examples/jsm/webxr/VRButton.js'],
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
      '/socket.io': { target: 'http://localhost:4000', ws: true },
    },
  },
})
