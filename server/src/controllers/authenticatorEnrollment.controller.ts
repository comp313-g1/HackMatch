import type { Request, Response } from 'express';
import {
  AuthenticatorEnrollmentError,
  beginAuthenticatorEnrollment as beginEnrollment,
  confirmAuthenticatorEnrollment as confirmEnrollment,
  getAuthenticatorEnrollmentStatus as getEnrollmentStatus,
  restartAuthenticatorEnrollment as restartEnrollment,
  type AuthenticatorEnrollmentErrorCode,
  type AuthenticatorOwnerContext,
} from '../services/authenticatorEnrollment.js';
import {
  beginAuthenticatorReplacement as beginReplacement,
  confirmAuthenticatorReplacement as confirmReplacement,
  disableAuthenticator as disableActiveAuthenticator,
  generateRecoveryCodes as generateCodes,
  getRecoveryCodeStatus as getCodeStatus,
} from '../services/authenticatorRecoveryControls.js';

const SAFE_ERROR_RESPONSES: Record<
  AuthenticatorEnrollmentErrorCode,
  { status: number; error: string; retryable?: boolean }
> = {
  AUTHENTICATOR_ALREADY_ACTIVE: {
    status: 409,
    error: 'An authenticator is already active for this account.',
  },
  AUTHENTICATOR_ENROLLMENT_PENDING: {
    status: 409,
    error: 'An authenticator enrollment is already pending for this account.',
  },
  AUTHENTICATOR_ENROLLMENT_NOT_PENDING: {
    status: 409,
    error: 'There is no pending authenticator enrollment to confirm.',
  },
  AUTHENTICATOR_ENROLLMENT_EXPIRED: {
    status: 410,
    error: 'The authenticator enrollment has expired. Start enrollment again.',
  },
  AUTHENTICATOR_ENROLLMENT_STALE: {
    status: 409,
    error: 'This authenticator enrollment is no longer current. Start enrollment again.',
  },
  INVALID_AUTHENTICATOR_CODE: {
    status: 401,
    error: 'The authenticator code is incorrect or expired.',
  },
  AUTHENTICATOR_ENROLLMENT_UNAVAILABLE: {
    status: 503,
    error: 'Authenticator enrollment is temporarily unavailable. Please try again later.',
    retryable: true,
  },
  AUTHENTICATOR_CONFIGURATION_ERROR: {
    status: 503,
    error: 'Authenticator enrollment is temporarily unavailable. Please contact support if the problem continues.',
    retryable: false,
  },
  AUTHENTICATOR_NOT_ACTIVE: {
    status: 409,
    error: 'There is no active authenticator for this account.',
  },
  AUTHENTICATOR_REPLACEMENT_CONFIRMATION_REQUIRED: {
    status: 409,
    error: 'This code confirms a replacement authenticator. Finish the replacement to receive new recovery codes.',
  },
  RECOVERY_CODES_STALE: {
    status: 409,
    error: 'Your recovery codes were changed in another session. Review the latest status before generating new codes.',
  },
  RECOVERY_CODES_UNAVAILABLE: {
    status: 503,
    error: 'Recovery codes could not be generated. Your existing codes were not changed. Please try again.',
    retryable: true,
  },
};

function ownerFromRequest(req: Request, res: Response): AuthenticatorOwnerContext | null {
  const participant = req.participant;
  const firebaseUser = req.firebaseUser;
  const role = req.authRole;

  if (!participant || !firebaseUser || !role || participant.firebase_uid !== firebaseUser.uid) {
    res.status(403).json({
      error: 'This account is not eligible to manage an authenticator.',
      code: 'AUTHENTICATOR_ENROLLMENT_FORBIDDEN',
    });
    return null;
  }

  if (!participant.is_verified) {
    res.status(403).json({
      error: 'Email verification is required before authenticator enrollment.',
      code: 'EMAIL_NOT_VERIFIED',
    });
    return null;
  }

  return {
    participantId: participant.id,
    firebaseUid: firebaseUser.uid,
    role,
  };
}

