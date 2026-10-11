import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  participantsRepository,
  createParticipant,
  findByFirebaseUid,
  updateVerificationStatus,
  findById,
  findByEmail,
} from './participants.repository.js';
import * as clientModule from './client.js';
import type { Participant, CreateParticipantDTO } from './types.js';

describe('participantsRepository unit tests (US-001 T1 / AC 3)', () => {
  const mockParticipant: Participant = {
    id: 'part-uuid-101',
    firebase_uid: 'fb-uid-101',
    email: 'test@example.com',
    full_name: 'Test Participant',
    role: 'PART',
    is_verified: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('createParticipant', () => {
    const createDto: CreateParticipantDTO = {
      firebase_uid: 'fb-uid-101',
      email: 'test@example.com',
      full_name: 'Test Participant',
      role: 'PART',
      is_verified: false,
    };

    it('inserts DTO and returns single persisted record', async () => {
      const mockSingle = vi.fn().mockResolvedValue({ data: mockParticipant, error: null });
      const mockSelect = vi.fn().mockReturnValue({ single: mockSingle });
      const mockInsert = vi.fn().mockReturnValue({ select: mockSelect });
      const mockFrom = vi.fn().mockReturnValue({ insert: mockInsert });

      vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
        from: mockFrom,
      } as unknown as SupabaseClient);

      const result = await participantsRepository.createParticipant(createDto);

      expect(mockFrom).toHaveBeenCalledWith('participants');
      expect(mockInsert).toHaveBeenCalledWith(createDto);
      expect(mockSelect).toHaveBeenCalledWith('*');
      expect(mockSingle).toHaveBeenCalledOnce();
      expect(result).toEqual(mockParticipant);
    });

    it('rethrows Supabase error with code 23505 unchanged for 409 conflict mapping', async () => {
      const dbConflictError = {
        code: '23505',
        message: 'duplicate key value violates unique constraint "idx_participants_lower_email"',
      };

      const mockSingle = vi.fn().mockResolvedValue({ data: null, error: dbConflictError });
      const mockSelect = vi.fn().mockReturnValue({ single: mockSingle });
      const mockInsert = vi.fn().mockReturnValue({ select: mockSelect });
      const mockFrom = vi.fn().mockReturnValue({ insert: mockInsert });

      vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
        from: mockFrom,
      } as unknown as SupabaseClient);

      await expect(participantsRepository.createParticipant(createDto)).rejects.toMatchObject({
        code: '23505',
      });
    });

    it('works identically via exported bound function createParticipant', async () => {
      const mockSingle = vi.fn().mockResolvedValue({ data: mockParticipant, error: null });
      const mockSelect = vi.fn().mockReturnValue({ single: mockSingle });
      const mockInsert = vi.fn().mockReturnValue({ select: mockSelect });
      const mockFrom = vi.fn().mockReturnValue({ insert: mockInsert });

      vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
        from: mockFrom,
      } as unknown as SupabaseClient);

      const result = await createParticipant(createDto);
      expect(result).toEqual(mockParticipant);
    });
  });

  describe('findByFirebaseUid', () => {
    it('returns participant when record exists', async () => {
      const mockMaybeSingle = vi.fn().mockResolvedValue({ data: mockParticipant, error: null });
      const mockEq = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
      const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
      const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

      vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
        from: mockFrom,
      } as unknown as SupabaseClient);

      const result = await participantsRepository.findByFirebaseUid('fb-uid-101');

      expect(mockFrom).toHaveBeenCalledWith('participants');
      expect(mockSelect).toHaveBeenCalledWith('*');
      expect(mockEq).toHaveBeenCalledWith('firebase_uid', 'fb-uid-101');
      expect(result).toEqual(mockParticipant);
    });

    it('returns null when maybeSingle returns { data: null }', async () => {
      const mockMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
      const mockEq = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
      const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
      const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

      vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
        from: mockFrom,
      } as unknown as SupabaseClient);

      const result = await findByFirebaseUid('non-existent-uid');

      expect(result).toBeNull();
    });

    it('throws when Supabase query returns an error', async () => {
      const dbError = new Error('Connection refused');
      const mockMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: dbError });
      const mockEq = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
      const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
      const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

      vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
        from: mockFrom,
      } as unknown as SupabaseClient);

      await expect(participantsRepository.findByFirebaseUid('fb-uid-101')).rejects.toThrow(
        'Connection refused'
      );
    });
  });

  describe('updateVerificationStatus', () => {
    const verifiedParticipant: Participant = {
      ...mockParticipant,
      is_verified: true,
    };

    it('updates is_verified to true and returns updated participant record', async () => {
      const mockSingle = vi.fn().mockResolvedValue({ data: verifiedParticipant, error: null });
      const mockSelect = vi.fn().mockReturnValue({ single: mockSingle });
      const mockEq = vi.fn().mockReturnValue({ select: mockSelect });
      const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });
      const mockFrom = vi.fn().mockReturnValue({ update: mockUpdate });

      vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
        from: mockFrom,
      } as unknown as SupabaseClient);

      const result = await participantsRepository.updateVerificationStatus('part-uuid-101', true);

      expect(mockFrom).toHaveBeenCalledWith('participants');
      expect(mockUpdate).toHaveBeenCalledWith({ is_verified: true });
      expect(mockEq).toHaveBeenCalledWith('id', 'part-uuid-101');
      expect(mockSelect).toHaveBeenCalledWith('*');
      expect(mockSingle).toHaveBeenCalledOnce();
      expect(result).toEqual(verifiedParticipant);
    });

    it('propagates error when update query fails', async () => {
      const dbError = new Error('Lock timeout');
      const mockSingle = vi.fn().mockResolvedValue({ data: null, error: dbError });
      const mockSelect = vi.fn().mockReturnValue({ single: mockSingle });
      const mockEq = vi.fn().mockReturnValue({ select: mockSelect });
      const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });
      const mockFrom = vi.fn().mockReturnValue({ update: mockUpdate });

      vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
        from: mockFrom,
      } as unknown as SupabaseClient);

      await expect(
        updateVerificationStatus('part-uuid-101', true)
      ).rejects.toThrow('Lock timeout');
    });
  });

  describe('findById and findByEmail', () => {
    it('findById executes eq("id", id) and returns record', async () => {
      const mockMaybeSingle = vi.fn().mockResolvedValue({ data: mockParticipant, error: null });
      const mockEq = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
      const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
      const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

      vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
        from: mockFrom,
      } as unknown as SupabaseClient);

      const result = await findById('part-uuid-101');
      expect(mockEq).toHaveBeenCalledWith('id', 'part-uuid-101');
      expect(result).toEqual(mockParticipant);
    });

    it('findByEmail executes ilike("email", email) and returns record', async () => {
      const mockMaybeSingle = vi.fn().mockResolvedValue({ data: mockParticipant, error: null });
      const mockIlike = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
      const mockSelect = vi.fn().mockReturnValue({ ilike: mockIlike });
      const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

      vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
        from: mockFrom,
      } as unknown as SupabaseClient);

      const result = await findByEmail('test@example.com');
      expect(mockIlike).toHaveBeenCalledWith('email', 'test@example.com');
      expect(result).toEqual(mockParticipant);
    });
  });
});
