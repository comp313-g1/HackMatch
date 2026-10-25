import { describe, it, expect, vi } from 'vitest';
import {
  AvailabilityServiceError,
  evaluateLookingForTeamProfileCompleteness,
  listAvailableCandidates,
  updateMyPlatformAvailability,
} from './availability.service.js';
import type { Participant } from '../db/types.js';

describe('Looking for Team profile completeness (#360)', () => {
  it('flags missing handle, institution, skills, and portfolio links', () => {
    const errors = evaluateLookingForTeamProfileCompleteness({
      profile: null,
      skills: [],
      portfolios: [],
    });
    expect(errors.handle).toBeDefined();
    expect(errors.institution).toBeDefined();
    expect(errors.skills).toBeDefined();
    expect(errors.portfolioLinks).toBeDefined();
  });

  it('rejects enabling Looking for Team when the profile is incomplete', async () => {
    const upsertByParticipantId = vi.fn();
    await expect(
      updateMyPlatformAvailability(
        'p-incomplete',
        {
          isLooking: true,
          desiredRole: 'Backend',
          commitmentHours: 13,
          goal: 'Project Completion',
        },
        {
          availabilityRepo: {
            findByParticipantId: vi.fn().mockResolvedValue(null),
            upsertByParticipantId,
            findAllActiveLooking: vi.fn(),
          },
          participantsRepo: { findById: vi.fn() },
          profileRepo: {
            getFullProfile: vi.fn().mockResolvedValue({
              profile: {
                participant_id: 'p-incomplete',
                handle: null,
                institution: null,
                primary_role: 'Backend',
                shared_contact_handle: null,
                moderation_status: 'None',
                created_at: '2026-10-18T10:00:00.000Z',
                updated_at: '2026-10-18T10:00:00.000Z',
              },
              skills: [],
              portfolios: [],
            }),
          },
        }
      )
    ).rejects.toBeInstanceOf(AvailabilityServiceError);

    expect(upsertByParticipantId).not.toHaveBeenCalled();
  });

  it('allows turning Looking for Team off without a complete profile', async () => {
    const upsertByParticipantId = vi.fn().mockResolvedValue({
      participantId: 'p-incomplete',
      isLooking: false,
      desiredRole: 'Backend',
      commitmentHours: 13,
      goal: 'Project Completion',
      updatedAt: '2026-10-18T12:00:00.000Z',
    });

    await updateMyPlatformAvailability(
      'p-incomplete',
      { isLooking: false },
      {
        availabilityRepo: {
          findByParticipantId: vi.fn().mockResolvedValue({
            participantId: 'p-incomplete',
            isLooking: true,
            desiredRole: 'Backend',
            commitmentHours: 13,
            goal: 'Project Completion',
            updatedAt: '2026-10-18T11:00:00.000Z',
          }),
          upsertByParticipantId,
          findAllActiveLooking: vi.fn(),
        },
        participantsRepo: { findById: vi.fn() },
        profileRepo: {
          getFullProfile: vi.fn().mockResolvedValue({
            profile: null,
            skills: [],
            portfolios: [],
          }),
        },
      }
    );

    expect(upsertByParticipantId).toHaveBeenCalled();
  });
});

