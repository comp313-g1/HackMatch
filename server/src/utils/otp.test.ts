import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateOtp,
  hashOtp,
  verifyOtpHash,
  evaluateAccountLockout,
  createMfaChallenge,
  OTP_EXPIRY_SECONDS,
  LOCKOUT_WINDOW_MS,
  MAX_CONSECUTIVE_FAILURES,
} from './otp.js';
import { mfaRepository } from '../db/mfa.repository.js';
import type { MfaAttempt, MfaChallenge } from '../db/types.js';

describe('OTP Utility (server/src/utils/otp.ts)', () => {
  describe('Constants', () => {
    it('defines 10-minute OTP expiry and 15-minute 5-attempt lockout per FR-009, FR-010, NR-008', () => {
      expect(OTP_EXPIRY_SECONDS).toBe(600);
      expect(LOCKOUT_WINDOW_MS).toBe(15 * 60 * 1000);
      expect(MAX_CONSECUTIVE_FAILURES).toBe(5);
    });
  });

  describe('generateOtp()', () => {
    it('generates a 6-digit numeric string within [100000, 999999]', () => {
      for (let i = 0; i < 50; i++) {
        const otp = generateOtp();
        expect(otp).toMatch(/^\d{6}$/);
        const num = parseInt(otp, 10);
        expect(num).toBeGreaterThanOrEqual(100000);
        expect(num).toBeLessThan(1000000);
      }
    });

    it('generates non-constant values across invocations', () => {
      const set = new Set<string>();
      for (let i = 0; i < 20; i++) {
        set.add(generateOtp());
      }
      expect(set.size).toBeGreaterThan(1);
    });
  });

  describe('hashOtp()', () => {
    it('produces a deterministic 64-character SHA-256 hex string', () => {
      const hash1 = hashOtp('123456');
      const hash2 = hashOtp('123456');
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
      // Known SHA-256 of "123456"
      expect(hash1).toBe('8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92');
    });

    it('trims leading and trailing whitespace before hashing', () => {
      expect(hashOtp('  654321  ')).toBe(hashOtp('654321'));
    });

    it('produces distinct hashes for distinct OTP codes', () => {
      expect(hashOtp('111111')).not.toBe(hashOtp('222222'));
    });
  });

  describe('verifyOtpHash() (NR-008)', () => {
    const validOtp = '654321';
    const expectedHash = hashOtp(validOtp);

    it('returns true when rawOtp matches expected SHA-256 hash', () => {
      expect(verifyOtpHash(validOtp, expectedHash)).toBe(true);
    });

    it('returns true when rawOtp has outer whitespace', () => {
      expect(verifyOtpHash('  654321  ', expectedHash)).toBe(true);
    });

    it('returns true when expected hash has uppercase hex characters', () => {
      expect(verifyOtpHash(validOtp, expectedHash.toUpperCase())).toBe(true);
    });

    it('returns false when rawOtp does not match expected hash', () => {
      expect(verifyOtpHash('000000', expectedHash)).toBe(false);
    });

    it('returns false without throwing when inputs are empty or blank', () => {
      expect(verifyOtpHash('', expectedHash)).toBe(false);
      expect(verifyOtpHash('   ', expectedHash)).toBe(false);
      expect(verifyOtpHash(validOtp, '')).toBe(false);
      expect(verifyOtpHash(validOtp, '   ')).toBe(false);
    });

    it('returns false without throwing when expected hash is invalid hex or wrong length', () => {
      expect(verifyOtpHash(validOtp, 'not-a-valid-hex-hash')).toBe(false);
      expect(verifyOtpHash(validOtp, 'a'.repeat(63))).toBe(false);
      expect(verifyOtpHash(validOtp, 'a'.repeat(65))).toBe(false);
      expect(verifyOtpHash(validOtp, 'z'.repeat(64))).toBe(false);
    });

    it('returns false when non-string values are passed', () => {
      expect(verifyOtpHash(null as unknown as string, expectedHash)).toBe(false);
      expect(verifyOtpHash(validOtp, undefined as unknown as string)).toBe(false);
    });
  });

  describe('evaluateAccountLockout() (FR-010 / NR-008)', () => {
    const participantId = '00000000-0000-0000-0000-000000000001';
    const baseTime = 1_000_000_000_000;

    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('returns locked: false if participantId is missing or empty', async () => {
      expect(await evaluateAccountLockout('')).toEqual({ locked: false });
      expect(await evaluateAccountLockout('   ')).toEqual({ locked: false });
    });

    it('returns locked: false when no attempts exist', async () => {
      vi.spyOn(mfaRepository, 'getRecentAttempts').mockResolvedValue([]);
      const result = await evaluateAccountLockout(participantId, baseTime);
      expect(result).toEqual({ locked: false });
    });

    it('returns locked: false when fewer than 5 consecutive failures exist (e.g. 4 failures)', async () => {
      const attempts: MfaAttempt[] = [
        { id: '1', participant_id: participantId, success: false, created_at: new Date(baseTime - 1000).toISOString() },
        { id: '2', participant_id: participantId, success: false, created_at: new Date(baseTime - 2000).toISOString() },
        { id: '3', participant_id: participantId, success: false, created_at: new Date(baseTime - 3000).toISOString() },
        { id: '4', participant_id: participantId, success: false, created_at: new Date(baseTime - 4000).toISOString() },
      ];
      vi.spyOn(mfaRepository, 'getRecentAttempts').mockResolvedValue(attempts);

      const result = await evaluateAccountLockout(participantId, baseTime);
      expect(result).toEqual({ locked: false });
    });

    it('returns locked: true with correct retryAfterSeconds when 5 consecutive failures occurred within 15 minutes', async () => {
      // 5 failures: 5th failure (id: 5) happened at baseTime - 5 minutes (300,000 ms ago)
      const fifthFailureTime = baseTime - 300_000;
      const attempts: MfaAttempt[] = [
        { id: '5', participant_id: participantId, success: false, created_at: new Date(fifthFailureTime).toISOString() },
        { id: '4', participant_id: participantId, success: false, created_at: new Date(fifthFailureTime - 60_000).toISOString() },
        { id: '3', participant_id: participantId, success: false, created_at: new Date(fifthFailureTime - 120_000).toISOString() },
        { id: '2', participant_id: participantId, success: false, created_at: new Date(fifthFailureTime - 180_000).toISOString() },
        { id: '1', participant_id: participantId, success: false, created_at: new Date(fifthFailureTime - 240_000).toISOString() },
      ];
      vi.spyOn(mfaRepository, 'getRecentAttempts').mockResolvedValue(attempts);

      const result = await evaluateAccountLockout(participantId, baseTime);
      expect(result.locked).toBe(true);
      // Lockout window is 15 min (900s), 5 min (300s) have passed -> 10 min (600s) remaining
      expect(result.retryAfterSeconds).toBe(600);
    });

    it('returns locked: false with lastLockoutEndsAt when 5 consecutive failures occurred more than 15 minutes ago (lock expired)', async () => {
      // 5th failure happened at baseTime - 16 minutes (960,000 ms ago)
      const fifthFailureTime = baseTime - 960_000;
      const attempts: MfaAttempt[] = [
        { id: '5', participant_id: participantId, success: false, created_at: new Date(baseTime - 920_000).toISOString() },
        { id: '4', participant_id: participantId, success: false, created_at: new Date(baseTime - 930_000).toISOString() },
        { id: '3', participant_id: participantId, success: false, created_at: new Date(baseTime - 940_000).toISOString() },
        { id: '2', participant_id: participantId, success: false, created_at: new Date(baseTime - 950_000).toISOString() },
        { id: '1', participant_id: participantId, success: false, created_at: new Date(fifthFailureTime).toISOString() },
      ];
      vi.spyOn(mfaRepository, 'getRecentAttempts').mockResolvedValue(attempts);

      const result = await evaluateAccountLockout(participantId, baseTime);
      expect(result).toEqual({
        locked: false,
        lastLockoutEndsAt: baseTime - 20_000,
      });
    });

    it('returns locked: false at exact boundary now === lockoutEndsAt', async () => {
      // 5th failure occurred exactly 15 minutes ago
      const fifthFailureTime = baseTime - LOCKOUT_WINDOW_MS;
      const attempts: MfaAttempt[] = [
        { id: '5', participant_id: participantId, success: false, created_at: new Date(fifthFailureTime).toISOString() },
        { id: '4', participant_id: participantId, success: false, created_at: new Date(fifthFailureTime - 1000).toISOString() },
        { id: '3', participant_id: participantId, success: false, created_at: new Date(fifthFailureTime - 2000).toISOString() },
        { id: '2', participant_id: participantId, success: false, created_at: new Date(fifthFailureTime - 3000).toISOString() },
        { id: '1', participant_id: participantId, success: false, created_at: new Date(fifthFailureTime - 4000).toISOString() },
      ];
      vi.spyOn(mfaRepository, 'getRecentAttempts').mockResolvedValue(attempts);

      const result = await evaluateAccountLockout(participantId, baseTime);
      expect(result).toEqual({
        locked: false,
        lastLockoutEndsAt: baseTime,
      });
    });

    it('remains locked when more than 5 failures occurred during the lockout window', async () => {
      const fifthFailureTime = baseTime - 300_000;
      const attempts: MfaAttempt[] = [
        { id: '7', participant_id: participantId, success: false, created_at: new Date(baseTime - 60_000).toISOString() },
        { id: '6', participant_id: participantId, success: false, created_at: new Date(baseTime - 120_000).toISOString() },
        { id: '5', participant_id: participantId, success: false, created_at: new Date(fifthFailureTime).toISOString() },
        { id: '4', participant_id: participantId, success: false, created_at: new Date(fifthFailureTime - 60_000).toISOString() },
        { id: '3', participant_id: participantId, success: false, created_at: new Date(fifthFailureTime - 120_000).toISOString() },
        { id: '2', participant_id: participantId, success: false, created_at: new Date(fifthFailureTime - 180_000).toISOString() },
        { id: '1', participant_id: participantId, success: false, created_at: new Date(fifthFailureTime - 240_000).toISOString() },
      ];
      vi.spyOn(mfaRepository, 'getRecentAttempts').mockResolvedValue(attempts);

      const result = await evaluateAccountLockout(participantId, baseTime);
      expect(result.locked).toBe(true);
      expect(result.retryAfterSeconds).toBe(600);
    });

    it('triggers a fresh lockout after a previous lockout expired and 5 new failures occur', async () => {
      // 5 failures from 1 hour ago (expired), then 5 fresh failures 5 minutes ago
      const oldLockoutTime = baseTime - 3_600_000;
      const newFifthFailureTime = baseTime - 300_000;
      const attempts: MfaAttempt[] = [
        { id: '10', participant_id: participantId, success: false, created_at: new Date(newFifthFailureTime).toISOString() },
        { id: '9', participant_id: participantId, success: false, created_at: new Date(newFifthFailureTime - 1000).toISOString() },
        { id: '8', participant_id: participantId, success: false, created_at: new Date(newFifthFailureTime - 2000).toISOString() },
        { id: '7', participant_id: participantId, success: false, created_at: new Date(newFifthFailureTime - 3000).toISOString() },
        { id: '6', participant_id: participantId, success: false, created_at: new Date(newFifthFailureTime - 4000).toISOString() },
        { id: '5', participant_id: participantId, success: false, created_at: new Date(oldLockoutTime).toISOString() },
        { id: '4', participant_id: participantId, success: false, created_at: new Date(oldLockoutTime - 1000).toISOString() },
        { id: '3', participant_id: participantId, success: false, created_at: new Date(oldLockoutTime - 2000).toISOString() },
        { id: '2', participant_id: participantId, success: false, created_at: new Date(oldLockoutTime - 3000).toISOString() },
        { id: '1', participant_id: participantId, success: false, created_at: new Date(oldLockoutTime - 4000).toISOString() },
      ];
      vi.spyOn(mfaRepository, 'getRecentAttempts').mockResolvedValue(attempts);

      const result = await evaluateAccountLockout(participantId, baseTime);
      expect(result.locked).toBe(true);
      expect(result.retryAfterSeconds).toBe(600);
    });

    it('resets failure count and clears prior lockout when a successful attempt intervenes', async () => {
      // 5 failures from 30 minutes ago, followed by 1 success, followed by 2 failures
      const attempts: MfaAttempt[] = [
        { id: '8', participant_id: participantId, success: false, created_at: new Date(baseTime - 1000).toISOString() },
        { id: '7', participant_id: participantId, success: false, created_at: new Date(baseTime - 2000).toISOString() },
        { id: '6', participant_id: participantId, success: true, created_at: new Date(baseTime - 3000).toISOString() },
        { id: '5', participant_id: participantId, success: false, created_at: new Date(baseTime - 1_800_000).toISOString() },
        { id: '4', participant_id: participantId, success: false, created_at: new Date(baseTime - 1_810_000).toISOString() },
        { id: '3', participant_id: participantId, success: false, created_at: new Date(baseTime - 1_820_000).toISOString() },
        { id: '2', participant_id: participantId, success: false, created_at: new Date(baseTime - 1_830_000).toISOString() },
        { id: '1', participant_id: participantId, success: false, created_at: new Date(baseTime - 1_840_000).toISOString() },
      ];
      vi.spyOn(mfaRepository, 'getRecentAttempts').mockResolvedValue(attempts);

      const result = await evaluateAccountLockout(participantId, baseTime);
      expect(result).toEqual({ locked: false });
    });

    it('resets failure counter after lockout expiration (new failure does not re-trigger old lock)', async () => {
      // 5 failures from 30 minutes ago (lock expired), followed by 1 new failure 1 minute ago
      const attempts: MfaAttempt[] = [
        { id: '6', participant_id: participantId, success: false, created_at: new Date(baseTime - 60_000).toISOString() },
        { id: '5', participant_id: participantId, success: false, created_at: new Date(baseTime - 1_800_000).toISOString() },
        { id: '4', participant_id: participantId, success: false, created_at: new Date(baseTime - 1_810_000).toISOString() },
        { id: '3', participant_id: participantId, success: false, created_at: new Date(baseTime - 1_820_000).toISOString() },
        { id: '2', participant_id: participantId, success: false, created_at: new Date(baseTime - 1_830_000).toISOString() },
        { id: '1', participant_id: participantId, success: false, created_at: new Date(baseTime - 1_840_000).toISOString() },
      ];
      vi.spyOn(mfaRepository, 'getRecentAttempts').mockResolvedValue(attempts);

      const result = await evaluateAccountLockout(participantId, baseTime);
      expect(result).toEqual({
        locked: false,
        lastLockoutEndsAt: baseTime - 900_000,
      });
    });
  });

  describe('createMfaChallenge() (FR-009 / US-004 AC 1)', () => {
    const participantId = '00000000-0000-0000-0000-000000000001';
    const rawOtp = '123456';
    const baseTime = 1_000_000_000_000;

    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('throws when participantId or rawOtp is missing', async () => {
      await expect(createMfaChallenge('', rawOtp)).rejects.toThrow('participant_id is required');
      await expect(createMfaChallenge(participantId, '')).rejects.toThrow('rawOtp is required');
    });

    it('invalidates existing pending challenges and creates challenge with SHA-256 verifier and 10-minute expiry', async () => {
      const invalidateSpy = vi.spyOn(mfaRepository, 'invalidatePendingChallenges').mockResolvedValue(1);
      const mockCreatedChallenge: MfaChallenge = {
        id: 'challenge-uuid-1',
        participant_id: participantId,
        otp_hash: hashOtp(rawOtp),
        expires_at: new Date(baseTime + 600_000).toISOString(),
        created_at: new Date(baseTime).toISOString(),
        updated_at: new Date(baseTime).toISOString(),
      };
      const createSpy = vi.spyOn(mfaRepository, 'createChallenge').mockResolvedValue(mockCreatedChallenge);

      const result = await createMfaChallenge(participantId, rawOtp, baseTime);

      expect(invalidateSpy).toHaveBeenCalledWith(participantId);
      expect(createSpy).toHaveBeenCalledWith({
        participant_id: participantId,
        otp_hash: hashOtp(rawOtp),
        expires_at: new Date(baseTime + 600_000).toISOString(),
      });
      expect(result).toEqual(mockCreatedChallenge);
    });
  });
});
