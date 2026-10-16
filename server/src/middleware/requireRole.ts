import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { ParticipantRole } from '../db/types.js';
import { participantsRepository } from '../db/participants.repository.js';
import { readRoleClaim, assignParticipantRoleClaim } from '../utils/roleClaims.js';

type RoleFailureCode =
  | 'UNAUTHORIZED'
  | 'ROLE_NOT_ASSIGNED'
  | 'INVALID_ROLE_CLAIM'
  | 'ROLE_MISMATCH'
  | 'FORBIDDEN_ROLE';

function deny(res: Response, status: number, code: RoleFailureCode, error: string): void {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json({ error, code });
}

/**
 * Enforces PART / ADMIN authorization from the Firebase `role` custom claim (US-003).
 * Must be mounted after `requireFirebaseAuth`.
 *
 * - A valid claim outside `allowedRoles` is rejected with 403 FORBIDDEN_ROLE.
 * - An unrecognised claim value is rejected with 403 INVALID_ROLE_CLAIM.
 * - ADMIN claims are cross-checked against the participant record so a demoted
 *   administrator's still-unexpired token cannot keep admin access (403 ROLE_MISMATCH).
 * - Participants registered before claims were issued have no claim yet: if their
 *   participant record is PART they are treated as PART and the claim is backfilled
 *   for future tokens. A missing claim never resolves to ADMIN.
 *
 * On success the resolved role is attached to `req.authRole`.
 */
export function requireRole(...allowedRoles: ParticipantRole[]): RequestHandler {
  if (allowedRoles.length === 0) {
    throw new Error('requireRole() needs at least one allowed role.');
  }

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const decoded = req.firebaseUser;
    if (!decoded) {
      deny(res, 401, 'UNAUTHORIZED', 'Authentication required. Missing or malformed Authorization header.');
      return;
    }

    const claim = readRoleClaim(decoded);
    if (claim.status === 'invalid') {
      deny(res, 403, 'INVALID_ROLE_CLAIM', 'Your account role is not recognised. Please contact support.');
      return;
    }

    let role: ParticipantRole;
    try {
      if (claim.status === 'valid' && claim.role === 'PART') {
        role = 'PART';
      } else {
        const participant = await participantsRepository.findByFirebaseUid(decoded.uid);

        if (claim.status === 'valid') {
          if (participant?.role !== 'ADMIN') {
            deny(res, 403, 'ROLE_MISMATCH', 'Your account role has changed. Please sign in again.');
            return;
          }
          role = 'ADMIN';
        } else {
          if (participant?.role !== 'PART') {
            deny(res, 403, 'ROLE_NOT_ASSIGNED', 'Your account does not have a role yet. Please contact support.');
            return;
          }
          role = 'PART';
          try {
            await assignParticipantRoleClaim(decoded.uid);
          } catch (claimErr: unknown) {
            const msg = claimErr instanceof Error ? claimErr.message : 'Unknown error';
            console.warn(`[AUTH] Failed to backfill PART role claim for ${decoded.uid}: ${msg}`);
          }
        }
      }
    } catch (err: unknown) {
      next(err);
      return;
    }

    if (!allowedRoles.includes(role)) {
      deny(res, 403, 'FORBIDDEN_ROLE', 'You do not have permission to access this resource.');
      return;
    }

    req.authRole = role;
    next();
  };
}

export const requireParticipantRole = requireRole('PART');
export const requireAdminRole = requireRole('ADMIN');