describe('listAvailableCandidates (US-026 / #244)', () => {
  const activeParticipant: Participant = {
    id: 'p-active',
    firebase_uid: 'fb-active',
    email: 'active@example.com',
    full_name: 'Active User',
    role: 'PART',
    is_verified: true,
    is_suspended: false,
    created_at: '2026-10-18T10:00:00.000Z',
    updated_at: '2026-10-18T10:00:00.000Z',
  };

  const hiddenParticipant: Participant = {
    ...activeParticipant,
    id: 'p-hidden',
    firebase_uid: 'fb-hidden',
    email: 'hidden@example.com',
    full_name: 'Hidden User',
  };

  const incompleteParticipant: Participant = {
    ...activeParticipant,
    id: 'p-incomplete',
    firebase_uid: 'fb-incomplete',
    email: 'incomplete@example.com',
    full_name: 'Sahil Gupta',
  };

  it('omits profiles with moderation_status Hidden from ordinary discovery', async () => {
    const availabilityRepo = {
      findByParticipantId: vi.fn(),
      upsertByParticipantId: vi.fn(),
      findAllActiveLooking: vi.fn().mockResolvedValue([
        {
          participantId: activeParticipant.id,
          isLooking: true,
          desiredRole: 'Frontend',
          commitmentHours: 10,
          goal: 'Learning',
          updatedAt: '2026-10-18T11:00:00.000Z',
        },
        {
          participantId: hiddenParticipant.id,
          isLooking: true,
          desiredRole: 'Backend',
          commitmentHours: 12,
          goal: 'Project Completion',
          updatedAt: '2026-10-18T11:00:00.000Z',
        },
      ]),
    };

    const participantsRepo = {
      findById: vi.fn(async (id: string) => {
        if (id === activeParticipant.id) return activeParticipant;
        if (id === hiddenParticipant.id) return hiddenParticipant;
        return null;
      }),
    };

    const profileRepo = {
      getFullProfile: vi.fn(async (participantId: string) => {
        if (participantId === hiddenParticipant.id) {
          return {
            profile: {
              participant_id: hiddenParticipant.id,
              handle: 'hidden_dev',
              institution: 'Hidden U',
              primary_role: 'Backend' as const,
              shared_contact_handle: null,
              moderation_status: 'Hidden' as const,
              created_at: '2026-10-18T10:00:00.000Z',
              updated_at: '2026-10-18T10:00:00.000Z',
            },
            skills: [
              {
                id: 's-h',
                participant_id: hiddenParticipant.id,
                skill_name: 'Go',
                created_at: '',
              },
            ],
            portfolios: [
              {
                id: 'p-h',
                participant_id: hiddenParticipant.id,
                url: 'https://example.com/hidden',
                label: 'Site',
                created_at: '',
                updated_at: '',
              },
            ],
          };
        }
        return {
          profile: {
            participant_id: activeParticipant.id,
            handle: 'active_dev',
            institution: 'Centennial College',
            primary_role: 'Frontend' as const,
            shared_contact_handle: null,
            moderation_status: 'None' as const,
            created_at: '2026-10-18T10:00:00.000Z',
            updated_at: '2026-10-18T10:00:00.000Z',
          },
          skills: [
            {
              id: 's1',
              participant_id: activeParticipant.id,
              skill_name: 'React',
              created_at: '',
            },
          ],
          portfolios: [
            {
              id: 'p1',
              participant_id: activeParticipant.id,
              url: 'https://example.com/active',
              label: 'Portfolio',
              created_at: '',
              updated_at: '',
            },
          ],
        };
      }),
    };

    const candidates = await listAvailableCandidates({
      availabilityRepo,
      participantsRepo,
      profileRepo,
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.participantId).toBe(activeParticipant.id);
    expect(candidates[0]?.handle).toBe('active_dev');
  });

  it('omits Looking for Team cards with incomplete discovery profiles (#360)', async () => {
    const candidates = await listAvailableCandidates({
      availabilityRepo: {
        findByParticipantId: vi.fn(),
        upsertByParticipantId: vi.fn(),
        findAllActiveLooking: vi.fn().mockResolvedValue([
          {
            participantId: incompleteParticipant.id,
            isLooking: true,
            desiredRole: 'Backend',
            commitmentHours: 13,
            goal: 'Project Completion',
            updatedAt: '2026-10-18T11:00:00.000Z',
          },
        ]),
      },
      participantsRepo: {
        findById: vi.fn().mockResolvedValue(incompleteParticipant),
      },
      profileRepo: {
        getFullProfile: vi.fn().mockResolvedValue({
          profile: {
            participant_id: incompleteParticipant.id,
            handle: null,
            institution: null,
            primary_role: 'Backend',
            shared_contact_handle: null,
            moderation_status: 'None',
            created_at: '2026-10-18T10:00:00.000Z',
            updated_at: '2026-10-18T10:00:00.000Z',
          },
          skills: [],
          portfolios: [],
        }),
      },
    });

    expect(candidates).toHaveLength(0);
  });
});
