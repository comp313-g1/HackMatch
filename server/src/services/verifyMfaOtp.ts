/**
 * MFA OTP verification / atomic consume (FR-010 / US-004 AC 2–3 / S1-P1-11).
 * Supports POST /api/auth/mfa/verify used by the React OTP entry form.
 */

import type { DecodedIdToken } from 'firebase-admin/auth';
import type { Participant } from '../db/types.js';
import { mfaRepository } from '../db/mfa.repository.js';
import { evaluateAccountLockout, hashOtp } from '../utils/otp.js';
import { markMfaComplete } from '../utils/mfaClaim.js';
import { isMfaStoreUnavailableError } from './issueMfaOtp.js';

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
      return {
        ok: false,
        status: 423,
        code: 'ACCOUNT_LOCKED',
        error:
          'Account temporarily locked due to too many failed OTP attempts. Please wait 15 minutes before trying again.',
        retryAfter: lockout.retryAfterSeconds,
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

    const otpHash = hashOtp(rawCode);
    const consumed = await mfaRepository.tryConsumeChallenge(challenge.id, otpHash);

    if (!consumed) {
      // Compare-and-set matched zero rows: wrong code, concurrent consume, or state change.
      const latest = await mfaRepository.getChallengeById(challenge.id);
      if (!latest || latest.participant_id !== participant.id) {
        return {
          ok: false,
          status: 404,
          code: 'CHALLENGE_NOT_FOUND',
          error: 'This verification code is no longer valid. Request a new code and try again.',
        };
      }
      if (latest.consumed_at) {
        return {
          ok: false,
          status: 400,
          code: 'OTP_CONSUMED',
          error: 'This verification code has already been used. Request a new code and try again.',
        };
      }
      if (latest.invalidated_at || Date.now() >= Date.parse(latest.expires_at)) {
        await mfaRepository.invalidatePendingChallenges(participant.id);
        return {
          ok: false,
          status: 400,
          code: 'OTP_EXPIRED',
          error: 'This verification code has expired. Request a new code and try again.',
        };
      }

      await mfaRepository.createAttempt({
        participant_id: participant.id,
        challenge_id: challenge.id,
        success: false,
        ip_address: ipAddress ?? null,
      });

      const afterFail = await evaluateAccountLockout(participant.id);
      if (afterFail.locked) {
        await mfaRepository.invalidatePendingChallenges(participant.id);
        return {
          ok: false,
          status: 423,
          code: 'ACCOUNT_LOCKED',
          error:
            'Account temporarily locked due to too many failed OTP attempts. Please wait 15 minutes before trying again.',
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

    // Success attempt resets consecutive-failure counting for the next cycle (FR-010).
    await mfaRepository.createAttempt({
      participant_id: participant.id,
      challenge_id: challenge.id,
      success: true,
      ip_address: ipAddress ?? null,
    });

    const authTime =
      typeof firebaseUser.auth_time === 'number' ? firebaseUser.auth_time : Number(firebaseUser.auth_time);
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
