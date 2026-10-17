import type { Request, Response, NextFunction } from 'express';
import {
  firebaseAuth,
  verifyEmailActionCode,
  sendVerificationEmail,
  sendPasswordResetEmail,
  inspectPasswordResetCode,
  confirmPasswordResetCode,
  getFirebaseAdminAuth,
} from '../config/firebase.js';
import { config } from '../config/index.js';
import { participantsRepository } from '../db/participants.repository.js';
import { providerIdentitiesRepository } from '../db/provider_identities.repository.js';
import { mfaRepository } from '../db/mfa.repository.js';
import type { Participant, OAuthProvider } from '../db/types.js';
import { rateLimiter } from '../utils/rateLimiter.js';
import {
  markPasswordResetCodeConsumed,
  wasPasswordResetCodeConsumed,
} from '../utils/consumedResetCodes.js';
import { clearMfaClaim, hasCompletedMfa } from '../utils/mfaClaim.js';
import { securityConfig } from '../config/security.js';
import { extractBearerToken, mapFirebaseAuthError } from '../middleware/requireFirebaseAuth.js';
import {
  sessionCookieOptions,
  csrfCookieOptions,
  generateCsrfToken,
  clearSessionCookies,
} from '../utils/sessionCookies.js';
import { ACCOUNT_SUSPENDED_MESSAGE } from '../middleware/requireActiveAccount.js';
import {
  issueMfaOtpForParticipant,
  _setMfaOtpEmailSender,
  _resetMfaOtpEmailSender,
} from '../services/issueMfaOtp.js';
import { verifyMfaOtpForParticipant } from '../services/verifyMfaOtp.js';
import { evaluateAccountLockout } from '../utils/otp.js';
import type { MfaOtpEmailSender } from '../utils/mfaOtpEmail.js';

export type { MfaOtpEmailSender };
export { _setMfaOtpEmailSender, _resetMfaOtpEmailSender };

/**
 * Issues a cryptographically random 6-digit MFA OTP after primary authentication
 * (POST /api/auth/mfa/challenge) — FR-009 / US-004 AC 1 / S1-P1-09.
 *
 * Requires a verified Firebase ID token and an active participant. Does not create
 * a session (FR-007). Email delivery failures return 502 without authenticating (FR-084).
 */
export async function issueMfaChallenge(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');

  try {
    const firebaseUser = req.firebaseUser;
    if (!firebaseUser?.uid) {
      res.status(401).json({
        error: 'Authentication required. Missing or malformed Authorization header.',
        code: 'UNAUTHORIZED',
      });
      return;
    }

    if (!firebaseUser.email || firebaseUser.email_verified !== true) {
      res.status(403).json({
        error: 'A verified email is required before a login code can be sent.',
        code: 'EMAIL_NOT_VERIFIED',
      });
      return;
    }

    let participant = req.participant;
    if (!participant) {
      participant =
        (await participantsRepository.findByFirebaseUid(firebaseUser.uid)) ?? undefined;
    }

    if (!participant) {
      res.status(404).json({
        error: 'No HackMatch account is linked to this sign-in. Please register first.',
        code: 'PARTICIPANT_NOT_FOUND',
      });
      return;
    }

    if (participant.is_suspended) {
      res.status(403).json({
        error: ACCOUNT_SUSPENDED_MESSAGE,
        code: 'ACCOUNT_SUSPENDED',
      });
      return;
    }

    const issued = await issueMfaOtpForParticipant(participant);
    if (!issued.ok) {
      if (issued.retryAfter != null) {
        res.setHeader('Retry-After', String(issued.retryAfter));
      }
      res.status(issued.status).json({
        error: issued.error,
        code: issued.code,
        ...(issued.retryAfter != null ? { retryAfter: issued.retryAfter } : {}),
        ...(issued.retryable != null ? { retryable: issued.retryable } : {}),
      });
      return;
    }

    res.status(200).json({
      requiresOtp: true,
      challengeId: issued.challengeId,
      email: issued.maskedEmail,
      expiresInSeconds: issued.expiresInSeconds,
      message: issued.message,
    });
  } catch (err: unknown) {
    next(err);
  }
}

/**
 * Verifies a 6-digit MFA OTP, atomically consumes the challenge, and sets the MFA claim
 * (POST /api/auth/mfa/verify) — US-004 AC 2 / FR-010 / S1-P1-11.
 */
export async function verifyMfaChallenge(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');

  try {
    const firebaseUser = req.firebaseUser;
    if (!firebaseUser?.uid) {
      res.status(401).json({
        error: 'Authentication required. Missing or malformed Authorization header.',
        code: 'UNAUTHORIZED',
      });
      return;
    }

    if (!firebaseUser.email || firebaseUser.email_verified !== true) {
      res.status(403).json({
        error: 'A verified email is required before a login code can be verified.',
        code: 'EMAIL_NOT_VERIFIED',
      });
      return;
    }

    let participant = req.participant;
    if (!participant) {
      participant =
        (await participantsRepository.findByFirebaseUid(firebaseUser.uid)) ?? undefined;
    }
    if (!participant) {
      res.status(404).json({
        error: 'No HackMatch account is linked to this sign-in. Please register first.',
        code: 'PARTICIPANT_NOT_FOUND',
      });
      return;
    }

    if (participant.is_suspended) {
      res.status(403).json({
        error: ACCOUNT_SUSPENDED_MESSAGE,
        code: 'ACCOUNT_SUSPENDED',
      });
      return;
    }

    const { challengeId, code } = req.body as { challengeId: string; code: string };
    const forwarded = req.headers['x-forwarded-for'];
    const ip =
      typeof req.ip === 'string'
        ? req.ip
        : Array.isArray(forwarded)
          ? forwarded[0]
          : typeof forwarded === 'string'
            ? forwarded.split(',')[0]?.trim()
            : null;

    const result = await verifyMfaOtpForParticipant(
      participant,
      firebaseUser,
      challengeId,
      code,
      ip
    );

    if (!result.ok) {
      if (result.retryAfter != null) {
        res.setHeader('Retry-After', String(result.retryAfter));
      }
      res.status(result.status).json({
        error: result.error,
        code: result.code,
        ...(result.retryAfter != null ? { retryAfter: result.retryAfter } : {}),
      });
      return;
    }

    res.status(200).json({
      verified: true,
      message: 'Verification code accepted. You can continue to your account.',
    });
  } catch (err: unknown) {
    next(err);
  }
}

