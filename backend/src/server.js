import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import authRoutes from './routes/auth.js';
import contactRoutes from './routes/contacts.js';
import iceServerRoutes from './routes/iceServers.js';
import camera3dRoutes from './routes/camera3d.js';
import { killCamera3dNow, stopCamera3d } from './camera3d.js';
import { createSocketServer } from './socket/index.js';

const app = express();

app.use(cors({ origin: config.clientOrigin }));
app.use(express.json({ limit: '10kb' }));

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/ice-servers', iceServerRoutes);
app.use('/api/camera3d', camera3dRoutes);

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// Catches bad JSON bodies and anything unexpected, always answering with JSON.
app.use((err, req, res, _next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'The request body is not valid JSON.' });
  }
  console.error('[server] Unexpected error:', err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

const httpServer = http.createServer(app);
createSocketServer(httpServer);

httpServer.listen(config.port, () => {
  console.log(`[server] Listening on http://localhost:${config.port}`);
});

// Never leave the 3D cameras on when the backend stops.
async function shutdown(signal) {
  console.log(`[server] ${signal} received, shutting down`);
  await stopCamera3d('backend shutting down');
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('exit', killCamera3dNow);
