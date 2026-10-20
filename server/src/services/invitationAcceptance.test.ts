import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  evaluateInvitationStillCurrent,
  evaluateInviteeIsAddressee,
  evaluateAcceptanceSlotStillOpen,
  evaluateAcceptanceTeamAndEvent,
  acceptInvitation,
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
    message: null,
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

  it('requires team still recruiting (event-free model)', () => {
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
      ).ok
    ).toBe(true);
  });
});

describe('acceptInvitation (US-019 / #180 / FR-056 / FR-083)', () => {
  const acceptedInvitation = pendingInvite({
    status: 'Accepted',
    resolved_at: '2026-10-20T12:00:00.000Z',
  });
  const membership = {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    team_id: sampleTeamId,
    event_id: sampleEventId,
    participant_id: otherParticipant.id,
    role: 'Member' as const,
    status: 'Confirmed' as const,
    removal_reason: null,
    joined_at: '2026-10-20T12:00:00.000Z',
    ended_at: null,
    created_at: '2026-10-20T12:00:00.000Z',
    updated_at: '2026-10-20T12:00:00.000Z',
  };

  it('returns the committed membership result from the atomic repository RPC', async () => {
    const acceptTeamInvitation = vi.fn().mockResolvedValue({
      accepted: true as const,
      invitation: acceptedInvitation,
      membership,
      vacancy: { ...sampleVacancy, status: 'Filled' as const },
      teamName: sampleTeam.name,
      vacancyRole: sampleVacancy.role,
      memberCount: 2,
      maxTeamSize: 4,
      availabilityCleared: true,
      membershipCommitted: true,
      cascade: {
        eventInvitationsCanceled: 0,
        eventApplicationsWithdrawn: 0,
        slotRequestsCanceled: 0,
        teamRequestsCanceled: 0,
        teamNowFull: false,
      },
      notice: 'Invitation accepted. Team membership is confirmed and the vacancy is filled.',
    });

    const result = await acceptInvitation(
      {
        actorParticipantId: otherParticipant.id,
        invitationId: acceptedInvitation.id,
      },
      { teamsRepo: { acceptTeamInvitation } }
    );

    expect(acceptTeamInvitation).toHaveBeenCalledWith(
      otherParticipant.id,
      acceptedInvitation.id
    );
    expect(result).toMatchObject({
      accepted: true,
      invitation: { status: 'Accepted' },
      membership: { status: 'Confirmed', role: 'Member' },
      vacancy: { status: 'Filled' },
      availabilityCleared: true,
    });
  });

  it('invokes availabilityRepo.clearLookingForTeamStatus to deactivate platform-wide LFT and returns availabilityCleared: true', async () => {
    const acceptTeamInvitation = vi.fn().mockResolvedValue({
      accepted: true as const,
      invitation: acceptedInvitation,
      membership,
      vacancy: { ...sampleVacancy, status: 'Filled' as const },
      teamName: sampleTeam.name,
      vacancyRole: sampleVacancy.role,
      memberCount: 2,
      maxTeamSize: 4,
      availabilityCleared: false,
      membershipCommitted: true,
      cascade: {
        eventInvitationsCanceled: 0,
        eventApplicationsWithdrawn: 0,
        slotRequestsCanceled: 0,
        teamRequestsCanceled: 0,
        teamNowFull: false,
      },
      notice: 'Invitation accepted.',
    });
    const clearLookingForTeamStatus = vi.fn().mockResolvedValue(true);

    const result = await acceptInvitation(
      {
        actorParticipantId: otherParticipant.id,
        invitationId: acceptedInvitation.id,
      },
      {
        teamsRepo: { acceptTeamInvitation },
        availabilityRepo: { clearLookingForTeamStatus },
      }
    );

    expect(clearLookingForTeamStatus).toHaveBeenCalledWith(otherParticipant.id);
    expect(result.availabilityCleared).toBe(true);
  });

  it.each([
    ['INVITATION_EXPIRED', 409],
    ['FORBIDDEN_NOT_INVITEE', 403],
    ['VACANCY_NOT_OPEN', 409],
    ['CAPACITY_EXCEEDED', 409],
    ['INVITEE_ALREADY_CONFIRMED', 409],
    ['INVITATION_ACCEPTANCE_CONFLICT', 409],
  ] as const)('maps %s from the RPC to an explicit service failure', async (code, status) => {
    const acceptTeamInvitation = vi.fn().mockRejectedValue({
      message: code,
      code: 'P0001',
      detail: JSON.stringify({ invitationId: acceptedInvitation.id }),
    });

    await expect(
      acceptInvitation(
        {
          actorParticipantId: otherParticipant.id,
          invitationId: acceptedInvitation.id,
        },
        { teamsRepo: { acceptTeamInvitation } }
      )
    ).rejects.toMatchObject({ code, status });
  });

  it.each(['40P01', '40001', '55P03'])(
    'maps PostgreSQL concurrency failure %s to a retryable acceptance conflict',
    async (databaseCode) => {
      const acceptTeamInvitation = vi.fn().mockRejectedValue({
        code: databaseCode,
        message: 'database concurrency detail that must not reach the client',
      });

      await expect(
        acceptInvitation(
          {
            actorParticipantId: otherParticipant.id,
            invitationId: acceptedInvitation.id,
          },
          { teamsRepo: { acceptTeamInvitation } }
        )
      ).rejects.toMatchObject({
        code: 'INVITATION_ACCEPTANCE_CONFLICT',
        status: 409,
        details: {
          invitationId: acceptedInvitation.id,
          reason: 'DATABASE_CONCURRENCY_RETRY',
          retryable: true,
        },
      });
    }
  );

  it('preserves unknown repository failures for the centralized safe 500 handler', async () => {
    const failure = new Error('database transport secret');
    const acceptTeamInvitation = vi.fn().mockRejectedValue(failure);

    await expect(
      acceptInvitation(
        {
          actorParticipantId: otherParticipant.id,
          invitationId: acceptedInvitation.id,
        },
        { teamsRepo: { acceptTeamInvitation } }
      )
    ).rejects.toBe(failure);
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
        listConfirmedParticipantIdsForTeam: vi
          .fn()
          .mockResolvedValue([ownerParticipant.id]),
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

  it('returns eligible when event is archived as long as team is Open', async () => {
    const deps = passingDeps();
    deps.teamsRepo.getTeamViewParts = vi.fn().mockResolvedValue({
      ...sampleParts,
      team: sampleTeam,
      event: {
        max_team_size: 4,
        status: 'Archived' as const,
        end_date: '2020-01-01T00:00:00.000Z',
      },
      vacancies: [sampleVacancy],
    });

    const result = await revalidateInvitationForAcceptance(
      {
        actorParticipantId: otherParticipant.id,
        invitationId: pendingInvite().id,
      },
      deps
    );

    expect(result.eligible).toBe(true);
  });

  it('permits an invitee who is already a confirmed member of another distinct team', async () => {
    const deps = passingDeps();
    deps.teamsRepo.listConfirmedParticipantIdsForTeam = vi.fn().mockResolvedValue([ownerParticipant.id]);

    const result = await revalidateInvitationForAcceptance(
      {
        actorParticipantId: otherParticipant.id,
        invitationId: pendingInvite().id,
      },
      deps
    );

    expect(result.eligible).toBe(true);
  });

  it('rejects an invitee already confirmed on the target team with INVITEE_ALREADY_CONFIRMED', async () => {
    const deps = passingDeps();
    deps.teamsRepo.listConfirmedParticipantIdsForTeam = vi
      .fn()
      .mockResolvedValue([ownerParticipant.id, otherParticipant.id]);

    await expect(
      revalidateInvitationForAcceptance(
        {
          actorParticipantId: otherParticipant.id,
          invitationId: pendingInvite().id,
        },
        deps
      )
    ).rejects.toMatchObject({
      code: 'INVITEE_ALREADY_CONFIRMED',
      status: 409,
    });
  });

  it('rejects when target team has reached capacity (4 confirmed members) with CAPACITY_EXCEEDED', async () => {
    const deps = passingDeps();
    deps.teamsRepo.listConfirmedParticipantIdsForTeam = vi
      .fn()
      .mockResolvedValue(['p-1', 'p-2', 'p-3', 'p-4']);

    await expect(
      revalidateInvitationForAcceptance(
        {
          actorParticipantId: otherParticipant.id,
          invitationId: pendingInvite().id,
        },
        deps
      )
    ).rejects.toMatchObject({
      code: 'CAPACITY_EXCEEDED',
      status: 409,
    });
  });
});
