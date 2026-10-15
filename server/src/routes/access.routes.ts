import { Router, Request, Response } from 'express';
import { requireFirebaseAuth } from '../middleware/requireFirebaseAuth.js';
import { requireMfa } from '../middleware/requireMfa.js';
import { requireParticipantRole, requireAdminRole } from '../middleware/requireRole.js';

export const accessRouter = Router();

/**
 * Role-gated access checks (US-003). The client can call these to decide whether to
 * show participant or administrator areas; the same middleware chain protects real routes:
 * valid ID token -> completed email MFA (US-004) -> role claim.
 */
function grant(req: Request, res: Response): void {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    access: 'granted',
    role: req.authRole,
    uid: req.firebaseUser?.uid,
  });
}

accessRouter.get('/participant', requireFirebaseAuth, requireMfa, requireParticipantRole, grant);

accessRouter.get('/admin', requireFirebaseAuth, requireMfa, requireAdminRole, grant);
