import { describe, it, expect, vi } from 'vitest';
import { listAvailableCandidates } from './availability.service.js';
import type { Participant } from '../db/types.js';

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
              institution: null,
              primary_role: 'Backend' as const,
              shared_contact_handle: null,
              moderation_status: 'Hidden' as const,
              created_at: '2026-10-18T10:00:00.000Z',
              updated_at: '2026-10-18T10:00:00.000Z',
            },
            skills: [],
            portfolios: [],
          };
        }
        return {
          profile: {
            participant_id: activeParticipant.id,
            handle: 'active_dev',
            institution: null,
            primary_role: 'Frontend' as const,
            shared_contact_handle: null,
            moderation_status: 'None' as const,
            created_at: '2026-10-18T10:00:00.000Z',
            updated_at: '2026-10-18T10:00:00.000Z',
          },
          skills: [],
          portfolios: [],
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
});
