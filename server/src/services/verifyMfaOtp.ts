/**
 * MFA OTP verification / atomic consume (FR-010 / US-004 AC 2–3 / S1-P1-11).
 * Supports POST /api/auth/mfa/verify used by the React OTP entry form.
 */

import type { DecodedIdToken } from 'firebase-admin/auth';
import type { Participant } from '../db/types.js';
import { mfaRepository } from '../db/mfa.repository.js';
import {
  evaluateAccountLockout,
  evaluateLockoutBeforeAttempt,
  hashOtp,
} from '../utils/otp.js';
import { markMfaComplete } from '../utils/mfaClaim.js';
import { isMfaStoreUnavailableError } from './issueMfaOtp.js';

export const ACCOUNT_LOCKED_MESSAGE =
  'Account temporarily locked due to too many failed OTP attempts. Please wait 15 minutes before trying again.';

export type VerificationReservation =
  | { ok: true; attemptId: string; settle: (outcome: 'success' | 'failure' | 'discard') => Promise<void> }
  | { ok: false; retryAfter?: number };

/**
 * #271: race-safe slot for one code comparison. The attempt is reserved (as a
 * failure) in serialized order before the code is compared; if five
 * consecutive failures already precede it — including concurrent in-flight
 * reservations — the slot is refused and the reservation removed, so the code
 * is never compared. Callers settle the reservation exactly once:
 * success → marked successful (resets the FR-010 cycle), failure → kept,
 * discard → removed because no live challenge was evaluated.
 */
export async function reserveVerificationAttempt(
  participantId: string,
  challengeId: string | null,
  ipAddress?: string | null
): Promise<VerificationReservation> {
  const reserved = await mfaRepository.reserveAttempt({
    participant_id: participantId,
    challenge_id: challengeId,
    ip_address: ipAddress ?? null,
  });

  let settled = false;
  const settle = async (outcome: 'success' | 'failure' | 'discard') => {
    if (settled) return;
    if (outcome === 'success') await mfaRepository.markAttemptSucceeded(reserved.id, participantId);
    else if (outcome === 'discard') await mfaRepository.discardAttempt(reserved.id, participantId);
    // Only after storage succeeded, so a failed settle can still be discarded.
    settled = true;
  };

  try {
    const before = await evaluateLockoutBeforeAttempt(participantId, reserved.id);
    if (before.locked) {
      await settle('discard');
      return { ok: false, retryAfter: before.retryAfterSeconds };
    }
  } catch (err: unknown) {
    await settle('discard').catch(() => undefined);
    throw err;
  }
  return { ok: true, attemptId: reserved.id, settle };
}

export interface VerifyMfaOtpSuccess {
  ok: true;
  verified: true;
}

export interface VerifyMfaOtpFailure {
  ok: false;
  status: number;
  code:
    | 'ACCOUNT_LOCKED'
    | 'INVALID_OTP'
    | 'OTP_EXPIRED'
    | 'OTP_CONSUMED'
    | 'CHALLENGE_NOT_FOUND'
    | 'FRESH_AUTH_REQUIRED'
    | 'MFA_STORE_UNAVAILABLE';
  error: string;
  retryAfter?: number;
}

export type VerifyMfaOtpResult = VerifyMfaOtpSuccess | VerifyMfaOtpFailure;

/**
 * Validates a 6-digit OTP against the current challenge, atomically consumes it
 * on match (compare-and-set), records the attempt, resets the failure cycle on
 * success via a successful attempt row, and sets the MFA claim.
 */
