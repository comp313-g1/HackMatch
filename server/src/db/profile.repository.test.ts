import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { profileRepository } from './profile.repository.js';
import * as clientModule from './client.js';
import type {
  ParticipantProfile,
  ParticipantSkill,
  ParticipantPortfolio,
} from './types.js';

describe('profileRepository unit tests (US-006 / #64)', () => {
  const mockProfile: ParticipantProfile = {
    participant_id: 'part-uuid-201',
    handle: 'alex_dev',
    primary_role: 'Backend',
    institution: 'Centennial College',
    shared_contact_handle: '@alex_discord',
    created_at: '2026-10-17T00:00:00.000Z',
    updated_at: '2026-10-17T00:00:00.000Z',
  };

  const mockSkill: ParticipantSkill = {
    id: 'skill-uuid-1',
    participant_id: 'part-uuid-201',
    skill_name: 'TypeScript',
    created_at: '2026-10-17T00:00:00.000Z',
  };

  const mockPortfolio: ParticipantPortfolio = {
    id: 'port-uuid-1',
    participant_id: 'part-uuid-201',
    url: 'https://github.com/alex_dev',
    label: 'GitHub',
    created_at: '2026-10-17T00:00:00.000Z',
    updated_at: '2026-10-17T00:00:00.000Z',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('findProfileByParticipantId returns profile record when present', async () => {
    const mockMaybeSingle = vi.fn().mockResolvedValue({ data: mockProfile, error: null });
    const mockEq = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
    const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

    vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
      from: mockFrom,
    } as unknown as SupabaseClient);

    const result = await profileRepository.findProfileByParticipantId('part-uuid-201');
    expect(mockFrom).toHaveBeenCalledWith('participant_profiles');
    expect(mockEq).toHaveBeenCalledWith('participant_id', 'part-uuid-201');
    expect(result).toEqual(mockProfile);
  });

  it('findByHandle performs case-insensitive handle lookup', async () => {
    const mockMaybeSingle = vi.fn().mockResolvedValue({ data: mockProfile, error: null });
    const mockIlike = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
    const mockSelect = vi.fn().mockReturnValue({ ilike: mockIlike });
    const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

    vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
      from: mockFrom,
    } as unknown as SupabaseClient);

    const result = await profileRepository.findByHandle('  Alex_Dev  ');
    expect(mockIlike).toHaveBeenCalledWith('handle', 'Alex_Dev');
    expect(result).toEqual(mockProfile);
  });

  it('upsertFullProfile upserts profile and replaces skills and portfolios', async () => {
    const mockProfileSingle = vi.fn().mockResolvedValue({ data: mockProfile, error: null });
    const mockProfileSelect = vi.fn().mockReturnValue({ single: mockProfileSingle });
    const mockUpsert = vi.fn().mockReturnValue({ select: mockProfileSelect });

    const mockDeleteEq = vi.fn().mockResolvedValue({ error: null });
    const mockDelete = vi.fn().mockReturnValue({ eq: mockDeleteEq });

    const mockSkillsInsertSelect = vi.fn().mockResolvedValue({ data: [mockSkill], error: null });
    const mockSkillsInsert = vi.fn().mockReturnValue({ select: mockSkillsInsertSelect });

    const mockPortfoliosInsertSelect = vi
      .fn()
      .mockResolvedValue({ data: [mockPortfolio], error: null });
    const mockPortfoliosInsert = vi.fn().mockReturnValue({ select: mockPortfoliosInsertSelect });

    const mockFrom = vi.fn((table: string) => {
      if (table === 'participant_profiles') {
        return { upsert: mockUpsert };
      }
      if (table === 'participant_skills') {
        return { delete: mockDelete, insert: mockSkillsInsert };
      }
      if (table === 'participant_portfolios') {
        return { delete: mockDelete, insert: mockPortfoliosInsert };
      }
      return {};
    });

    vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
      from: mockFrom,
    } as unknown as SupabaseClient);

    const result = await profileRepository.upsertFullProfile({
      participantId: 'part-uuid-201',
      handle: 'alex_dev',
      primaryRole: 'Backend',
      institution: 'Centennial College',
      sharedContactHandle: '@alex_discord',
      skills: ['TypeScript'],
      portfolioLinks: [{ url: 'https://github.com/alex_dev', label: 'GitHub' }],
    });

    expect(result.profile).toEqual(mockProfile);
    expect(result.skills).toEqual([mockSkill]);
    expect(result.portfolios).toEqual([mockPortfolio]);
  });

  it('areConfirmedTeammates returns true only when both users share a Confirmed team_memberships row', async () => {
    const mockMaybeSingle = vi.fn().mockResolvedValue({
      data: { team_id: 'team-1' },
      error: null,
    });
    const mockIn = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
    const mockSecondStatusEq = vi.fn().mockReturnValue({ in: mockIn });
    const mockSecondParticipantEq = vi.fn().mockReturnValue({ eq: mockSecondStatusEq });

    const mockFirstStatusEq = vi.fn().mockResolvedValue({
      data: [{ team_id: 'team-1' }],
      error: null,
    });
    const mockFirstParticipantEq = vi.fn().mockReturnValue({ eq: mockFirstStatusEq });

    let callCount = 0;
    const mockSelect = vi.fn(() => {
      callCount += 1;
      if (callCount === 1) {
        return { eq: mockFirstParticipantEq };
      }
      return { eq: mockSecondParticipantEq };
    });

    vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
      from: vi.fn().mockReturnValue({ select: mockSelect }),
    } as unknown as SupabaseClient);

    const isTeammate = await profileRepository.areConfirmedTeammates('part-1', 'part-2');
    expect(isTeammate).toBe(true);
  });
});
