import { Router } from 'express';
import { getAllUsers, toPublicUser } from '../data/users.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { isOnline } from '../socket/index.js';

const router = Router();

// Everyone except the logged-in user, with their live online status.
router.get('/', requireAuth, (req, res) => {
  const contacts = getAllUsers()
    .filter((user) => user.id !== req.user.id)
    .map((user) => ({ ...toPublicUser(user), online: isOnline(user.id) }));

  res.json({ contacts });
});

export default router;
