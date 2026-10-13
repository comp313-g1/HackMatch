import crypto from 'node:crypto';
import { mfaRepository } from '../db/mfa.repository.js';
import type { MfaChallenge } from '../db/types.js';

export const OTP_EXPIRY_SECONDS = 600; // 10 minutes (FR-009 / US-004 AC 1)
export const LOCKOUT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes (FR-010 / NR-008)
export const MAX_CONSECUTIVE_FAILURES = 5; // 5 attempts (FR-010 / NR-008)

/**
 * Generates a cryptographically random 6-digit numeric string (100000 - 999999).
 */
export function generateOtp(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

/**
 * Computes a SHA-256 hex verifier for an OTP code string.
 */
export function hashOtp(code: string): string {
  return crypto.createHash('sha256').update(code.trim()).digest('hex');
}

export interface AccountLockoutStatus {
  locked: boolean;
  retryAfterSeconds?: number;
}

/**
 * Evaluates whether an account is locked under FR-010:
 * "Five incorrect OTP attempts across account challenges lock login and session renewal
 * for 15 minutes and invalidate challenges. Resends/IP/provider changes do not reset attempts.
 * Success or lock expiry resets the counter."
 */
export async function evaluateAccountLockout(
  participantId: string,
  now = Date.now()
): Promise<AccountLockoutStatus> {
  if (!participantId || typeof participantId !== 'string' || participantId.trim() === '') {
    return { locked: false };
  }

  // Retrieve up to 20 recent attempts for this participant (ordered created_at DESC)
  const recentAttempts = await mfaRepository.getRecentAttempts(participantId, 20);
  if (!recentAttempts || recentAttempts.length === 0) {
    return { locked: false };
  }

  // Find the most recent success (if any). Failures before a success are disregarded.
  const latestSuccessIndex = recentAttempts.findIndex((attempt) => attempt.success === true);
  const relevantAttempts = latestSuccessIndex === -1 
    ? recentAttempts 
    : recentAttempts.slice(0, latestSuccessIndex);

  if (relevantAttempts.length < MAX_CONSECUTIVE_FAILURES) {
    return { locked: false };
  }

  // Order failures chronologically (oldest first)
  const chronologicalFailures = [...relevantAttempts].reverse();

  let failureCount = 0;
  let lockoutEndsAt = 0;

  for (const attempt of chronologicalFailures) {
    const attemptTime = new Date(attempt.created_at).getTime();

    // If an earlier lockout window has already expired before this attempt,
    // lock expiry resets the counter per FR-010.
    if (lockoutEndsAt > 0 && attemptTime >= lockoutEndsAt) {
      failureCount = 0;
      lockoutEndsAt = 0;
    }

    failureCount++;

    if (failureCount === MAX_CONSECUTIVE_FAILURES) {
      lockoutEndsAt = attemptTime + LOCKOUT_WINDOW_MS;
    }
  }

  if (lockoutEndsAt > 0 && now < lockoutEndsAt) {
    const retryAfterSeconds = Math.ceil((lockoutEndsAt - now) / 1000);
    return {
      locked: true,
      retryAfterSeconds,
    };
  }

  return { locked: false };
}

/**
 * Atomically invalidates existing pending challenges and creates a fresh 10-minute
 * MFA challenge storing a SHA-256 hashed verifier (FR-009 / US-004 AC 1).
 */
export async function createMfaChallenge(
  participantId: string,
  rawOtp: string,
  now = Date.now()
): Promise<MfaChallenge> {
  if (!participantId || typeof participantId !== 'string' || participantId.trim() === '') {
    throw new Error('participant_id is required');
  }
  if (!rawOtp || typeof rawOtp !== 'string' || rawOtp.trim() === '') {
    throw new Error('rawOtp is required');
  }

  await mfaRepository.invalidatePendingChallenges(participantId);
  const expiresAt = new Date(now + OTP_EXPIRY_SECONDS * 1000).toISOString();
  const otpHash = hashOtp(rawOtp);

  return mfaRepository.createChallenge({
    participant_id: participantId,
    otp_hash: otpHash,
    expires_at: expiresAt,
  });
}
