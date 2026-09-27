import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The backend folder; relative paths in .env are resolved from here.
const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  port: Number(process.env.PORT) || 4000,
  jwtSecret: process.env.JWT_SECRET || 'change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  clientOrigin: process.env.CLIENT_ORIGIN || 'https://localhost:5173',
  turn: {
    url: process.env.TURN_URL || '',
    username: process.env.TURN_USERNAME || '',
    password: process.env.TURN_PASSWORD || '',
  },
  // 3D camera: the Python that has opencv/numpy/pyvirtualcam, and the two_cams script.
  camera3d: {
    pythonPath: process.env.PYTHON_PATH || 'python',
    script: path.resolve(backendDir, process.env.TWO_CAMS_SCRIPT || 'src/utils/two_cams/view.py'),
    args: (process.env.TWO_CAMS_ARGS || '').split(/\s+/).filter(Boolean),
  },
};

if (config.jwtSecret === 'change-me') {
  console.warn('[config] JWT_SECRET is not set. Using an insecure default — set it in backend/.env.');
}
