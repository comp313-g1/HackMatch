import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { mfaRepository } from './mfa.repository.js';
import { participantsRepository } from './participants.repository.js';
import * as clientModule from './client.js';
import type { Participant, MfaChallenge, MfaAttempt } from './types.js';

describe('mfaRepository', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const mockParticipant: Participant = {
    id: 'part-uuid-1',
    firebase_uid: 'fb-part-1',
    email: 'part@example.com',
    full_name: 'Test Participant',
    role: 'PART',
    is_verified: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const mockChallenge: MfaChallenge = {
    id: 'chal-uuid-1',
    participant_id: 'part-uuid-1',
    otp_hash: 'hashed_otp_value_123',
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    consumed_at: null,
    invalidated_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const mockAttempt: MfaAttempt = {
    id: 'att-uuid-1',
    participant_id: 'part-uuid-1',
    challenge_id: 'chal-uuid-1',
    success: true,
    ip_address: '192.168.1.1',
    created_at: new Date().toISOString(),
  };

  describe('createChallenge validation', () => {
    it('throws when participant_id is missing or empty', async () => {
      await expect(
        mfaRepository.createChallenge({
          participant_id: '',
          otp_hash: 'hash123',
          expires_at: new Date().toISOString(),
        })
      ).rejects.toThrow('participant_id is required');
    });

    it('throws when otp_hash is missing or blank', async () => {
      await expect(
        mfaRepository.createChallenge({
          participant_id: 'part-uuid-1',
          otp_hash: '   ',
          expires_at: new Date().toISOString(),
        })
      ).rejects.toThrow('otp_hash is required');
    });

    it('throws when expires_at is invalid date string', async () => {
      await expect(
        mfaRepository.createChallenge({
          participant_id: 'part-uuid-1',
          otp_hash: 'hash123',
          expires_at: 'invalid-date',
        })
      ).rejects.toThrow('expires_at must be a valid ISO date string');
    });

    it('throws when participant does not exist', async () => {
      vi.spyOn(participantsRepository, 'findById').mockResolvedValue(null);

      await expect(
        mfaRepository.createChallenge({
          participant_id: 'non-existent-id',
          otp_hash: 'hash123',
          expires_at: new Date().toISOString(),
        })
      ).rejects.toThrow("Participant with ID 'non-existent-id' not found");
    });
  });

  describe('createChallenge success and error handling', () => {
    it('creates challenge successfully for valid participant', async () => {
      vi.spyOn(participantsRepository, 'findById').mockResolvedValue(mockParticipant);

      const mockSingle = vi.fn().mockResolvedValue({ data: mockChallenge, error: null });
      const mockSelect = vi.fn().mockReturnValue({ single: mockSingle });
      const mockInsert = vi.fn().mockReturnValue({ select: mockSelect });
      const mockFrom = vi.fn().mockReturnValue({ insert: mockInsert });

      vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
        from: mockFrom,
      } as unknown as SupabaseClient);

      const result = await mfaRepository.createChallenge({
        participant_id: 'part-uuid-1',
        otp_hash: 'hashed_otp_value_123',
        expires_at: mockChallenge.expires_at,
      });

      expect(result).toEqual(mockChallenge);
      expect(mockFrom).toHaveBeenCalledWith('mfa_challenges');
      expect(mockInsert).toHaveBeenCalledWith({
        participant_id: 'part-uuid-1',
        otp_hash: 'hashed_otp_value_123',
        expires_at: mockChallenge.expires_at,
      });
    });

    it('throws when database query fails during challenge creation', async () => {
      vi.spyOn(participantsRepository, 'findById').mockResolvedValue(mockParticipant);

      const dbError = new Error('Database insert failed');
      const mockSingle = vi.fn().mockResolvedValue({ data: null, error: dbError });
      const mockSelect = vi.fn().mockReturnValue({ single: mockSingle });
      const mockInsert = vi.fn().mockReturnValue({ select: mockSelect });
      const mockFrom = vi.fn().mockReturnValue({ insert: mockInsert });

      vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
        from: mockFrom,
      } as unknown as SupabaseClient);

      await expect(
        mfaRepository.createChallenge({
          participant_id: 'part-uuid-1',
          otp_hash: 'hashed_otp_value_123',
          expires_at: mockChallenge.expires_at,
        })
      ).rejects.toThrow('Database insert failed');
    });
  });

  describe('getLatestActiveChallenge', () => {
    it('throws when participant_id is missing', async () => {
      await expect(mfaRepository.getLatestActiveChallenge('')).rejects.toThrow(
        'participant_id is required'
      );
    });

    it('retrieves active challenge when present', async () => {
      const mockMaybeSingle = vi.fn().mockResolvedValue({ data: mockChallenge, error: null });
      const mockLimit = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
      const mockOrder = vi.fn().mockReturnValue({ limit: mockLimit });
      const mockGt = vi.fn().mockReturnValue({ order: mockOrder });
      const mockIs2 = vi.fn().mockReturnValue({ gt: mockGt });
      const mockIs1 = vi.fn().mockReturnValue({ is: mockIs2 });
      const mockEq = vi.fn().mockReturnValue({ is: mockIs1 });
      const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
      const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

      vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
        from: mockFrom,
      } as unknown as SupabaseClient);

      const result = await mfaRepository.getLatestActiveChallenge('part-uuid-1');

      expect(result).toEqual(mockChallenge);
      expect(mockFrom).toHaveBeenCalledWith('mfa_challenges');
      expect(mockSelect).toHaveBeenCalledWith('*');
      expect(mockEq).toHaveBeenCalledWith('participant_id', 'part-uuid-1');
      expect(mockIs1).toHaveBeenCalledWith('consumed_at', null);
      expect(mockIs2).toHaveBeenCalledWith('invalidated_at', null);
    });

    it('returns null when no active challenge exists', async () => {
      const mockMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
      const mockLimit = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
      const mockOrder = vi.fn().mockReturnValue({ limit: mockLimit });
      const mockGt = vi.fn().mockReturnValue({ order: mockOrder });
      const mockIs2 = vi.fn().mockReturnValue({ gt: mockGt });
      const mockIs1 = vi.fn().mockReturnValue({ is: mockIs2 });
      const mockEq = vi.fn().mockReturnValue({ is: mockIs1 });
      const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
      const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

      vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
        from: mockFrom,
      } as unknown as SupabaseClient);

      const result = await mfaRepository.getLatestActiveChallenge('part-uuid-1');

      expect(result).toBeNull();
    });
  });

  describe('invalidatePendingChallenges', () => {
    it('throws when participant_id is missing', async () => {
      await expect(mfaRepository.invalidatePendingChallenges('')).rejects.toThrow(
        'participant_id is required'
      );
    });

    it('invalidates pending challenges and returns updated count', async () => {
      const mockSelect = vi.fn().mockResolvedValue({ data: [{ id: 'chal-1' }, { id: 'chal-2' }], error: null });
      const mockIs2 = vi.fn().mockReturnValue({ select: mockSelect });
      const mockIs1 = vi.fn().mockReturnValue({ is: mockIs2 });
      const mockEq = vi.fn().mockReturnValue({ is: mockIs1 });
      const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });
      const mockFrom = vi.fn().mockReturnValue({ update: mockUpdate });

      vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
        from: mockFrom,
      } as unknown as SupabaseClient);

      const count = await mfaRepository.invalidatePendingChallenges('part-uuid-1');

      expect(count).toBe(2);
      expect(mockFrom).toHaveBeenCalledWith('mfa_challenges');
      expect(mockEq).toHaveBeenCalledWith('participant_id', 'part-uuid-1');
      expect(mockIs1).toHaveBeenCalledWith('consumed_at', null);
      expect(mockIs2).toHaveBeenCalledWith('invalidated_at', null);
    });
  });

  describe('markChallengeConsumed', () => {
    it('throws when challengeId is missing', async () => {
      await expect(mfaRepository.markChallengeConsumed('')).rejects.toThrow('challengeId is required');
    });

    it('marks challenge consumed and returns record', async () => {
      const consumedChallenge = { ...mockChallenge, consumed_at: new Date().toISOString() };
      const mockSingle = vi.fn().mockResolvedValue({ data: consumedChallenge, error: null });
      const mockSelect = vi.fn().mockReturnValue({ single: mockSingle });
      const mockIs2 = vi.fn().mockReturnValue({ select: mockSelect });
      const mockIs1 = vi.fn().mockReturnValue({ is: mockIs2 });
      const mockEq = vi.fn().mockReturnValue({ is: mockIs1 });
      const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });
      const mockFrom = vi.fn().mockReturnValue({ update: mockUpdate });

      vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
        from: mockFrom,
      } as unknown as SupabaseClient);

      const result = await mfaRepository.markChallengeConsumed('chal-uuid-1');

      expect(result).toEqual(consumedChallenge);
      expect(mockFrom).toHaveBeenCalledWith('mfa_challenges');
      expect(mockEq).toHaveBeenCalledWith('id', 'chal-uuid-1');
      expect(mockIs1).toHaveBeenCalledWith('consumed_at', null);
      expect(mockIs2).toHaveBeenCalledWith('invalidated_at', null);
    });
  });

  describe('createAttempt validation and execution', () => {
    it('throws when participant_id is missing', async () => {
      await expect(
        mfaRepository.createAttempt({
          participant_id: '',
          success: true,
        })
      ).rejects.toThrow('participant_id is required');
    });

    it('throws when success is not boolean', async () => {
      await expect(
        mfaRepository.createAttempt({
          participant_id: 'part-uuid-1',
          success: 'true' as unknown as boolean,
        })
      ).rejects.toThrow('success must be a boolean');
    });

    it('throws when participant does not exist', async () => {
      vi.spyOn(participantsRepository, 'findById').mockResolvedValue(null);

      await expect(
        mfaRepository.createAttempt({
          participant_id: 'non-existent-id',
          success: false,
        })
      ).rejects.toThrow("Participant with ID 'non-existent-id' not found");
    });

    it('creates attempt successfully', async () => {
      vi.spyOn(participantsRepository, 'findById').mockResolvedValue(mockParticipant);

      const mockSingle = vi.fn().mockResolvedValue({ data: mockAttempt, error: null });
      const mockSelect = vi.fn().mockReturnValue({ single: mockSingle });
      const mockInsert = vi.fn().mockReturnValue({ select: mockSelect });
      const mockFrom = vi.fn().mockReturnValue({ insert: mockInsert });

      vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
        from: mockFrom,
      } as unknown as SupabaseClient);

      const result = await mfaRepository.createAttempt({
        participant_id: 'part-uuid-1',
        challenge_id: 'chal-uuid-1',
        success: true,
        ip_address: '192.168.1.1',
      });

      expect(result).toEqual(mockAttempt);
      expect(mockFrom).toHaveBeenCalledWith('mfa_attempts');
      expect(mockInsert).toHaveBeenCalledWith({
        participant_id: 'part-uuid-1',
        challenge_id: 'chal-uuid-1',
        success: true,
        ip_address: '192.168.1.1',
      });
    });
  });

  describe('getRecentAttempts', () => {
    it('throws when participant_id is missing', async () => {
      await expect(mfaRepository.getRecentAttempts('')).rejects.toThrow('participant_id is required');
    });

    it('retrieves recent attempts with default limit', async () => {
      const mockLimit = vi.fn().mockResolvedValue({ data: [mockAttempt], error: null });
      const mockOrder = vi.fn().mockReturnValue({ limit: mockLimit });
      const mockEq = vi.fn().mockReturnValue({ order: mockOrder });
      const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
      const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

      vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
        from: mockFrom,
      } as unknown as SupabaseClient);

      const results = await mfaRepository.getRecentAttempts('part-uuid-1');

      expect(results).toEqual([mockAttempt]);
      expect(mockFrom).toHaveBeenCalledWith('mfa_attempts');
      expect(mockEq).toHaveBeenCalledWith('participant_id', 'part-uuid-1');
      expect(mockOrder).toHaveBeenCalledWith('created_at', { ascending: false });
      expect(mockLimit).toHaveBeenCalledWith(10);
    });
  });

  describe('countRecentChallenges', () => {
    it('throws when participant_id is missing', async () => {
      await expect(mfaRepository.countRecentChallenges('', new Date())).rejects.toThrow(
        'participant_id is required'
      );
    });

    it('throws when since date is invalid', async () => {
      await expect(
        mfaRepository.countRecentChallenges('part-uuid-1', 'not-a-date')
      ).rejects.toThrow('since must be a valid date or ISO string');
    });

    it('returns exact count of challenges created since timestamp', async () => {
      const since = new Date(Date.now() - 60 * 1000);
      const mockGte = vi.fn().mockResolvedValue({ count: 3, error: null });
      const mockEq = vi.fn().mockReturnValue({ gte: mockGte });
      const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
      const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

      vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
        from: mockFrom,
      } as unknown as SupabaseClient);

      const count = await mfaRepository.countRecentChallenges('part-uuid-1', since);

      expect(count).toBe(3);
      expect(mockFrom).toHaveBeenCalledWith('mfa_challenges');
      expect(mockSelect).toHaveBeenCalledWith('*', { count: 'exact', head: true });
      expect(mockEq).toHaveBeenCalledWith('participant_id', 'part-uuid-1');
      expect(mockGte).toHaveBeenCalledWith('created_at', since.toISOString());
    });
  });
});
