import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { findUserById } from '../data/users.js';

// Verifies a JWT and returns the matching user, or null if it is invalid/expired.
export function verifyToken(token) {
  if (typeof token !== 'string' || token.length === 0) return null;
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    return findUserById(payload.sub);
  } catch {
    return null;
  }
}

export function requireAuth(req, res, next) {
  const header = req.get('Authorization') || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'You need to log in first.' });
  }

  const user = verifyToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Your session has expired. Please log in again.' });
  }

  req.user = user;
  next();
}
