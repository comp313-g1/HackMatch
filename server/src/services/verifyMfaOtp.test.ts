/**
 * US-004 S1-P1-11: Validate and atomically consume the current OTP (service).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { verifyMfaOtpForParticipant } from './verifyMfaOtp.js';
import { mfaRepository } from '../db/mfa.repository.js';
import { hashOtp } from '../utils/otp.js';
import * as mfaClaim from '../utils/mfaClaim.js';
import type { Participant, MfaChallenge, MfaAttempt } from '../db/types.js';

describe('verifyMfaOtpForParticipant (US-004 AC 2 / FR-010 / S1-P1-11)', () => {
  const participant: Participant = {
    id: 'part-uuid-1',
    firebase_uid: 'fb-uid-1',
    email: 'jane@example.com',
    full_name: 'Jane Doe',
    role: 'PART',
    is_verified: true,
    is_suspended: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const authTime = Math.floor(Date.now() / 1000) - 30;
  const firebaseUser = {
    uid: 'fb-uid-1',
    email: 'jane@example.com',
    email_verified: true,
    auth_time: authTime,
  } as DecodedIdToken;

  const otp = '123456';
  const activeChallenge: MfaChallenge = {
    id: 'challenge-uuid-1',
    participant_id: participant.id,
    otp_hash: hashOtp(otp),
    expires_at: new Date(Date.now() + 600_000).toISOString(),
    consumed_at: null,
    invalidated_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(mfaRepository, 'getRecentAttempts').mockResolvedValue([]);
    vi.spyOn(mfaRepository, 'getChallengeById').mockResolvedValue(activeChallenge);
    vi.spyOn(mfaRepository, 'tryConsumeChallenge').mockResolvedValue({
      ...activeChallenge,
      consumed_at: new Date().toISOString(),
    });
    vi.spyOn(mfaRepository, 'createAttempt').mockResolvedValue({
      id: 'att-1',
      participant_id: participant.id,
      challenge_id: activeChallenge.id,
      success: true,
      ip_address: null,
      created_at: new Date().toISOString(),
    } as MfaAttempt);
    vi.spyOn(mfaRepository, 'invalidatePendingChallenges').mockResolvedValue(0);
    vi.spyOn(mfaClaim, 'markMfaComplete').mockResolvedValue(undefined);
  });

  it('happy path: atomically consumes matching OTP, records success, sets MFA claim', async () => {
    const result = await verifyMfaOtpForParticipant(
      participant,
      firebaseUser,
      activeChallenge.id,
      otp,
      '127.0.0.1'
    );

    expect(result).toEqual({ ok: true, verified: true });
    expect(mfaRepository.tryConsumeChallenge).toHaveBeenCalledWith(
      activeChallenge.id,
      hashOtp(otp)
    );
    expect(mfaRepository.createAttempt).toHaveBeenCalledWith({
      participant_id: participant.id,
      challenge_id: activeChallenge.id,
      success: true,
      ip_address: '127.0.0.1',
    });
    expect(mfaClaim.markMfaComplete).toHaveBeenCalledWith('fb-uid-1', authTime);
  });

  it('invalid OTP: does not consume, records failure, returns 401 INVALID_OTP', async () => {
    vi.spyOn(mfaRepository, 'tryConsumeChallenge').mockResolvedValueOnce(null);
    vi.spyOn(mfaRepository, 'getChallengeById')
      .mockResolvedValueOnce(activeChallenge)
      .mockResolvedValueOnce(activeChallenge);

    const result = await verifyMfaOtpForParticipant(
      participant,
      firebaseUser,
      activeChallenge.id,
      '000000'
    );

    expect(result).toMatchObject({
      ok: false,
      status: 401,
      code: 'INVALID_OTP',
    });
    expect(mfaRepository.createAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    );
    expect(mfaClaim.markMfaComplete).not.toHaveBeenCalled();
  });

  it('boundary: concurrent consume race returns OTP_CONSUMED without setting MFA', async () => {
    vi.spyOn(mfaRepository, 'tryConsumeChallenge').mockResolvedValueOnce(null);
    vi.spyOn(mfaRepository, 'getChallengeById')
      .mockResolvedValueOnce(activeChallenge)
      .mockResolvedValueOnce({
        ...activeChallenge,
        consumed_at: new Date().toISOString(),
      });

    const result = await verifyMfaOtpForParticipant(
      participant,
      firebaseUser,
      activeChallenge.id,
      otp
    );

    expect(result).toMatchObject({ ok: false, status: 400, code: 'OTP_CONSUMED' });
    expect(mfaClaim.markMfaComplete).not.toHaveBeenCalled();
  });

  it('expired challenge: invalidates pending and returns OTP_EXPIRED', async () => {
    const expired: MfaChallenge = {
      ...activeChallenge,
      expires_at: new Date(Date.now() - 1_000).toISOString(),
    };
    vi.spyOn(mfaRepository, 'getChallengeById').mockResolvedValueOnce(expired);

    const result = await verifyMfaOtpForParticipant(
      participant,
      firebaseUser,
      expired.id,
      otp
    );

    expect(result).toMatchObject({ ok: false, status: 400, code: 'OTP_EXPIRED' });
    expect(mfaRepository.invalidatePendingChallenges).toHaveBeenCalledWith(participant.id);
    expect(mfaRepository.tryConsumeChallenge).not.toHaveBeenCalled();
  });

  it('already consumed challenge: returns OTP_CONSUMED', async () => {
    vi.spyOn(mfaRepository, 'getChallengeById').mockResolvedValueOnce({
      ...activeChallenge,
      consumed_at: new Date().toISOString(),
    });

    const result = await verifyMfaOtpForParticipant(
      participant,
      firebaseUser,
      activeChallenge.id,
      otp
    );

    expect(result).toMatchObject({ ok: false, code: 'OTP_CONSUMED' });
    expect(mfaRepository.tryConsumeChallenge).not.toHaveBeenCalled();
  });

  it('predecessor invalidated on resend: rejects with OTP_EXPIRED and never consumes', async () => {
    vi.spyOn(mfaRepository, 'getChallengeById').mockResolvedValueOnce({
      ...activeChallenge,
      invalidated_at: new Date().toISOString(),
    });

    const result = await verifyMfaOtpForParticipant(
      participant,
      firebaseUser,
      activeChallenge.id,
      otp
    );

    expect(result).toMatchObject({ ok: false, status: 400, code: 'OTP_EXPIRED' });
    expect(mfaRepository.tryConsumeChallenge).not.toHaveBeenCalled();
    expect(mfaClaim.markMfaComplete).not.toHaveBeenCalled();
  });

  it('already locked: invalidates outstanding challenges and returns ACCOUNT_LOCKED', async () => {
    const now = Date.now();
    vi.spyOn(mfaRepository, 'getRecentAttempts').mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({
        id: `att-${i}`,
        participant_id: participant.id,
        challenge_id: activeChallenge.id,
        success: false,
        ip_address: null,
        created_at: new Date(now - (5 - i) * 1000).toISOString(),
      })) as MfaAttempt[]
    );

    const result = await verifyMfaOtpForParticipant(
      participant,
      firebaseUser,
      activeChallenge.id,
      otp
    );

    expect(result).toMatchObject({ ok: false, status: 423, code: 'ACCOUNT_LOCKED' });
    expect(mfaRepository.invalidatePendingChallenges).toHaveBeenCalledWith(participant.id);
    expect(mfaRepository.tryConsumeChallenge).not.toHaveBeenCalled();
  });

  it('challenge owned by another participant: CHALLENGE_NOT_FOUND', async () => {
    vi.spyOn(mfaRepository, 'getChallengeById').mockResolvedValueOnce({
      ...activeChallenge,
      participant_id: 'other-part',
    });

    const result = await verifyMfaOtpForParticipant(
      participant,
      firebaseUser,
      activeChallenge.id,
      otp
    );

    expect(result).toMatchObject({ ok: false, status: 404, code: 'CHALLENGE_NOT_FOUND' });
  });

  it('fifth incorrect attempt locks account and invalidates challenges', async () => {
    const now = Date.now();
    const priorFails = Array.from({ length: 4 }, (_, i) => ({
      id: `att-${i}`,
      participant_id: participant.id,
      challenge_id: activeChallenge.id,
      success: false,
      ip_address: null,
      created_at: new Date(now - (4 - i) * 1000).toISOString(),
    }));

    vi.spyOn(mfaRepository, 'tryConsumeChallenge').mockResolvedValueOnce(null);
    vi.spyOn(mfaRepository, 'getChallengeById')
      .mockResolvedValueOnce(activeChallenge)
      .mockResolvedValueOnce(activeChallenge);
    vi.spyOn(mfaRepository, 'getRecentAttempts')
      .mockResolvedValueOnce([]) // pre-check unlocked
      .mockResolvedValueOnce([
        {
          id: 'att-5',
          participant_id: participant.id,
          challenge_id: activeChallenge.id,
          success: false,
          ip_address: null,
          created_at: new Date(now).toISOString(),
        },
        ...priorFails,
      ] as MfaAttempt[]);

    const result = await verifyMfaOtpForParticipant(
      participant,
      firebaseUser,
      activeChallenge.id,
      '999999'
    );

    expect(result).toMatchObject({ ok: false, status: 423, code: 'ACCOUNT_LOCKED' });
    expect(mfaRepository.invalidatePendingChallenges).toHaveBeenCalledWith(participant.id);
    expect(mfaClaim.markMfaComplete).not.toHaveBeenCalled();
  });

  it('returns MFA_STORE_UNAVAILABLE when MFA tables are missing', async () => {
    vi.spyOn(mfaRepository, 'getRecentAttempts').mockRejectedValueOnce({
      code: '42P01',
      message: 'relation "mfa_attempts" does not exist',
    });

    const result = await verifyMfaOtpForParticipant(
      participant,
      firebaseUser,
      activeChallenge.id,
      otp
    );

    expect(result).toMatchObject({
      ok: false,
      status: 503,
      code: 'MFA_STORE_UNAVAILABLE',
    });
  });
});
