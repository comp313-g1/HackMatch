import type { Request, Response, NextFunction } from 'express';
import { firebaseAuth } from '../config/firebase.js';
import { participantsRepository } from '../db/participants.repository.js';

/**
 * Express middleware enforcing US-001 AC 4, US-001-T5, and FR-002:
 * "Unverified accounts cannot declare availability, create teams, apply, or accept invitations."
 *
 * Verifies the incoming Firebase Bearer token, checks participant profile persistence,
 * and ensures participant.is_verified is TRUE before granting access to protected routes.
 */
export async function requireVerifiedParticipant(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  // 1. Validate presence and format of Authorization Bearer header
  if (!authHeader || typeof authHeader !== 'string') {
    res.status(401).json({
      error: 'Authentication required. Missing or malformed Authorization header.',
      code: 'UNAUTHORIZED',
    });
    return;
  }

  const parts = authHeader.trim().split(/\s+/);
  if (parts.length !== 2 || parts[0] !== 'Bearer' || !parts[1]) {
    res.status(401).json({
      error: 'Authentication required. Missing or malformed Authorization header.',
      code: 'UNAUTHORIZED',
    });
    return;
  }

  const token = parts[1];

  try {
    // 2. Verify Firebase ID token
    const decodedToken = await firebaseAuth.verifyIdToken(token);

    // 3. Resolve participant record in PostgreSQL/Supabase
    const participant = await participantsRepository.findByFirebaseUid(decodedToken.uid);

    if (!participant) {
      res.status(404).json({
        error: 'Participant record not found.',
        code: 'PARTICIPANT_NOT_FOUND',
      });
      return;
    }

    // 4. Enforce verification boundary
    if (!participant.is_verified) {
      res.status(403).json({
        error:
          'Email verification required. Unverified accounts cannot declare availability, create teams, apply, or accept invitations.',
        code: 'EMAIL_NOT_VERIFIED',
      });
      return;
    }

    // 5. Attach authenticated context and pass to downstream handler
    req.participant = participant;
    req.firebaseUser = decodedToken;
    next();
  } catch (err: unknown) {
    // Check if error is from Firebase token verification
    const isFirebaseTokenError =
      err &&
      typeof err === 'object' &&
      'code' in err &&
      typeof (err as { code: unknown }).code === 'string' &&
      (err as { code: string }).code.startsWith('auth/');

    if (
      isFirebaseTokenError ||
      (err instanceof Error &&
        (err.message.includes('token') ||
          err.message.includes('expired') ||
          err.message.includes('signature') ||
          err.message.includes('Decoding Firebase ID token failed')))
    ) {
      res.status(401).json({
        error: 'Invalid or expired authentication token.',
        code: 'INVALID_TOKEN',
      });
      return;
    }

    // Propagate unexpected errors (e.g. database failure) to centralized error handler
    next(err);
  }
}
