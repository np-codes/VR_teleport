import { Router } from 'express';
import { config } from '../config.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();

// STUN works on the same network. Calls across different networks need TURN.
router.get('/', requireAuth, (req, res) => {
  const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];

  if (config.turn.url) {
    iceServers.push({
      urls: config.turn.url,
      username: config.turn.username,
      credential: config.turn.password,
    });
  }

  res.json({ iceServers });
});

export default router;
