import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireFirebaseAuth } from '../middleware/requireFirebaseAuth.js';
import { requireMfa } from '../middleware/requireMfa.js';
import { requireActiveAccount } from '../middleware/requireActiveAccount.js';
import { requireParticipantRole } from '../middleware/requireRole.js';
import { requireVerifiedParticipant } from '../middleware/requireVerifiedParticipant.js';
import { requireJsonObjectBody } from '../validators/team.validator.js';
import { validateAvailabilityUpdateBody } from '../validators/availability.validator.js';
import {
  AvailabilityServiceError,
  getMyPlatformAvailability,
  updateMyPlatformAvailability,
  listAvailableCandidates,
} from '../services/availability.service.js';

export const availabilityRouter = Router();

const availabilityAuthGuard = [
  requireFirebaseAuth,
  requireMfa,
  requireActiveAccount,
  requireParticipantRole,
  requireVerifiedParticipant,
];

/**
 * GET /api/availability/me
 * Returns the authenticated verified participant's platform-wide availability preferences.
 */
availabilityRouter.get(
  '/me',
  ...availabilityAuthGuard,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const availability = await getMyPlatformAvailability(req.participant!.id);
      res.status(200).json({ status: 'ok', availability });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PUT /api/availability/me
 * Updates the authenticated verified participant's platform-wide availability preferences.
 */
availabilityRouter.put(
  '/me',
  ...availabilityAuthGuard,
  requireJsonObjectBody,
  validateAvailabilityUpdateBody,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const availability = await updateMyPlatformAvailability(req.participant!.id, req.body);
      res.status(200).json({ status: 'ok', availability });
    } catch (err) {
      if (err instanceof AvailabilityServiceError) {
        res.status(err.status).json({
          error: err.message,
          code: err.code,
          fieldErrors: err.fieldErrors,
          errors: err.fieldErrors,
        });
        return;
      }
      next(err);
    }
  }
);

/**
 * GET /api/availability
 * Returns eligible available candidate cards for authenticated verified participants.
 * Unauthenticated visitors and unverified users are rejected by the guard chain.
 */
availabilityRouter.get(
  '/',
  ...availabilityAuthGuard,
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const candidates = await listAvailableCandidates();
      res.status(200).json({ status: 'ok', candidates });
    } catch (err) {
      next(err);
    }
  }
);
