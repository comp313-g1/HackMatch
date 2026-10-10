import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { providerIdentitiesRepository } from './provider_identities.repository.js';
import { participantsRepository } from './participants.repository.js';
import * as clientModule from './client.js';
import type { Participant, ProviderIdentity, OAuthProvider } from './types.js';

describe('providerIdentitiesRepository', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('createProviderIdentity validation and security', () => {
    it('throws when participant_id is missing', async () => {
      await expect(
        providerIdentitiesRepository.createProviderIdentity({
          participant_id: '',
          provider: 'google',
          provider_uid: 'g-123',
          email: 'user@example.com',
        })
      ).rejects.toThrow('participant_id is required');
    });

    it('throws when provider is invalid', async () => {
      await expect(
        providerIdentitiesRepository.createProviderIdentity({
          participant_id: 'part-uuid-1',
          provider: 'unsupported' as unknown as OAuthProvider,
          provider_uid: 'u-123',
          email: 'user@example.com',
        })
      ).rejects.toThrow(/Invalid provider 'unsupported'/);
    });

    it('throws when provider_uid is missing or blank', async () => {
      await expect(
        providerIdentitiesRepository.createProviderIdentity({
          participant_id: 'part-uuid-1',
          provider: 'github',
          provider_uid: '   ',
          email: 'user@example.com',
        })
      ).rejects.toThrow('provider_uid is required');
    });

    it('throws when email is missing or blank', async () => {
      await expect(
        providerIdentitiesRepository.createProviderIdentity({
          participant_id: 'part-uuid-1',
          provider: 'github',
          provider_uid: 'gh-123',
          email: '',
        })
      ).rejects.toThrow('email is required');
    });

    it('throws when participant does not exist', async () => {
      vi.spyOn(participantsRepository, 'findById').mockResolvedValue(null);

      await expect(
        providerIdentitiesRepository.createProviderIdentity({
          participant_id: 'non-existent-id',
          provider: 'google',
          provider_uid: 'g-123',
          email: 'user@example.com',
        })
      ).rejects.toThrow("Participant with ID 'non-existent-id' not found");
    });

    it('enforces US-002 AC4: throws when attempting to link to an ADMIN account', async () => {
      const adminParticipant: Participant = {
        id: 'admin-uuid-1',
        firebase_uid: 'fb-admin',
        email: 'admin@platform.com',
        full_name: 'Admin User',
        role: 'ADMIN',
        is_verified: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      vi.spyOn(participantsRepository, 'findById').mockResolvedValue(adminParticipant);

      await expect(
        providerIdentitiesRepository.createProviderIdentity({
          participant_id: 'admin-uuid-1',
          provider: 'google',
          provider_uid: 'g-123',
          email: 'admin@platform.com',
        })
      ).rejects.toThrow('Public OAuth cannot link to an ADMIN account');
    });
  });

  describe('successful repository operations with mock client', () => {
    const mockParticipant: Participant = {
      id: 'part-uuid-1',
      firebase_uid: 'fb-part-1',
      email: 'part@example.com',
      full_name: 'Regular Participant',
      role: 'PART',
      is_verified: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const mockIdentity: ProviderIdentity = {
      id: 'ident-uuid-1',
      participant_id: 'part-uuid-1',
      provider: 'google',
      provider_uid: 'g-sub-999',
      email: 'part@example.com',
      provider_handle: 'google_user',
      avatar_url: 'https://example.com/photo.jpg',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    it('creates provider identity for valid PART participant', async () => {
      vi.spyOn(participantsRepository, 'findById').mockResolvedValue(mockParticipant);

      const mockSingle = vi.fn().mockResolvedValue({ data: mockIdentity, error: null });
      const mockSelect = vi.fn().mockReturnValue({ single: mockSingle });
      const mockInsert = vi.fn().mockReturnValue({ select: mockSelect });
      const mockFrom = vi.fn().mockReturnValue({ insert: mockInsert });

      vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
        from: mockFrom,
      } as unknown as SupabaseClient);

      const result = await providerIdentitiesRepository.createProviderIdentity({
        participant_id: 'part-uuid-1',
        provider: 'google',
        provider_uid: 'g-sub-999',
        email: 'part@example.com',
        provider_handle: 'google_user',
        avatar_url: 'https://example.com/photo.jpg',
      });

      expect(result).toEqual(mockIdentity);
      expect(mockFrom).toHaveBeenCalledWith('provider_identities');
      expect(mockInsert).toHaveBeenCalledWith({
        participant_id: 'part-uuid-1',
        provider: 'google',
        provider_uid: 'g-sub-999',
        email: 'part@example.com',
        provider_handle: 'google_user',
        avatar_url: 'https://example.com/photo.jpg',
      });
    });

    it('finds provider identity by provider and provider_uid', async () => {
      const mockMaybeSingle = vi.fn().mockResolvedValue({ data: mockIdentity, error: null });
      const mockEq2 = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
      const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 });
      const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 });
      const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

      vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
        from: mockFrom,
      } as unknown as SupabaseClient);

      const result = await providerIdentitiesRepository.findByProviderUid('google', 'g-sub-999');

      expect(result).toEqual(mockIdentity);
      expect(mockFrom).toHaveBeenCalledWith('provider_identities');
      expect(mockSelect).toHaveBeenCalledWith('*');
      expect(mockEq1).toHaveBeenCalledWith('provider', 'google');
      expect(mockEq2).toHaveBeenCalledWith('provider_uid', 'g-sub-999');
    });

    it('finds provider identities by participant_id', async () => {
      const mockEq = vi.fn().mockResolvedValue({ data: [mockIdentity], error: null });
      const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
      const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

      vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
        from: mockFrom,
      } as unknown as SupabaseClient);

      const results = await providerIdentitiesRepository.findByParticipantId('part-uuid-1');

      expect(results).toEqual([mockIdentity]);
      expect(mockFrom).toHaveBeenCalledWith('provider_identities');
      expect(mockEq).toHaveBeenCalledWith('participant_id', 'part-uuid-1');
    });

    it('deletes provider identity successfully', async () => {
      const mockEq2 = vi.fn().mockResolvedValue({ error: null });
      const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 });
      const mockDelete = vi.fn().mockReturnValue({ eq: mockEq1 });
      const mockFrom = vi.fn().mockReturnValue({ delete: mockDelete });

      vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
        from: mockFrom,
      } as unknown as SupabaseClient);

      const success = await providerIdentitiesRepository.deleteProviderIdentity('part-uuid-1', 'google');

      expect(success).toBe(true);
      expect(mockFrom).toHaveBeenCalledWith('provider_identities');
      expect(mockDelete).toHaveBeenCalled();
      expect(mockEq1).toHaveBeenCalledWith('participant_id', 'part-uuid-1');
      expect(mockEq2).toHaveBeenCalledWith('provider', 'google');
    });

    it('throws error when database query fails during insert', async () => {
      vi.spyOn(participantsRepository, 'findById').mockResolvedValue(mockParticipant);

      const dbError = new Error('Database constraint error');
      const mockSingle = vi.fn().mockResolvedValue({ data: null, error: dbError });
      const mockSelect = vi.fn().mockReturnValue({ single: mockSingle });
      const mockInsert = vi.fn().mockReturnValue({ select: mockSelect });
      const mockFrom = vi.fn().mockReturnValue({ insert: mockInsert });

      vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
        from: mockFrom,
      } as unknown as SupabaseClient);

      await expect(
        providerIdentitiesRepository.createProviderIdentity({
          participant_id: 'part-uuid-1',
          provider: 'google',
          provider_uid: 'g-sub-999',
          email: 'part@example.com',
        })
      ).rejects.toThrow('Database constraint error');
    });
  });
});
