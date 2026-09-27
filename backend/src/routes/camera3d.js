import { Router } from 'express';
import { findUserById } from '../data/users.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { getCamera3dOwner, getCamera3dStatus, startCamera3d, stopCamera3d } from '../camera3d.js';
import { isInAcceptedCall } from '../socket/index.js';

const router = Router();

router.use(requireAuth);

// Someone else's 3D camera can't be started or stopped from another account.
function isUsedBySomeoneElse(req, res) {
  const ownerId = getCamera3dOwner();
  if (!ownerId || ownerId === req.user.id) return false;
  const owner = findUserById(ownerId);
  res.status(409).json({ error: `The 3D camera is being used by ${owner?.name ?? 'someone else'}.` });
  return true;
}

router.get('/status', (req, res) => {
  res.json(getCamera3dStatus());
});

// Returns right away; poll /status to see "starting" → "ready" or "error".
router.post('/start', (req, res) => {
  // Cameras stay off until the call has been accepted.
  if (!isInAcceptedCall(req.user.id)) {
    return res.status(409).json({ error: 'The 3D camera can only start during an accepted call.' });
  }
  if (isUsedBySomeoneElse(req, res)) return;
  res.json(startCamera3d(req.user.id));
});

// Waits until the script has exited (cameras released), at most ~3 s.
router.post('/stop', async (req, res) => {
  if (isUsedBySomeoneElse(req, res)) return;
  res.json(await stopCamera3d(`requested by ${req.user.name}`));
});

export default router;
