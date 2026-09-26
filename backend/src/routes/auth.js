import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { findUserByUsername, toPublicUser } from '../data/users.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();

router.post('/login', async (req, res) => {
  const { username, password } = req.body ?? {};

  if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
    return res.status(400).json({ error: 'Please enter your username and password.' });
  }

  const user = findUserByUsername(username);
  const passwordMatches = user ? await bcrypt.compare(password, user.passwordHash) : false;

  if (!user || !passwordMatches) {
    console.log(`[auth] Failed login for "${username}"`);
    return res.status(401).json({ error: 'Username or password is incorrect.' });
  }

  const token = jwt.sign({ sub: user.id }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
  console.log(`[auth] ${user.name} logged in`);
  res.json({ token, user: toPublicUser(user) });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: toPublicUser(req.user) });
});

export default router;
