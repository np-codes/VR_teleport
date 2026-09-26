import 'dotenv/config';

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
};

if (config.jwtSecret === 'change-me') {
  console.warn('[config] JWT_SECRET is not set. Using an insecure default — set it in backend/.env.');
}
