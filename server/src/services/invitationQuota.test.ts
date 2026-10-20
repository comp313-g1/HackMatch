import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  assertInvitationQuotas,
  evaluateInviteeTeamQuota,
  evaluateSlotQuota,
} from './invitationQuota.js';
import {
  otherParticipant,
  sampleEventId,
  sampleTeamId,
  sampleVacancyId,
} from '../routes/team.testUtils.js';
import type { TeamRequest } from '../db/types.js';

function pendingRow(overrides: Partial<TeamRequest> = {}): TeamRequest {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    team_id: sampleTeamId,
    event_id: sampleEventId,
    vacancy_id: sampleVacancyId,
    participant_id: otherParticipant.id,
    request_type: 'Invitation',
    status: 'Pending',
    cancel_reason: null,
    resolved_at: null,
    expires_at: '2026-10-21T12:00:00.000Z',
    message: null,
    created_at: '2026-10-19T12:00:00.000Z',
    updated_at: '2026-10-19T12:00:00.000Z',
    ...overrides,
  };
}

describe('invitationQuota pure guards (US-017 / #164 / FR-050)', () => {
  it('rejects a second pending invite for the same invitee on the team', () => {
    expect(evaluateInviteeTeamQuota(pendingRow()).code).toBe('DUPLICATE_PENDING_INVITATION');
    expect(evaluateInviteeTeamQuota(null).ok).toBe(true);
  });

  it('rejects a second pending invite for the same vacancy slot', () => {
    expect(evaluateSlotQuota(pendingRow()).code).toBe('SLOT_PENDING_INVITATION_EXISTS');
    expect(evaluateSlotQuota(undefined).ok).toBe(true);
  });
});

describe('assertInvitationQuotas (US-017 / #164)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const baseInput = {
    teamId: sampleTeamId,
    vacancyId: sampleVacancyId,
    inviteeParticipantId: otherParticipant.id,
  };

  it('allows issuance when neither invitee nor slot has a Pending invite', async () => {
    await expect(
      assertInvitationQuotas(baseInput, {
        teamsRepo: {
          findPendingInvitationConflicts: vi.fn().mockResolvedValue({
            byInvitee: null,
            bySlot: null,
          }),
        },
      })
    ).resolves.toBeUndefined();
  });

  it('blocks duplicate invitee/team pending invitation', async () => {
    await expect(
      assertInvitationQuotas(baseInput, {
        teamsRepo: {
          findPendingInvitationConflicts: vi.fn().mockResolvedValue({
            byInvitee: pendingRow(),
            bySlot: null,
          }),
        },
      })
    ).rejects.toMatchObject({ code: 'DUPLICATE_PENDING_INVITATION', status: 409 });
  });

  it('blocks when the open slot already has a Pending invitation', async () => {
    await expect(
      assertInvitationQuotas(baseInput, {
        teamsRepo: {
          findPendingInvitationConflicts: vi.fn().mockResolvedValue({
            byInvitee: null,
            bySlot: pendingRow({
              participant_id: '99999999-9999-4999-8999-999999999999',
            }),
          }),
        },
      })
    ).rejects.toMatchObject({ code: 'SLOT_PENDING_INVITATION_EXISTS', status: 409 });
  });
});
