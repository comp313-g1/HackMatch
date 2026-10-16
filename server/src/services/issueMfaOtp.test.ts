import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  issueMfaOtpForParticipant,
  maskEmail,
  isMfaStoreUnavailableError,
  _setMfaOtpEmailSender,
  _resetMfaOtpEmailSender,
} from './issueMfaOtp.js';
import { mfaRepository } from '../db/mfa.repository.js';
import { hashOtp } from '../utils/otp.js';
import { _resetRateLimiter, rateLimiter } from '../utils/rateLimiter.js';
import type { Participant, MfaChallenge } from '../db/types.js';

describe('issueMfaOtpForParticipant (US-004 AC 1 / FR-009 / FR-081 / FR-084)', () => {
  const participant: Participant = {
    id: 'part-uuid-1',
    firebase_uid: 'fb-uid-1',
    email: 'Jane.Doe@Example.com',
    full_name: 'Jane Doe',
    role: 'PART',
    is_verified: true,
    is_suspended: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const mockChallenge: MfaChallenge = {
    id: 'challenge-uuid-1',
    participant_id: participant.id,
    otp_hash: 'a'.repeat(64),
    expires_at: new Date(Date.now() + 600_000).toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    _resetRateLimiter();
    _resetMfaOtpEmailSender();
    vi.spyOn(mfaRepository, 'getRecentAttempts').mockResolvedValue([]);
    vi.spyOn(mfaRepository, 'invalidatePendingChallenges').mockResolvedValue(0);
    vi.spyOn(mfaRepository, 'createChallenge').mockResolvedValue(mockChallenge);
  });

  it('masks email for safe API responses', () => {
    expect(maskEmail('jane@example.com')).toBe('j***e@example.com');
    expect(maskEmail('a@example.com')).toBe('a***@example.com');
  });

  it('happy path: generates 6-digit OTP, stores SHA-256 hash, emails code, returns challenge', async () => {
    let capturedOtp = '';
    _setMfaOtpEmailSender(async (email, otp) => {
      expect(email).toBe('jane.doe@example.com');
      capturedOtp = otp;
    });

    const result = await issueMfaOtpForParticipant(participant);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(capturedOtp).toMatch(/^\d{6}$/);
    expect(result.challengeId).toBe('challenge-uuid-1');
    expect(result.maskedEmail).toBe('j***e@example.com');
    expect(result.expiresInSeconds).toBe(600);
    expect(JSON.stringify(result)).not.toContain(capturedOtp);

    const createArg = vi.mocked(mfaRepository.createChallenge).mock.calls[0]?.[0];
    expect(createArg?.otp_hash).toBe(hashOtp(capturedOtp));
    expect(createArg?.participant_id).toBe(participant.id);
  });

  it('returns ACCOUNT_LOCKED when recent OTP failures lock the account', async () => {
    const now = Date.now();
    const failures = Array.from({ length: 5 }, (_, i) => ({
      id: `att-${i}`,
      participant_id: participant.id,
      challenge_id: null,
      success: false,
      ip_address: null,
      created_at: new Date(now - (5 - i) * 1000).toISOString(),
    }));
    vi.spyOn(mfaRepository, 'getRecentAttempts').mockResolvedValue(failures);

    const result = await issueMfaOtpForParticipant(participant);
    expect(result).toMatchObject({ ok: false, status: 423, code: 'ACCOUNT_LOCKED' });
    expect(mfaRepository.createChallenge).not.toHaveBeenCalled();
    // Lock path invalidates outstanding challenges (US-004 AC 3 / AC 5).
    expect(mfaRepository.invalidatePendingChallenges).toHaveBeenCalledWith(participant.id);
  });

  it('resend/reissue invalidates predecessor challenges without resetting failure attempts (AC 5)', async () => {
    _setMfaOtpEmailSender(async () => undefined);
    const priorFailures = Array.from({ length: 2 }, (_, i) => ({
      id: `att-${i}`,
      participant_id: participant.id,
      challenge_id: 'old-challenge',
      success: false,
      ip_address: null,
      created_at: new Date(Date.now() - (2 - i) * 1000).toISOString(),
    }));
    vi.spyOn(mfaRepository, 'getRecentAttempts').mockResolvedValue(priorFailures);
    const createAttemptSpy = vi.spyOn(mfaRepository, 'createAttempt');

    const result = await issueMfaOtpForParticipant(participant);

    expect(result.ok).toBe(true);
    expect(mfaRepository.invalidatePendingChallenges).toHaveBeenCalledWith(participant.id);
    expect(mfaRepository.createChallenge).toHaveBeenCalled();
    // Failure attempts are untouched by reissue (only challenges are invalidated).
    expect(createAttemptSpy).not.toHaveBeenCalled();
    expect(await mfaRepository.getRecentAttempts(participant.id)).toEqual(priorFailures);
  });

  it('returns RATE_LIMITED after a successful send within the 60s cooldown (FR-081)', async () => {
    _setMfaOtpEmailSender(async () => undefined);

    const first = await issueMfaOtpForParticipant(participant);
    expect(first.ok).toBe(true);

    const second = await issueMfaOtpForParticipant(participant);
    expect(second).toMatchObject({ ok: false, status: 429, code: 'RATE_LIMITED' });
    expect(second.ok === false && second.retryAfter).toBeGreaterThan(0);
  });

  it('invalidates the challenge and returns EMAIL_DELIVERY_FAILED when send throws (FR-084)', async () => {
    _setMfaOtpEmailSender(async () => {
      throw new Error('SMTP timeout');
    });
    const recordSpy = vi.spyOn(rateLimiter, 'recordSend');

    const result = await issueMfaOtpForParticipant(participant);
    expect(result).toMatchObject({
      ok: false,
      status: 502,
      code: 'EMAIL_DELIVERY_FAILED',
      retryable: true,
    });
    expect(mfaRepository.invalidatePendingChallenges).toHaveBeenCalledWith(participant.id);
    // Failed sends must not consume the FR-081 quota so the user can retry.
    expect(recordSpy).not.toHaveBeenCalled();
  });

  it('allows an immediate retry after a delivery failure (FR-084 + FR-081)', async () => {
    let attempts = 0;
    _setMfaOtpEmailSender(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('SMTP timeout');
    });

    const first = await issueMfaOtpForParticipant(participant);
    expect(first).toMatchObject({ ok: false, code: 'EMAIL_DELIVERY_FAILED', retryable: true });

    const second = await issueMfaOtpForParticipant(participant);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.challengeId).toBe('challenge-uuid-1');
    }
  });

  it('returns MFA_STORE_UNAVAILABLE when MFA tables are missing', async () => {
    vi.spyOn(mfaRepository, 'getRecentAttempts').mockRejectedValue({
      code: '42P01',
      message: 'relation "mfa_attempts" does not exist',
    });

    const result = await issueMfaOtpForParticipant(participant);
    expect(result).toMatchObject({
      ok: false,
      status: 503,
      code: 'MFA_STORE_UNAVAILABLE',
    });
  });

  it('detects Supabase PostgREST missing-table errors', () => {
    expect(
      isMfaStoreUnavailableError({
        code: 'PGRST205',
        message: "Could not find the table 'public.mfa_challenges' in the schema cache",
      })
    ).toBe(true);
    expect(isMfaStoreUnavailableError(new Error('unrelated'))).toBe(false);
  });
});
