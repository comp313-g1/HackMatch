import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  evaluateInvitationStillCurrent,
  evaluateInviteeIsAddressee,
  evaluateAcceptanceSlotStillOpen,
  evaluateAcceptanceTeamAndEvent,
  revalidateInvitationForAcceptance,
} from './invitationAcceptance.js';
import {
  ownerParticipant,
  otherParticipant,
  sampleEventId,
  sampleParts,
  sampleTeam,
  sampleTeamId,
  sampleVacancy,
  sampleVacancyId,
} from '../routes/team.testUtils.js';
import type { TeamRequest } from '../db/types.js';

function pendingInvite(overrides: Partial<TeamRequest> = {}): TeamRequest {
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
    created_at: '2026-10-19T12:00:00.000Z',
    updated_at: '2026-10-19T12:00:00.000Z',
    ...overrides,
  };
}

describe('invitationAcceptance pure guards (US-017 / #165 / FR-051)', () => {
  const now = new Date('2026-10-20T12:00:00.000Z');

  it('rejects clock-expired Pending invitations even before cleanup', () => {
    expect(
      evaluateInvitationStillCurrent(
        pendingInvite({ expires_at: '2026-10-19T12:00:00.000Z' }),
        now
      ).code
    ).toBe('INVITATION_EXPIRED');
  });

  it('rejects already Expired status', () => {
    expect(
      evaluateInvitationStillCurrent(pendingInvite({ status: 'Expired' }), now).code
    ).toBe('INVITATION_EXPIRED');
  });

  it('rejects terminal non-Pending statuses', () => {
    expect(
      evaluateInvitationStillCurrent(
        pendingInvite({ status: 'Canceled', expires_at: '2026-10-21T12:00:00.000Z' }),
        now
      ).code
    ).toBe('INVITATION_NOT_ACCEPTABLE');
  });

  it('allows current Pending invitations inside the 48-hour window', () => {
    expect(evaluateInvitationStillCurrent(pendingInvite(), now).ok).toBe(true);
  });

  it('requires the actor to be the invitee', () => {
    expect(
      evaluateInviteeIsAddressee(ownerParticipant.id, pendingInvite()).code
    ).toBe('FORBIDDEN_NOT_INVITEE');
    expect(evaluateInviteeIsAddressee(otherParticipant.id, pendingInvite()).ok).toBe(true);
  });

  it('requires the vacancy to still be Open (US-017-T6)', () => {
    expect(
      evaluateAcceptanceSlotStillOpen(
        { ...sampleVacancy, status: 'Filled' },
        sampleTeamId
      ).code
    ).toBe('VACANCY_NOT_OPEN');
  });

  it('requires team/event still recruiting', () => {
    expect(
      evaluateAcceptanceTeamAndEvent(
        { recruitment_status: 'Locked' },
        { status: 'Published', end_date: '2099-01-01T00:00:00.000Z' },
        now
      ).code
    ).toBe('TEAM_NOT_MUTABLE');
    expect(
      evaluateAcceptanceTeamAndEvent(
        { recruitment_status: 'Open' },
        { status: 'Archived', end_date: '2099-01-01T00:00:00.000Z' },
        now
      ).code
    ).toBe('EVENT_NOT_RECRUITING');
  });
});

describe('revalidateInvitationForAcceptance (US-017 / #165)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function passingDeps(invite: TeamRequest = pendingInvite()) {
    return {
      teamsRepo: {
        findInvitationById: vi.fn().mockResolvedValue(invite),
        markInvitationExpiredIfDue: vi.fn().mockResolvedValue({
          invitation: { ...invite, status: 'Expired' as const },
          changed: true,
        }),
        getTeamViewParts: vi.fn().mockResolvedValue({
          ...sampleParts,
          team: sampleTeam,
          event: {
            max_team_size: 4,
            status: 'Published' as const,
            end_date: '2099-01-01T00:00:00.000Z',
          },
          vacancies: [sampleVacancy],
        }),
        listConfirmedParticipantIdsForEvent: vi
          .fn()
          .mockResolvedValue([ownerParticipant.id]),
      },
      participantsRepo: {
        findById: vi.fn().mockResolvedValue(otherParticipant),
      },
      now: () => new Date('2026-10-20T12:00:00.000Z'),
    };
  }

  it('returns eligible when invitation is current and context is still recruiting (happy path)', async () => {
    const result = await revalidateInvitationForAcceptance(
      {
        actorParticipantId: otherParticipant.id,
        invitationId: pendingInvite().id,
      },
      passingDeps()
    );

    expect(result.eligible).toBe(true);
    expect(result.expiresAt).toBe('2026-10-21T12:00:00.000Z');
    expect(result.notice).toMatch(/48-hour/i);
  });

  it('marks due invitations Expired and rejects acceptance (US-017-T3 / FR-051)', async () => {
    const expiredPending = pendingInvite({ expires_at: '2026-10-19T00:00:00.000Z' });
    const deps = passingDeps(expiredPending);

    await expect(
      revalidateInvitationForAcceptance(
        {
          actorParticipantId: otherParticipant.id,
          invitationId: expiredPending.id,
        },
        deps
      )
    ).rejects.toMatchObject({ code: 'INVITATION_EXPIRED', status: 409 });

    expect(deps.teamsRepo.markInvitationExpiredIfDue).toHaveBeenCalledWith(expiredPending.id);
  });

  it('rejects when the open slot has already been filled (US-017-T6)', async () => {
    const deps = passingDeps();
    deps.teamsRepo.getTeamViewParts.mockResolvedValue({
      ...sampleParts,
      team: sampleTeam,
      event: {
        max_team_size: 4,
        status: 'Published' as const,
        end_date: '2099-01-01T00:00:00.000Z',
      },
      vacancies: [{ ...sampleVacancy, status: 'Filled' }],
    });

    await expect(
      revalidateInvitationForAcceptance(
        {
          actorParticipantId: otherParticipant.id,
          invitationId: pendingInvite().id,
        },
        deps
      )
    ).rejects.toMatchObject({ code: 'VACANCY_NOT_OPEN' });
  });

  it('rejects non-invitee actors', async () => {
    await expect(
      revalidateInvitationForAcceptance(
        {
          actorParticipantId: ownerParticipant.id,
          invitationId: pendingInvite().id,
        },
        passingDeps()
      )
    ).rejects.toMatchObject({ code: 'FORBIDDEN_NOT_INVITEE', status: 403 });
  });
});
