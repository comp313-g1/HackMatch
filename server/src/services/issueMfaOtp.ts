/**
 * Shared MFA OTP issuance (FR-009 / FR-081 / FR-084 / US-004 AC 1).
 *
 * Used by OAuth sign-in and POST /api/auth/mfa/challenge after primary auth.
 * Never returns the plaintext OTP or a session token.
 */

import type { Participant } from '../db/types.js';
import { mfaRepository } from '../db/mfa.repository.js';
import {
  generateOtp,
  createMfaChallenge,
  evaluateAccountLockout,
  OTP_EXPIRY_SECONDS,
} from '../utils/otp.js';
import { rateLimiter } from '../utils/rateLimiter.js';
import {
  defaultMfaOtpEmailSender,
  type MfaOtpEmailSender,
} from '../utils/mfaOtpEmail.js';

export interface IssueMfaOtpSuccess {
  ok: true;
  challengeId: string;
  maskedEmail: string;
  expiresInSeconds: number;
  message: string;
}

export interface IssueMfaOtpFailure {
  ok: false;
  status: number;
  code:
    | 'ACCOUNT_LOCKED'
    | 'RATE_LIMITED'
    | 'EMAIL_DELIVERY_FAILED'
    | 'MFA_STORE_UNAVAILABLE'
    | 'FRESH_AUTH_REQUIRED';
  error: string;
  retryAfter?: number;
  /** When true, the client may retry under FR-081 (FR-084). */
  retryable?: boolean;
}

export type IssueMfaOtpResult = IssueMfaOtpSuccess | IssueMfaOtpFailure;

let emailSender: MfaOtpEmailSender = defaultMfaOtpEmailSender;

/** Test hook: replace the OTP email transporter. */
export function _setMfaOtpEmailSender(sender: MfaOtpEmailSender): void {
  emailSender = sender;
}

/** Test hook: restore the default OTP email transporter. */
export function _resetMfaOtpEmailSender(): void {
  emailSender = defaultMfaOtpEmailSender;
}

export function maskEmail(email: string): string {
  const [userPart = '', domainPart = ''] = email.split('@');
  const maskedUser =
    userPart.length > 1 ? `${userPart[0]}***${userPart.slice(-1)}` : `${userPart}***`;
  return `${maskedUser}@${domainPart}`;
}

/**
 * Detects missing MFA tables / schema errors so callers return 503 instead of 500.
 */
export function isMfaStoreUnavailableError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const record = err as Record<string, unknown>;
  const code = typeof record.code === 'string' ? record.code : '';
  const message = typeof record.message === 'string' ? record.message.toLowerCase() : '';
  const details = typeof record.details === 'string' ? record.details.toLowerCase() : '';
  const hint = typeof record.hint === 'string' ? record.hint.toLowerCase() : '';
  const blob = `${message} ${details} ${hint}`;

  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    code === 'PGRST204' ||
    ((blob.includes('mfa_challenges') || blob.includes('mfa_attempts')) &&
      (blob.includes('does not exist') ||
        blob.includes('could not find') ||
        blob.includes('schema cache'))) ||
    blob.includes('could not find the table')
  );
}

/**
 * Generates a cryptographically random 6-digit OTP, stores a SHA-256 verifier,
 * emails the code to the participant's verified address, and returns a safe
 * challenge descriptor (no plaintext OTP, no session).
 */
export async function issueMfaOtpForParticipant(
  participant: Participant,
  decodedAuthTime?: number
): Promise<IssueMfaOtpResult> {
  try {
    const lockout = await evaluateAccountLockout(participant.id);
    if (lockout.locked) {
      // US-004 AC 3/5: lock invalidates outstanding challenges; keep failure counter intact.
      await mfaRepository.invalidatePendingChallenges(participant.id);
      return {
        ok: false,
        status: 423,
        code: 'ACCOUNT_LOCKED',
        error:
          'Account temporarily locked due to too many failed OTP attempts. Please wait 15 minutes before trying again.',
        retryAfter: lockout.retryAfterSeconds,
      };
    }

    if (
      lockout.lastLockoutEndsAt &&
      typeof decodedAuthTime === 'number' &&
      decodedAuthTime * 1000 < lockout.lastLockoutEndsAt
    ) {
      return {
        ok: false,
        status: 401,
        code: 'FRESH_AUTH_REQUIRED',
        error:
          'Your account was previously locked. Please sign in again with your password or credentials before requesting a new code.',
      };
    }

    const normalizedEmail = participant.email.toLowerCase();
    const rateCheck = rateLimiter.checkLimit('mfa_otp', normalizedEmail);
    if (!rateCheck.allowed) {
      const retryAfterSeconds = rateCheck.retryAfterSeconds ?? 60;
      return {
        ok: false,
        status: 429,
        code: 'RATE_LIMITED',
        error: 'Too many OTP requests. Please wait before requesting another code.',
        retryAfter: retryAfterSeconds,
      };
    }

    const otpCode = generateOtp();
    const challenge = await createMfaChallenge(participant.id, otpCode);

    try {
      await emailSender(normalizedEmail, otpCode);
      // FR-081: count only successful dispatches so failed sends can retry immediately.
      rateLimiter.recordSend('mfa_otp', normalizedEmail);
    } catch (dispatchErr: unknown) {
      // FR-084: delivery failure never authenticates or creates a session; invalidate the
      // fresh challenge; do not log the OTP; allow controlled retry (not rate-limited).
      await mfaRepository.invalidatePendingChallenges(participant.id);
      const errMsg = dispatchErr instanceof Error ? dispatchErr.message : 'Unknown dispatch error';
      console.warn(`[AUTH] Failed to send MFA OTP email for ${normalizedEmail}: ${errMsg}`);
      return {
        ok: false,
        status: 502,
        code: 'EMAIL_DELIVERY_FAILED',
        error:
          "We couldn't send your verification code. Please try again in a moment. If this keeps happening, check your email address or contact support.",
        retryable: true,
      };
    }

    return {
      ok: true,
      challengeId: challenge.id,
      maskedEmail: maskEmail(normalizedEmail),
      expiresInSeconds: OTP_EXPIRY_SECONDS,
      message: 'A 6-digit verification code has been sent to your email.',
    };
  } catch (err: unknown) {
    if (isMfaStoreUnavailableError(err)) {
      console.warn('[AUTH] MFA store unavailable while issuing OTP challenge:', err);
      return {
        ok: false,
        status: 503,
        code: 'MFA_STORE_UNAVAILABLE',
        error:
          'Login code storage is not available. Apply the MFA database migration (0003_create_mfa_records.sql) and try again.',
      };
    }
    throw err;
  }
}