function sendSafeEnrollmentError(res: Response, error: unknown): void {
  const normalized =
    error instanceof AuthenticatorEnrollmentError
      ? error
      : new AuthenticatorEnrollmentError('AUTHENTICATOR_ENROLLMENT_UNAVAILABLE', 503);
  const response = SAFE_ERROR_RESPONSES[normalized.code];

  res.status(response.status).json({
    error: response.error,
    code: normalized.code,
    ...(response.retryable !== undefined ? { retryable: response.retryable } : {}),
  });
}

export async function getAuthenticatorEnrollmentStatus(req: Request, res: Response): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  const owner = ownerFromRequest(req, res);
  if (!owner) return;

  try {
    const result = await getEnrollmentStatus(owner);
    res.status(200).json(result);
  } catch (error: unknown) {
    sendSafeEnrollmentError(res, error);
  }
}

export async function beginAuthenticatorEnrollment(req: Request, res: Response): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  const owner = ownerFromRequest(req, res);
  if (!owner) return;

  try {
    const result = await beginEnrollment(owner);
    res.status(201).json(result);
  } catch (error: unknown) {
    sendSafeEnrollmentError(res, error);
  }
}

export async function restartAuthenticatorEnrollment(req: Request, res: Response): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  const owner = ownerFromRequest(req, res);
  if (!owner) return;

  try {
    const result = await restartEnrollment(owner);
    res.status(201).json(result);
  } catch (error: unknown) {
    sendSafeEnrollmentError(res, error);
  }
}

export async function confirmAuthenticatorEnrollment(req: Request, res: Response): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  const owner = ownerFromRequest(req, res);
  if (!owner) return;

  try {
    const result = await confirmEnrollment(owner, req.body.enrollmentId, req.body.code);
    res.status(200).json(result);
  } catch (error: unknown) {
    sendSafeEnrollmentError(res, error);
  }
}

/** #269: begins a replacement while the current factor remains active. */
export async function beginAuthenticatorReplacement(req: Request, res: Response): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  const owner = ownerFromRequest(req, res);
  if (!owner) return;

  try {
    const result = await beginReplacement(owner);
    res.status(201).json(result);
  } catch (error: unknown) {
    sendSafeEnrollmentError(res, error);
  }
}

/** #269: activates the replacement and returns its fresh recovery set exactly once. */
export async function confirmAuthenticatorReplacement(req: Request, res: Response): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  const owner = ownerFromRequest(req, res);
  if (!owner) return;

  try {
    const result = await confirmReplacement(owner, req.body.enrollmentId, req.body.code);
    res.status(200).json(result);
  } catch (error: unknown) {
    sendSafeEnrollmentError(res, error);
  }
}

/** #269: retires the owner's active factor; email OTP stays mandatory. */
export async function disableAuthenticator(req: Request, res: Response): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  const owner = ownerFromRequest(req, res);
  if (!owner) return;

  try {
    const result = await disableActiveAuthenticator(owner);
    res.status(200).json(result);
  } catch (error: unknown) {
    sendSafeEnrollmentError(res, error);
  }
}

/** #269: count/timestamp summary only — never codes or verifiers. */
export async function getRecoveryCodeStatus(req: Request, res: Response): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  const owner = ownerFromRequest(req, res);
  if (!owner) return;

  try {
    const result = await getCodeStatus(owner);
    res.status(200).json(result);
  } catch (error: unknown) {
    sendSafeEnrollmentError(res, error);
  }
}

/** #269: returns a new raw recovery set to the owner exactly once. */
export async function generateRecoveryCodes(req: Request, res: Response): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  const owner = ownerFromRequest(req, res);
  if (!owner) return;

  try {
    const result = await generateCodes(owner, req.body.expectedBatchId);
    res.status(201).json(result);
  } catch (error: unknown) {
    sendSafeEnrollmentError(res, error);
  }
}