/**
 * Handles user registration (POST /api/auth/register).
 * Provisions Firebase Authentication user record and Supabase PostgreSQL participant,
 * executing compensatory rollback on database insertion failure to guarantee atomic consistency.
 *
 * Security invariant: Enforces FR-007 / US-001 AC 5 — returns no session cookies, JWTs,
 * or active credentials before email verification and MFA.
 */
export async function register(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const { fullName, email, password } = req.body;

  try {
    // 1. Create user in Firebase Authentication via Admin SDK
    const userRecord = await firebaseAuth.createUser({
      email,
      password,
      displayName: fullName,
      emailVerified: false,
    });

    // 2. Persist participant profile in PostgreSQL database
    try {
      const participant = await participantsRepository.createParticipant({
        firebase_uid: userRecord.uid,
        email,
        full_name: fullName,
        role: 'PART',
        is_verified: false,
      });

      // 3. Dispatch Firebase email verification link & record in rate limiter (FR-084 / US-001 AC 2)
      let verificationEmailSent = false;
      try {
        const actionCodeSettings = {
          url: `${config.clientUrl}/?mode=verifyEmail&email=${encodeURIComponent(email)}`,
        };
        if (process.env.VITEST) {
          await firebaseAuth.generateEmailVerificationLink(email, actionCodeSettings);
        } else {
          const sendFn = firebaseAuth.sendVerificationEmail || sendVerificationEmail;
          await sendFn(email, actionCodeSettings);
        }
        rateLimiter.recordSend('verification', email);
        verificationEmailSent = true;
      } catch (sendErr: unknown) {
        // FR-084: Email dispatch failure never verifies account or creates session.
        // Internal diagnostics record failure without leaking tokens/passwords (NR-021, Invariant L41).
        const errMsg = sendErr instanceof Error ? sendErr.message : 'Unknown dispatch error';
        console.warn(`[AUTH] Failed to generate/dispatch verification link for ${email}: ${errMsg}`);
      }

      // 4. Respond with HTTP 201 Created and user summary (zero session tokens / cookies issued)
      res.status(201).json({
        message: 'User registered successfully',
        user: {
          id: participant.id,
          firebaseUid: participant.firebase_uid,
          email: participant.email,
          fullName: participant.full_name,
          role: 'PART',
          isVerified: false,
        },
        verificationEmailSent,
      });
    } catch (dbErr: unknown) {
      // Compensatory rollback: delete created Firebase user to prevent orphaned auth record
      try {
        await firebaseAuth.deleteUser(userRecord.uid);
      } catch (rollbackErr) {
        console.error('Critical compensation error deleting Firebase user:', rollbackErr);
      }

      // Handle PostgreSQL unique constraint violation on email (error code 23505)
      const errObj = dbErr && typeof dbErr === 'object' ? (dbErr as Record<string, unknown>) : null;
      const dbCode = errObj && 'code' in errObj ? String(errObj.code) : '';
      const dbMessage = errObj && 'message' in errObj ? String(errObj.message) : '';

      if (
        dbCode === '23505' ||
        dbMessage.toLowerCase().includes('unique') ||
        dbMessage.toLowerCase().includes('duplicate')
      ) {
        res.status(409).json({
          error: 'An account with this email already exists.',
          code: 'EMAIL_ALREADY_IN_USE',
        });
        return;
      }

      // Pass unexpected database failure to centralized error handler
      next(dbErr);
    }
  } catch (err: unknown) {
    const errObj = err && typeof err === 'object' ? (err as Record<string, unknown>) : null;
    const errorCode = errObj && 'code' in errObj ? String(errObj.code) : '';

    if (errorCode === 'auth/email-already-exists') {
      res.status(409).json({
        error: 'An account with this email already exists.',
        code: 'EMAIL_ALREADY_IN_USE',
      });
      return;
    }

    if (errorCode === 'auth/invalid-email') {
      res.status(400).json({
        error: 'Invalid email address.',
        code: 'INVALID_EMAIL',
      });
      return;
    }

    if (errorCode === 'auth/invalid-password' || errorCode === 'auth/weak-password') {
      res.status(400).json({
        error: 'Password does not meet requirements.',
        code: 'WEAK_PASSWORD',
      });
      return;
    }

    // Pass unexpected Firebase errors to centralized error handler
    next(err);
  }
}

/**
 * Handles requesting a replacement email verification link (POST /api/auth/resend-verification).
 * Enforces FR-081 dual-tier rate limiting (1/60s, 5/hour) and returns uniform responses
 * with normalized execution timing to prevent account enumeration attacks.
 */