export async function verifyMfaOtpForParticipant(
  participant: Participant,
  firebaseUser: DecodedIdToken,
  challengeId: string,
  rawCode: string,
  ipAddress?: string | null
): Promise<VerifyMfaOtpResult> {
  try {
    const lockout = await evaluateAccountLockout(participant.id);
    if (lockout.locked) {
      // US-004 AC 3/5: ensure predecessor challenges cannot authenticate during lock.
      await mfaRepository.invalidatePendingChallenges(participant.id);
      return {
        ok: false,
        status: 423,
        code: 'ACCOUNT_LOCKED',
        error: ACCOUNT_LOCKED_MESSAGE,
        retryAfter: lockout.retryAfterSeconds,
      };
    }

    const authTime =
      typeof firebaseUser.auth_time === 'number' ? firebaseUser.auth_time : Number(firebaseUser.auth_time);

    // US-004-T6 (aligned in #271 with /mfa/send and the legacy { otp } path): once a
    // lock has expired, a sign-in that predates it must authenticate again first.
    if (
      lockout.lastLockoutEndsAt &&
      Number.isFinite(authTime) &&
      authTime * 1000 < lockout.lastLockoutEndsAt
    ) {
      return {
        ok: false,
        status: 401,
        code: 'FRESH_AUTH_REQUIRED',
        error:
          'Your account was previously locked. Please sign in again with your password or credentials before verifying your code.',
      };
    }

    const challenge = await mfaRepository.getChallengeById(challengeId);
    if (!challenge || challenge.participant_id !== participant.id) {
      return {
        ok: false,
        status: 404,
        code: 'CHALLENGE_NOT_FOUND',
        error: 'This verification code is no longer valid. Request a new code and try again.',
      };
    }

    if (challenge.consumed_at) {
      return {
        ok: false,
        status: 400,
        code: 'OTP_CONSUMED',
        error: 'This verification code has already been used. Request a new code and try again.',
      };
    }

    if (challenge.invalidated_at) {
      return {
        ok: false,
        status: 400,
        code: 'OTP_EXPIRED',
        error: 'This verification code is no longer valid. Request a new code and try again.',
      };
    }

    const expiresAt = Date.parse(challenge.expires_at);
    if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) {
      await mfaRepository.invalidatePendingChallenges(participant.id);
      return {
        ok: false,
        status: 400,
        code: 'OTP_EXPIRED',
        error: 'This verification code has expired. Request a new code and try again.',
      };
    }

    // #271: claim a serialized comparison slot before touching the code.
    const slot = await reserveVerificationAttempt(participant.id, challenge.id, ipAddress);
    if (!slot.ok) {
      return {
        ok: false,
        status: 423,
        code: 'ACCOUNT_LOCKED',
        error: ACCOUNT_LOCKED_MESSAGE,
        retryAfter: slot.retryAfter,
      };
    }

    try {
      const otpHash = hashOtp(rawCode);
      const consumed = await mfaRepository.tryConsumeChallenge(challenge.id, otpHash);

      if (!consumed) {
        // Compare-and-set matched zero rows: wrong code, concurrent consume, or state change.
        const latest = await mfaRepository.getChallengeById(challenge.id);
        if (!latest || latest.participant_id !== participant.id) {
          await slot.settle('discard');
          return {
            ok: false,
            status: 404,
            code: 'CHALLENGE_NOT_FOUND',
            error: 'This verification code is no longer valid. Request a new code and try again.',
          };
        }
        if (latest.consumed_at) {
          await slot.settle('discard');
          return {
            ok: false,
            status: 400,
            code: 'OTP_CONSUMED',
            error: 'This verification code has already been used. Request a new code and try again.',
          };
        }
        if (latest.invalidated_at || Date.now() >= Date.parse(latest.expires_at)) {
          await slot.settle('discard');
          await mfaRepository.invalidatePendingChallenges(participant.id);
          return {
            ok: false,
            status: 400,
            code: 'OTP_EXPIRED',
            error: 'This verification code has expired. Request a new code and try again.',
          };
        }

        // A genuinely incorrect code: the reserved failure row stands.
        await slot.settle('failure');

        const afterFail = await evaluateAccountLockout(participant.id);
        if (afterFail.locked) {
          await mfaRepository.invalidatePendingChallenges(participant.id);
          return {
            ok: false,
            status: 423,
            code: 'ACCOUNT_LOCKED',
            error: ACCOUNT_LOCKED_MESSAGE,
            retryAfter: afterFail.retryAfterSeconds,
          };
        }

        return {
          ok: false,
          status: 401,
          code: 'INVALID_OTP',
          error: 'Incorrect verification code. Please try again.',
        };
      }

      // Success resets consecutive-failure counting for the next cycle (FR-010).
      await slot.settle('success');
    } catch (err: unknown) {
      // An infrastructure error is not an incorrect code; never let it count.
      await slot.settle('discard').catch(() => undefined);
      throw err;
    }

    await markMfaComplete(firebaseUser.uid, authTime);

    return { ok: true, verified: true };
  } catch (err: unknown) {
    if (isMfaStoreUnavailableError(err)) {
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