export async function resendVerification(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const { email } = req.body;
  const normalizedEmail = String(email || '').trim().toLowerCase();

  try {
    // 1. Dual-tier rate limiting check (FR-081)
    const limitCheck = rateLimiter.checkLimit('verification', normalizedEmail);
    if (!limitCheck.allowed) {
      const retryAfterSeconds = limitCheck.retryAfterSeconds ?? 60;
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(429).json({
        error: 'Too many requests. Please wait before requesting another verification email.',
        code: 'RATE_LIMITED',
        retryAfter: retryAfterSeconds,
      });
      return;
    }

    // 2. Lookup participant in database
    const participant = await participantsRepository.findByEmail(normalizedEmail);

    if (participant && !participant.is_verified) {
      try {
        const actionCodeSettings = {
          url: `${config.clientUrl}/?mode=verifyEmail&email=${encodeURIComponent(normalizedEmail)}`,
        };
        if (process.env.VITEST) {
          await firebaseAuth.generateEmailVerificationLink(normalizedEmail, actionCodeSettings);
        } else {
          const sendFn = firebaseAuth.sendVerificationEmail || sendVerificationEmail;
          await sendFn(normalizedEmail, actionCodeSettings);
        }
      } catch (sendErr: unknown) {
        // FR-084: Authentication email delivery failure feedback; never leaks secrets (NR-021)
        const errMsg = sendErr instanceof Error ? sendErr.message : 'Unknown dispatch error';
        console.warn(`[AUTH] Failed to generate/dispatch replacement verification link for ${normalizedEmail}: ${errMsg}`);
      }
    } else {
      // Normalize timing to neutralize side-channel analysis (R1)
      if (config.nodeEnv !== 'test') {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    // Record send attempt in rate limiter to prevent enumeration via rate limiter status
    rateLimiter.recordSend('verification', normalizedEmail);

    // 3. FR-081 Anti-enumeration: Uniform HTTP 200 response (zero session tokens/cookies issued)
    res.status(200).json({
      message: 'If an account exists for this address, a verification link has been sent.',
    });
  } catch (err: unknown) {
    next(err);
  }
}

/**
 * Uniform confirmation for password-recovery requests (US-005 AC 2 / FR-011).
 * Identical for known, unknown, and OAuth-only addresses so existence is never leaked.
 */
export const PASSWORD_RESET_REQUEST_CONFIRMATION =
  'If an account exists for that email, you will receive password reset instructions shortly. If you signed in with Google or GitHub, use that provider to regain access.';

/**
 * Handles password-recovery email requests (POST /api/auth/password-reset).
 * Firebase dispatches a single-use reset link for credential accounts (FR-011).
 * OAuth-only and unknown addresses still receive the same HTTP 200 body (AC 1–2).
 * Rate-limited under FR-081; delivery failures are logged without leaking (FR-084 / NR-021).
 * Issues zero session cookies or tokens (FR-007).
 */
export async function requestPasswordReset(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const { email } = req.body;
  const normalizedEmail = String(email || '').trim().toLowerCase();

  try {
    // 1. Dual-tier rate limiting (FR-081) — applied before lookup so limits are not an oracle
    const limitCheck = rateLimiter.checkLimit('password-reset', normalizedEmail);
    if (!limitCheck.allowed) {
      const retryAfterSeconds = limitCheck.retryAfterSeconds ?? 60;
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(429).json({
        error: 'Too many requests. Please wait before requesting another password reset email.',
        code: 'RATE_LIMITED',
        retryAfter: retryAfterSeconds,
      });
      return;
    }

    // 2. Lookup participant; only credential (password) accounts receive a reset email
    const participant = await participantsRepository.findByEmail(normalizedEmail);

    if (participant && !participant.is_suspended) {
      try {
        const firebaseUser = await firebaseAuth.getUserByEmail(normalizedEmail);
        const hasPasswordProvider = (firebaseUser.providerData || []).some(
          (provider) => provider.providerId === 'password'
        );

        if (hasPasswordProvider) {
          const actionCodeSettings = {
            url: `${config.clientUrl}/?mode=resetPassword&view=reset&email=${encodeURIComponent(normalizedEmail)}`,
          };
          if (process.env.VITEST) {
            await firebaseAuth.generatePasswordResetLink(normalizedEmail, actionCodeSettings);
          } else {
            const sendFn = firebaseAuth.sendPasswordResetEmail || sendPasswordResetEmail;
            await sendFn(normalizedEmail, actionCodeSettings);
          }
        }
        // OAuth-only: skip send; still return generic confirmation (US-005 AC 1)
      } catch (sendErr: unknown) {
        // FR-084: never verify/session; log without tokens; keep uniform 200 (anti-enumeration)
        const errCode =
          sendErr && typeof sendErr === 'object' && 'code' in sendErr
            ? String((sendErr as { code: unknown }).code)
            : '';
        if (errCode !== 'auth/user-not-found') {
          const errMsg = sendErr instanceof Error ? sendErr.message : 'Unknown dispatch error';
          console.warn(
            `[AUTH] Failed to generate/dispatch password-reset email for ${normalizedEmail}: ${errMsg}`
          );
        }
      }
    } else {
      // Normalize timing to neutralize side-channel analysis
      if (config.nodeEnv !== 'test') {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    rateLimiter.recordSend('password-reset', normalizedEmail);

    // 3. FR-011 anti-enumeration: uniform HTTP 200, zero session artifacts
    res.status(200).json({
      message: PASSWORD_RESET_REQUEST_CONFIRMATION,
    });
  } catch (err: unknown) {
    next(err);
  }
}

function userHasPasswordProvider(user: {
  providerData?: Array<{ providerId?: string }>;
}): boolean {
  return (user.providerData || []).some((provider) => provider.providerId === 'password');
}

function respondPasswordResetLinkFailure(
  res: Response,
  code: string,
  oobCode: string
): boolean {
  if (code === 'auth/expired-action-code') {
    res.status(400).json({
      error: 'This password reset link has expired. Please request a new link to continue.',
      code: 'EXPIRED_ACTION_CODE',
      state: 'expired',
    });
    return true;
  }
  if (code === 'auth/invalid-action-code') {
    if (wasPasswordResetCodeConsumed(oobCode)) {
      res.status(400).json({
        error:
          'This password reset link has already been used. Request a new link if you still need to change your password.',
        code: 'USED_ACTION_CODE',
        state: 'used',
      });
      return true;
    }
    res.status(400).json({
      error:
        'This password reset link is invalid or has been tampered with. Please request a new link.',
      code: 'INVALID_ACTION_CODE',
      state: 'invalid',
    });
    return true;
  }
  return false;
}

/**
 * Validates a password-reset oobCode and classifies recovery state
 * (POST /api/auth/password-reset/validate) — US-005 / S1-P2-16 / FR-011.
 * Explicit states: valid (credential), expired, invalid, used, oauth.
 * Does not change the password or issue a session.
 */
export async function validatePasswordReset(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  const { oobCode } = req.body as { oobCode: string };

  try {
    if (wasPasswordResetCodeConsumed(oobCode)) {
      res.status(400).json({
        error:
          'This password reset link has already been used. Request a new link if you still need to change your password.',
        code: 'USED_ACTION_CODE',
        state: 'used',
      });
      return;
    }

    const inspectFn = firebaseAuth.inspectPasswordResetCode || inspectPasswordResetCode;
    let email: string;
    try {
      const inspected = await inspectFn(oobCode);
      email = inspected.email;
    } catch (inspectErr: unknown) {
      const code =
        inspectErr && typeof inspectErr === 'object' && 'code' in inspectErr
          ? String((inspectErr as { code: unknown }).code)
          : '';
      if (respondPasswordResetLinkFailure(res, code, oobCode)) {
        return;
      }
      if (code === 'auth/configuration-error') {
        res.status(503).json({
          error: 'Password reset is temporarily unavailable. Please try again later.',
          code: 'AUTH_SERVICE_UNAVAILABLE',
        });
        return;
      }
      res.status(502).json({
        error: 'We could not validate this reset link right now. Please try again.',
        code: 'PASSWORD_RESET_VALIDATE_FAILED',
      });
      return;
    }

    let firebaseUser: { uid: string; providerData?: Array<{ providerId?: string }> };
    try {
      firebaseUser = await firebaseAuth.getUserByEmail(email);
    } catch (userErr: unknown) {
      const code =
        userErr && typeof userErr === 'object' && 'code' in userErr
          ? String((userErr as { code: unknown }).code)
          : '';
      if (code === 'auth/user-not-found') {
        res.status(400).json({
          error:
            'This password reset link is invalid or has been tampered with. Please request a new link.',
          code: 'INVALID_ACTION_CODE',
          state: 'invalid',
        });
        return;
      }
      throw userErr;
    }

    if (!userHasPasswordProvider(firebaseUser)) {
      res.status(200).json({
        state: 'oauth',
        code: 'OAUTH_RECOVERY_REQUIRED',
        email,
        message:
          'This account signs in with Google or GitHub. Use that provider to regain access — a password cannot be set from this link.',
      });
      return;
    }

    res.status(200).json({
      state: 'valid',
      email,
      accountType: 'credential',
    });
  } catch (err: unknown) {
    next(err);
  }
}

/**
 * Confirms a password-reset oobCode, applies the new password, and revokes all
 * Firebase refresh tokens across devices (POST /api/auth/password-reset/confirm).
 * US-005 AC 4 / FR-012 / S1-P2-14 / S1-P2-15: never signs the user in, never clears
 * OTP lock, never bypasses MFA — next login must complete US-004.
 * Authorization is possession of a valid unconsumed oobCode.
 */
export async function confirmPasswordReset(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');

  const { oobCode, newPassword } = req.body as { oobCode: string; newPassword: string };

  try {
    if (wasPasswordResetCodeConsumed(oobCode)) {
      res.status(400).json({
        error:
          'This password reset link has already been used. Request a new link if you still need to change your password.',
        code: 'USED_ACTION_CODE',
        state: 'used',
      });
      return;
    }

    // Preflight: classify expired/invalid/used/oauth before consuming the code (S1-P2-16).
    const inspectFn = firebaseAuth.inspectPasswordResetCode || inspectPasswordResetCode;
    try {
      const inspected = await inspectFn(oobCode);
      const firebaseUser = await firebaseAuth.getUserByEmail(inspected.email);
      if (!userHasPasswordProvider(firebaseUser)) {
        res.status(403).json({
          error:
            'This account signs in with Google or GitHub. Use that provider to regain access — a password cannot be set from this link.',
          code: 'OAUTH_RECOVERY_REQUIRED',
          state: 'oauth',
        });
        return;
      }
    } catch (preflightErr: unknown) {
      const code =
        preflightErr && typeof preflightErr === 'object' && 'code' in preflightErr
          ? String((preflightErr as { code: unknown }).code)
          : '';
      if (respondPasswordResetLinkFailure(res, code, oobCode)) {
        return;
      }
      if (code === 'auth/user-not-found') {
        res.status(400).json({
          error:
            'This password reset link is invalid or has been tampered with. Please request a new link.',
          code: 'INVALID_ACTION_CODE',
          state: 'invalid',
        });
        return;
      }
      // Fall through to confirmFn which may still succeed if inspect is unavailable.
    }

    const confirmFn = firebaseAuth.confirmPasswordResetCode || confirmPasswordResetCode;
    let result: { email: string; uid: string };

    try {
      result = await confirmFn(oobCode, newPassword);
    } catch (confirmErr: unknown) {
      const code =
        confirmErr && typeof confirmErr === 'object' && 'code' in confirmErr
          ? String((confirmErr as { code: unknown }).code)
          : '';

      if (respondPasswordResetLinkFailure(res, code, oobCode)) {
        return;
      }
      if (code === 'auth/weak-password') {
        res.status(400).json({
          error: 'Validation failed',
          code: 'WEAK_PASSWORD',
          errors: {
            newPassword:
              'Password must be at least 8 characters long and include uppercase, lowercase, a number, and a special character.',
          },
        });
        return;
      }
      if (code === 'auth/user-disabled') {
        res.status(403).json({
          error: 'This account has been disabled. Please contact support.',
          code: 'USER_DISABLED',
        });
        return;
      }
      if (code === 'auth/configuration-error') {
        res.status(503).json({
          error: 'Password reset is temporarily unavailable. Please try again later.',
          code: 'AUTH_SERVICE_UNAVAILABLE',
        });
        return;
      }

      console.warn(
        '[AUTH] Password reset confirm failed:',
        confirmErr instanceof Error ? confirmErr.message : 'unknown error'
      );
      res.status(502).json({
        error: 'We could not reset your password right now. Please try again.',
        code: 'PASSWORD_RESET_FAILED',
      });
      return;
    }

    // Mark consumed so replay returns USED_ACTION_CODE (S1-P2-16), not a vague invalid.
    markPasswordResetCodeConsumed(oobCode);

    // S1-P2-15: drop MFA completion so the next sign-in cannot skip US-004.
    // FR-012: do not clear OTP failure locks — only the MFA claim and pending challenges.
    try {
      await clearMfaClaim(result.uid);
    } catch (claimErr: unknown) {
      console.warn(
        `[AUTH] Password updated for uid=${result.uid} but clearing MFA claim failed:`,
        claimErr instanceof Error ? claimErr.message : 'unknown error'
      );
    }

    try {
      const participant =
        (result.email
          ? await participantsRepository.findByEmail(result.email)
          : null) ?? (await participantsRepository.findByFirebaseUid(result.uid));
      if (participant) {
        await mfaRepository.invalidatePendingChallenges(participant.id);
      }
    } catch (challengeErr: unknown) {
      console.warn(
        `[AUTH] Password updated for uid=${result.uid} but invalidating MFA challenges failed:`,
        challengeErr instanceof Error ? challengeErr.message : 'unknown error'
      );
    }

    try {
      await firebaseAuth.revokeRefreshTokens(result.uid);
    } catch (revokeErr: unknown) {
      const revokeCode =
        revokeErr && typeof revokeErr === 'object' && 'code' in revokeErr
          ? String((revokeErr as { code: unknown }).code)
          : '';

      if (revokeCode !== 'auth/user-not-found') {
        console.warn(
          `[AUTH] Password updated for uid=${result.uid} but refresh-token revocation failed:`,
          revokeErr instanceof Error ? revokeErr.message : 'unknown error'
        );
        // Password already changed; clear local cookies and surface explicit failure (FR-012).
        clearSessionCookies(res);
        res.status(502).json({
          error:
            'Your password was updated, but we could not sign out other devices. Please try signing in again or contact support if sessions remain active.',
          code: 'REVOCATION_FAILED',
          signedIn: false,
          sessionIssued: false,
          requiresMfa: true,
        });
        return;
      }
    }

    // Drop any stale browser session cookie; do not issue a new session (FR-007 / FR-012).
    clearSessionCookies(res);

    res.status(200).json({
      message:
        'Password updated. All existing sessions have been revoked. Please sign in with your new password — email verification (OTP) is required before access.',
      email: result.email || undefined,
      signedIn: false,
      sessionIssued: false,
      requiresMfa: true,
    });
  } catch (err: unknown) {
    next(err);
  }
}

/**
 * Handles processing email verification action codes (POST /api/auth/verify-email).
 * Verifies the action code, marks the participant verified in Supabase PostgreSQL,
 * synchronizes Firebase user record, and strictly enforces zero session issuance (US-001 AC 5 / FR-007).
 */
export async function verifyEmail(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const { oobCode, email } = req.body;
  const code = String(oobCode || '').trim();
  const normalizedEmail = String(email || '').trim().toLowerCase();

  try {
    let verifiedEmail = '';

    if (code) {
      try {
        const verifyFn = firebaseAuth.verifyEmailActionCode || verifyEmailActionCode;
        const result = await verifyFn(code);
        if (result?.email) {
          verifiedEmail = result.email.trim().toLowerCase();
        }
      } catch (codeErr: unknown) {
        // Reconcile if action code was already consumed (e.g. by Firebase-hosted page or client SDK)
        if (normalizedEmail && !process.env.VITEST) {
          try {
            const authClient = getFirebaseAdminAuth();
            const fbUser = await authClient.getUserByEmail(normalizedEmail);
            if (fbUser?.emailVerified) {
              verifiedEmail = normalizedEmail;
            }
          } catch {
            // Ignore error and fall through
          }
        }
        if (!verifiedEmail) {
          throw codeErr;
        }
      }
    } else if (normalizedEmail) {
      // Reconcile redirect from Firebase-hosted verification page
      try {
        const authClient = getFirebaseAdminAuth();
        const fbUser = await authClient.getUserByEmail(normalizedEmail);
        if (fbUser?.emailVerified) {
          verifiedEmail = normalizedEmail;
        }
      } catch {
        // Ignore error
      }
    }

    if (!verifiedEmail) {
      res.status(400).json({
        error: 'Verification link is invalid or has already been used.',
        code: 'INVALID_ACTION_CODE',
      });
      return;
    }

    const participant = await participantsRepository.findByEmail(verifiedEmail);
    if (!participant) {
      res.status(404).json({
        error: 'Participant record not found.',
        code: 'PARTICIPANT_NOT_FOUND',
      });
      return;
    }

    // Mark participant account as verified in Supabase PostgreSQL
    await participantsRepository.updateVerificationStatus(participant.id, true);

    // Synchronize Firebase Auth user record emailVerified state if available
    if (typeof firebaseAuth.updateUser === 'function' && participant.firebase_uid) {
      try {
        await firebaseAuth.updateUser(participant.firebase_uid, { emailVerified: true });
      } catch {
        // Defensive synchronization: Identity Toolkit already marked the user emailVerified
      }
    }

    // US-001 AC 5 / FR-007 invariant: zero session cookies or tokens returned
    res.status(200).json({
      message: 'Email verified successfully. Please proceed to sign in.',
      isVerified: true,
    });
  } catch (err: unknown) {
    const errObj = err && typeof err === 'object' ? (err as Record<string, unknown>) : null;
    const errorCode = errObj && 'code' in errObj ? String(errObj.code) : '';

    if (errorCode === 'auth/expired-action-code' || errorCode === 'EXPIRED_ACTION_CODE') {
      res.status(400).json({
        error: 'Verification link has expired. Please request a replacement link.',
        code: 'EXPIRED_ACTION_CODE',
      });
      return;
    }

    if (errorCode === 'auth/invalid-action-code' || errorCode === 'INVALID_ACTION_CODE') {
      res.status(400).json({
        error: 'Verification link is invalid or has already been used.',
        code: 'INVALID_ACTION_CODE',
      });
      return;
    }

    // Forward unexpected errors to centralized error handler
    next(err);
  }
}

/**
 * Handles federated OAuth sign-in and registration (POST /api/auth/oauth/sign-in).
 * Verifies Firebase ID token, resolves or provisions participant record,
 * enforces account linking security (US-002 AC 4), evaluates 15-minute account lockout (FR-010),
 * enforces rate limits (FR-081), creates a 10-minute MFA challenge (FR-009 / US-004),
 * and dispatches a 6-digit OTP code to the verified email address.
 *
 * Invariant: Returns HTTP 200 with { requiresOtp: true, challengeId, email, expiresInSeconds: 600 }.
 * Strictly returns ZERO session cookies or JWT access tokens (US-002 AC 5 / FR-007).
 */
export async function oauthSignIn(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const { idToken, provider, consentHandleAvatar } = req.body;

  try {
    // 1. Verify Firebase ID token
    let decodedToken: {
      uid: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
      picture?: string;
      role?: string;
      screen_name?: string;
      firebase?: {
        sign_in_provider?: string;
        [key: string]: unknown;
      };
      [key: string]: unknown;
    };

    try {
      decodedToken = await firebaseAuth.verifyIdToken(idToken);
    } catch {
      res.status(401).json({
        error: 'Invalid or expired authentication token. Please sign in again.',
        code: 'INVALID_TOKEN',
      });
      return;
    }

    // 2. Cross-provider validation: verify token provider matches requested provider
    const tokenProvider = decodedToken?.firebase?.sign_in_provider || '';
    const isGoogle = (provider === 'google' || provider === 'google.com') && tokenProvider === 'google.com';
    const isGithub = (provider === 'github' || provider === 'github.com') && tokenProvider === 'github.com';

    if (!isGoogle && !isGithub) {
      res.status(400).json({
        error: 'Provider in request does not match the authentication credential.',
        code: 'PROVIDER_MISMATCH',
      });
      return;
    }

    // 3. Provider email verification check (US-002 AC 2 / US-002-T3)
    if (!decodedToken.email || !decodedToken.email_verified) {
      res.status(403).json({
        error: 'A verified provider email is required. Please sign up using standard email registration.',
        code: 'UNVERIFIED_PROVIDER_EMAIL',
      });
      return;
    }

    // 4. ADMIN role protection on ID token claim (US-002 AC 4 / FR-003)
    if (decodedToken.role === 'ADMIN') {
      res.status(403).json({
        error: 'Public OAuth cannot be used to authenticate an administrator account.',
        code: 'ADMIN_OAUTH_PROHIBITED',
      });
      return;
    }

    // 5. Resolve Participant & Guard Account Linking
    const normProvider: OAuthProvider = provider.startsWith('google') ? 'google' : 'github';
    let existingIdentity = await providerIdentitiesRepository.findByProviderUid(normProvider, decodedToken.uid);
    if (!existingIdentity) {
      const altProvider: OAuthProvider = normProvider === 'google' ? 'google.com' : 'github.com';
      existingIdentity = await providerIdentitiesRepository.findByProviderUid(altProvider, decodedToken.uid);
    }

    let participant: Participant | null = null;

    if (existingIdentity) {
      participant = await participantsRepository.findById(existingIdentity.participant_id);
    } else {
      // Identity not linked to this provider UID. Check if email already registered.
      const emailMatch = await participantsRepository.findByEmail(decodedToken.email.toLowerCase());
      if (emailMatch) {
        // US-002 AC 4 / US-002-T5: Reject automatic linking by email alone
        res.status(409).json({
          error: 'An account with this email already exists. Please sign in with your password to link your provider.',
          code: 'LINKING_REAUTHENTICATION_REQUIRED',
        });
        return;
      }

      // New user: provision PART participant and create provider identity
      const fallbackName = (
        decodedToken.name ||
        decodedToken.email.split('@')[0] ||
        'Participant'
      ).slice(0, 100);

      participant = await participantsRepository.createParticipant({
        firebase_uid: decodedToken.uid,
        email: decodedToken.email.toLowerCase(),
        full_name: fallbackName,
        role: 'PART',
        is_verified: true,
      });

      const handle = consentHandleAvatar
        ? (typeof decodedToken.screen_name === 'string'
            ? decodedToken.screen_name
            : typeof decodedToken.name === 'string'
              ? decodedToken.name
              : null)
        : null;
      const avatarUrl = consentHandleAvatar
        ? (typeof decodedToken.picture === 'string' ? decodedToken.picture : null)
        : null;

      await providerIdentitiesRepository.createProviderIdentity({
        participant_id: participant.id,
        provider: normProvider,
        provider_uid: decodedToken.uid,
        email: decodedToken.email.toLowerCase(),
        provider_handle: handle ? handle.slice(0, 100) : null,
        avatar_url: avatarUrl,
      });
    }

    // Guard against non-existent participant or ADMIN role in database
    if (!participant || participant.role === 'ADMIN') {
      res.status(403).json({
        error: 'Public OAuth cannot be used to authenticate an administrator account.',
        code: 'ADMIN_OAUTH_PROHIBITED',
      });
      return;
    }

    // Suspended accounts cannot start a session (US-003 AC 2 / US-003-T4 / FR-005)
    if (participant.is_suspended) {
      res.status(403).json({
        error: ACCOUNT_SUSPENDED_MESSAGE,
        code: 'ACCOUNT_SUSPENDED',
      });
      return;
    }

    // 6–9. Issue cryptographically random 6-digit OTP + email (FR-009 / FR-081 / FR-084 / US-004)
    const issued = await issueMfaOtpForParticipant(participant);
    if (!issued.ok) {
      if (issued.retryAfter != null) {
        res.setHeader('Retry-After', String(issued.retryAfter));
      }
      res.status(issued.status).json({
        error: issued.error,
        code: issued.code,
        ...(issued.retryAfter != null ? { retryAfter: issued.retryAfter } : {}),
        ...(issued.retryable != null ? { retryable: issued.retryable } : {}),
      });
      return;
    }

    // Strictly returns ZERO session cookies or JWT access tokens (US-002 AC 5 / FR-007)
    res.status(200).json({
      requiresOtp: true,
      challengeId: issued.challengeId,
      email: issued.maskedEmail,
      expiresInSeconds: issued.expiresInSeconds,
      message: issued.message,
    });
  } catch (err: unknown) {
    next(err);
  }
}

export const REAUTH_MAX_AGE_SECONDS = 900; // 15 minutes window for reauthentication

/**
 * Handles account linking with reauthentication check (POST /api/auth/oauth/link).
 * Enforces US-002 AC 4, US-002-T5, S1-P2-04, and FR-003:
 * 1. Checks that caller is an authenticated, verified participant and not an ADMIN.
 * 2. Enforces fresh reauthentication within 15 minutes (with clock-skew defense).
 * 3. Verifies provider Firebase ID token, provider match, and verified provider email.
 * 4. Strictly checks email equality between provider token and caller participant.
 * 5. Rejects if provider UID or provider identity is already linked to another participant or already exists.
 * 6. Persists new provider identity link idempotently.
 */
export async function oauthLink(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const participant = req.participant;
  const firebaseUser = req.firebaseUser;
  const { idToken, provider, consentHandleAvatar } = req.body;

  try {
    // 1. Guard authenticated participant context and role boundaries (US-002 AC 4 / FR-003)
    if (!participant || !firebaseUser) {
      res.status(401).json({
        error: 'Authentication required. Missing participant session.',
        code: 'UNAUTHORIZED',
      });
      return;
    }

    if (participant.role === 'ADMIN' || firebaseUser.role === 'ADMIN') {
      res.status(403).json({
        error: 'Public OAuth cannot be used to link an administrator account.',
        code: 'ADMIN_OAUTH_PROHIBITED',
      });
      return;
    }

    // 2. Fresh reauthentication check with clock-skew defense (US-002 AC 4)
    const nowSeconds = Math.floor(Date.now() / 1000);
    const authTime = typeof firebaseUser.auth_time === 'number' ? firebaseUser.auth_time : 0;

    // Reject missing auth_time, future-skewed tokens beyond 30s, or tokens older than 15m
    if (authTime === 0 || authTime > nowSeconds + 30 || nowSeconds - authTime > REAUTH_MAX_AGE_SECONDS) {
      res.status(401).json({
        error: 'Recent reauthentication is required to link an external provider. Please sign in again.',
        code: 'REAUTHENTICATION_REQUIRED',
      });
      return;
    }

    // 3. Verify provider Firebase ID token
    let decodedProviderToken;
    try {
      decodedProviderToken = await firebaseAuth.verifyIdToken(idToken);
    } catch {
      res.status(401).json({
        error: 'Invalid or expired provider token. Please try again.',
        code: 'INVALID_TOKEN',
      });
      return;
    }

    // 4. Validate provider match
    const tokenProvider = decodedProviderToken?.firebase?.sign_in_provider || '';
    const isGoogle = (provider === 'google' || provider === 'google.com') && tokenProvider === 'google.com';
    const isGithub = (provider === 'github' || provider === 'github.com') && tokenProvider === 'github.com';

    if (!isGoogle && !isGithub) {
      res.status(400).json({
        error: 'Provider in request does not match the authentication credential.',
        code: 'PROVIDER_MISMATCH',
      });
      return;
    }

    // 5. Provider email verification check (US-002 AC 2)
    if (!decodedProviderToken.email || !decodedProviderToken.email_verified) {
      res.status(403).json({
        error: 'A verified provider email is required to link this account.',
        code: 'UNVERIFIED_PROVIDER_EMAIL',
      });
      return;
    }

    // 6. ADMIN role check on provider token
    if (decodedProviderToken.role === 'ADMIN') {
      res.status(403).json({
        error: 'Public OAuth cannot be used to link an administrator account.',
        code: 'ADMIN_OAUTH_PROHIBITED',
      });
      return;
    }

    // 7. Ownership boundary: provider email must match participant email (normalized)
    if (decodedProviderToken.email.trim().toLowerCase() !== participant.email.trim().toLowerCase()) {
      res.status(409).json({
        error: 'Provider email does not match your registered account email.',
        code: 'EMAIL_MISMATCH',
      });
      return;
    }

    // 8. Conflict & Uniqueness checks across provider aliases
    const normProvider: OAuthProvider = provider.startsWith('google') ? 'google' : 'github';

    // Check if this provider UID is already linked to anyone
    let existingIdentity = await providerIdentitiesRepository.findByProviderUid(normProvider, decodedProviderToken.uid);
    if (!existingIdentity) {
      const altProvider: OAuthProvider = normProvider === 'google' ? 'google.com' : 'github.com';
      existingIdentity = await providerIdentitiesRepository.findByProviderUid(altProvider, decodedProviderToken.uid);
    }

    if (existingIdentity) {
      if (existingIdentity.participant_id === participant.id) {
        // Idempotent: already linked to this participant
        res.status(200).json({
          success: true,
          message: 'Provider is already linked to your account.',
          identity: {
            id: existingIdentity.id,
            provider: existingIdentity.provider,
            email: existingIdentity.email,
            provider_handle: existingIdentity.provider_handle,
          },
        });
        return;
      }

      // Linked to a different participant
      res.status(409).json({
        error: 'This provider account is already linked to another user.',
        code: 'PROVIDER_ALREADY_LINKED',
      });
      return;
    }

    // Check if participant already has a different UID linked for this provider
    const userIdentities = await providerIdentitiesRepository.findByParticipantId(participant.id);
    const existingForProvider = userIdentities.find(
      (id) => id.provider === normProvider || id.provider === `${normProvider}.com`
    );
    if (existingForProvider) {
      res.status(409).json({
        error: `A ${normProvider === 'google' ? 'Google' : 'GitHub'} account is already linked to this profile.`,
        code: 'PROVIDER_ALREADY_EXISTS',
      });
      return;
    }

    // 9. Persist provider identity link with defensive Postgres unique violation handling
    const rawClaims = decodedProviderToken as Record<string, unknown>;
    const handle = consentHandleAvatar
      ? (typeof rawClaims.screen_name === 'string'
          ? rawClaims.screen_name
          : typeof rawClaims.name === 'string'
            ? rawClaims.name
            : null)
      : null;
    const avatarUrl = consentHandleAvatar
      ? (typeof rawClaims.picture === 'string' ? rawClaims.picture : null)
      : null;

    let createdIdentity;
    try {
      createdIdentity = await providerIdentitiesRepository.createProviderIdentity({
        participant_id: participant.id,
        provider: normProvider,
        provider_uid: decodedProviderToken.uid,
        email: decodedProviderToken.email.trim().toLowerCase(),
        provider_handle: handle ? handle.slice(0, 100) : null,
        avatar_url: avatarUrl,
      });
    } catch (dbErr: unknown) {
      // Catch race condition: Postgres unique constraint violation (code 23505)
      const isUniqueViolation =
        dbErr && typeof dbErr === 'object' && 'code' in dbErr && (dbErr as { code: string }).code === '23505';
      if (isUniqueViolation) {
        res.status(409).json({
          error: 'This provider account is already linked to another user.',
          code: 'PROVIDER_ALREADY_LINKED',
        });
        return;
      }
      throw dbErr;
    }

    res.status(200).json({
      success: true,
      message: 'Provider successfully linked to your account.',
      identity: {
        id: createdIdentity.id,
        provider: createdIdentity.provider,
        email: createdIdentity.email,
        provider_handle: createdIdentity.provider_handle,
      },
    });
  } catch (err: unknown) {
    next(err);
  }
}

/**
 * Returns the identity behind a verified Firebase ID token (GET /api/auth/me, US-003 AC 4).
 * Must be mounted after `requireFirebaseAuth`. Never echoes the token itself.
 */
export function getCurrentUser(req: Request, res: Response): void {
  const decoded = req.firebaseUser;
  if (!decoded) {
    res.status(401).json({
      error: 'Authentication required. Missing or malformed Authorization header.',
      code: 'UNAUTHORIZED',
    });
    return;
  }

  const role = typeof decoded.role === 'string' ? decoded.role : null;

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    user: {
      uid: decoded.uid,
      email: decoded.email ?? null,
      emailVerified: decoded.email_verified === true,
      role,
      signInProvider: decoded.firebase?.sign_in_provider ?? null,
    },
    session: {
      authTime: new Date(decoded.auth_time * 1000).toISOString(),
      expiresAt: new Date(decoded.exp * 1000).toISOString(),
      mfaVerified: hasCompletedMfa(decoded),
    },
  });
}




/**
 * Exchanges a fresh, MFA-verified Firebase ID token for an HttpOnly session cookie
 * (POST /api/auth/session, US-003 AC 4). Must be mounted after `requireFirebaseAuth`
 * and `requireMfa`. The cookie lasts a fixed SESSION_COOKIE_MAX_AGE_SECONDS (7 days by
 * default) and is not extended by later requests.
 *
 * FR-010 / US-004: OTP lockout also blocks session renewal for 15 minutes. Existing
 * session cookies are not revoked solely by the lock (checked only on create).
 */
export async function createSession(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  const decoded = req.firebaseUser;
  const idToken = extractBearerToken(req.headers.authorization);
  if (!decoded || !idToken) {
    res.status(401).json({
      error: 'Authentication required. Missing or malformed Authorization header.',
      code: 'UNAUTHORIZED',
    });
    return;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const signInAge = nowSeconds - decoded.auth_time;
  if (!Number.isFinite(signInAge) || signInAge < -60 || signInAge > securityConfig.recentSignInSeconds) {
    res.status(401).json({
      error: 'Please sign in again to start a new session.',
      code: 'RECENT_SIGN_IN_REQUIRED',
    });
    return;
  }

  try {
    let participant = req.participant;
    if (!participant) {
      participant =
        (await participantsRepository.findByFirebaseUid(decoded.uid)) ?? undefined;
    }
    if (participant) {
      const lockout = await evaluateAccountLockout(participant.id);
      if (lockout.locked) {
        if (lockout.retryAfterSeconds != null) {
          res.setHeader('Retry-After', String(lockout.retryAfterSeconds));
        }
        res.status(423).json({
          error:
            'Account temporarily locked due to too many failed OTP attempts. Please wait 15 minutes before trying again.',
          code: 'ACCOUNT_LOCKED',
          ...(lockout.retryAfterSeconds != null
            ? { retryAfter: lockout.retryAfterSeconds }
            : {}),
        });
        return;
      }
    }

    const maxAgeSeconds = securityConfig.sessionCookie.maxAgeSeconds;
    const sessionCookie = await firebaseAuth.createSessionCookie(idToken, {
      expiresIn: maxAgeSeconds * 1000,
    });
    const csrfToken = generateCsrfToken();

    res.cookie(securityConfig.sessionCookie.name, sessionCookie, sessionCookieOptions());
    res.cookie(securityConfig.sessionCookie.csrfName, csrfToken, csrfCookieOptions());
    res.status(200).json({
      session: {
        expiresAt: new Date((nowSeconds + maxAgeSeconds) * 1000).toISOString(),
        maxAgeSeconds,
      },
      csrfToken,
    });
  } catch (err: unknown) {
    const failure = mapFirebaseAuthError(err);
    if (failure) {
      res.status(failure.status).json({ error: failure.error, code: failure.code });
      return;
    }
    next(err);
  }
}

/**
 * Signs the user out (DELETE /api/auth/session, US-003 AC 5 / FR-008 / US-003-T5).
 *
 * Mount after `requireCsrfIfCookieSession`. Resolves the user from the session cookie
 * or a Bearer ID token (without requiring an unrevoked token, so a second logout is safe),
 * revokes all Firebase refresh tokens for that account, then clears the cookies.
 * Replaying the old ID token or session cookie against protected routes then fails
 * because those middlewares verify with checkRevoked=true.
 */
export async function logout(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');

  const cookies = (req.cookies ?? {}) as Record<string, unknown>;
  const sessionCookie = cookies[securityConfig.sessionCookie.name];
  const bearer = extractBearerToken(req.headers.authorization);

  let uid: string | null = null;

  if (typeof sessionCookie === 'string' && sessionCookie !== '') {
    try {
      // checkRevoked=false: allow logout even if tokens were already revoked.
      const decoded = await firebaseAuth.verifySessionCookie(sessionCookie, false);
      uid = decoded.uid;
    } catch (err: unknown) {
      const failure = mapFirebaseAuthError(err);
      if (failure && !bearer) {
        clearSessionCookies(res);
        res.status(failure.status).json({ error: failure.error, code: failure.code });
        return;
      }
      // Fall through and try the Bearer token when the session cookie is unusable.
    }
  }

  if (!uid && bearer) {
    try {
      const decoded = await firebaseAuth.verifyIdToken(bearer, false);
      uid = decoded.uid;
    } catch (err: unknown) {
      const failure = mapFirebaseAuthError(err) ?? {
        status: 401,
        code: 'INVALID_TOKEN',
        error: 'Invalid authentication token. Please sign in again.',
      };
      clearSessionCookies(res);
      res.status(failure.status).json({ error: failure.error, code: failure.code });
      return;
    }
  }

  if (!uid) {
    clearSessionCookies(res);
    res.status(401).json({
      error: 'No active session. Please sign in.',
      code: 'NO_SESSION',
    });
    return;
  }

  try {
    await firebaseAuth.revokeRefreshTokens(uid);
  } catch (err: unknown) {
    const code =
      err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : '';

    if (code === 'auth/user-not-found') {
      // Account already gone: local cookies are still cleared below.
    } else {
      const failure = mapFirebaseAuthError(err);
      if (failure) {
        // Local cookies are cleared so this browser is signed out even if Firebase is down.
        clearSessionCookies(res);
        res.status(failure.status).json({
          error:
            failure.code === 'AUTH_SERVICE_UNAVAILABLE'
              ? 'Could not fully revoke your session. You are signed out on this device; try again if you used other devices.'
              : failure.error,
          code: failure.code === 'AUTH_SERVICE_UNAVAILABLE' ? 'REVOCATION_FAILED' : failure.code,
        });
        return;
      }
      next(err);
      return;
    }
  }

  clearSessionCookies(res);
  res.status(200).json({
    message: 'Signed out successfully. All refresh tokens for this account have been revoked.',
    code: 'LOGGED_OUT',
  });
}

/** @deprecated Use `logout`. Kept as a name alias for older imports in tests. */
export const clearSession = logout;
