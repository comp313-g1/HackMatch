import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  assertInvitationIssuanceContext,
  evaluateInviteeAccount,
  evaluateInviteeAvailability,
  evaluateInviteeNotConfirmed,
  evaluateOpenSlot,
  evaluateOwnerAndTeamMutable,
} from './invitationEligibility.js';
import {
  ownerParticipant,
  otherParticipant,
  sampleTeam,
  sampleTeamId,
  sampleVacancyId,
  sampleVacancy,
  sampleParts,
} from '../routes/team.testUtils.js';

describe('invitationEligibility pure guards (US-017 / #163)', () => {
  it('rejects inactive / unverified / suspended invitees', () => {
    expect(evaluateInviteeAccount(null).code).toBe('INVITEE_NOT_ELIGIBLE');
    expect(evaluateInviteeAccount({ ...otherParticipant, is_verified: false }).code).toBe(
      'INVITEE_NOT_ELIGIBLE'
    );
    expect(evaluateInviteeAccount({ ...otherParticipant, is_suspended: true }).code).toBe(
      'INVITEE_NOT_ELIGIBLE'
    );
    expect(evaluateInviteeAccount(otherParticipant).ok).toBe(true);
  });

  it('requires Looking-for-Team availability', () => {
    expect(evaluateInviteeAvailability(false).code).toBe('INVITEE_NOT_AVAILABLE');
    expect(evaluateInviteeAvailability(undefined).code).toBe('INVITEE_NOT_AVAILABLE');
    expect(evaluateInviteeAvailability(true).ok).toBe(true);
  });

  it('rejects invitees already confirmed for the event', () => {
    expect(evaluateInviteeNotConfirmed(true).code).toBe('INVITEE_ALREADY_CONFIRMED');
    expect(evaluateInviteeNotConfirmed(false).ok).toBe(true);
  });

  it('requires an Open vacancy on the team', () => {
    expect(evaluateOpenSlot(undefined, sampleTeamId).code).toBe('VACANCY_NOT_FOUND');
    expect(evaluateOpenSlot({ ...sampleVacancy, status: 'Filled' }, sampleTeamId).code).toBe(
      'VACANCY_NOT_OPEN'
    );
    expect(evaluateOpenSlot(sampleVacancy, sampleTeamId).ok).toBe(true);
  });

  it('requires owner and mutable recruiting team', () => {
    const event = { status: 'Published' as const, end_date: '2099-01-01T00:00:00.000Z' };
    expect(
      evaluateOwnerAndTeamMutable(otherParticipant.id, sampleTeam, event).code
    ).toBe('FORBIDDEN_NOT_TEAM_OWNER');
    expect(
      evaluateOwnerAndTeamMutable(ownerParticipant.id, {
        ...sampleTeam,
        recruitment_status: 'Locked',
      }, event).code
    ).toBe('TEAM_NOT_MUTABLE');
    expect(
      evaluateOwnerAndTeamMutable(ownerParticipant.id, sampleTeam, {
        status: 'Archived',
        end_date: '2099-01-01T00:00:00.000Z',
      }).ok
    ).toBe(true);
    expect(evaluateOwnerAndTeamMutable(ownerParticipant.id, sampleTeam, event).ok).toBe(true);
  });
});

describe('assertInvitationIssuanceContext (US-017 / #163)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function passingDeps(overrides?: {
    vacancyStatus?: 'Open' | 'Filled' | 'Removed';
    recruitment_status?: 'Open' | 'Locked' | 'Disbanded';
    eventStatus?: 'Published' | 'Archived' | 'Disabled';
    isLooking?: boolean;
    invitee?: typeof otherParticipant;
    confirmedIds?: string[];
  }) {
    return {
      teamsRepo: {
        findTeamById: vi.fn(),
        getTeamViewParts: vi.fn().mockResolvedValue({
          ...sampleParts,
          team: {
            ...sampleTeam,
            recruitment_status: overrides?.recruitment_status ?? 'Open',
          },
          event: {
            max_team_size: 4,
            status: overrides?.eventStatus ?? 'Published',
            end_date: '2099-01-01T00:00:00.000Z',
          },
          vacancies: [
            {
              ...sampleVacancy,
              status: overrides?.vacancyStatus ?? 'Open',
            },
          ],
        }),
        listConfirmedParticipantIdsForTeam: vi
          .fn()
          .mockResolvedValue(overrides?.confirmedIds ?? [ownerParticipant.id]),
        listConfirmedParticipantIdsForEvent: vi
          .fn()
          .mockResolvedValue(overrides?.confirmedIds ?? [ownerParticipant.id]),
      },
      participantsRepo: {
        findById: vi.fn().mockResolvedValue(overrides?.invitee ?? otherParticipant),
      },
      availabilityRepo: {
        findByParticipantId: vi.fn().mockResolvedValue({
          participantId: otherParticipant.id,
          isLooking: overrides?.isLooking ?? true,
          desiredRole: 'Frontend',
          commitmentHours: 10,
          goal: 'Learning',
          updatedAt: null,
        }),
      },
    };
  }

  const baseInput = {
    actorParticipantId: ownerParticipant.id,
    teamId: sampleTeamId,
    vacancyId: sampleVacancyId,
    inviteeParticipantId: otherParticipant.id,
  };

  it('allows happy path when availability, team, event, and slot are valid', async () => {
    await expect(assertInvitationIssuanceContext(baseInput, passingDeps())).resolves.toBeUndefined();
  });

  it('rejects when vacancy is not Open', async () => {
    await expect(
      assertInvitationIssuanceContext(baseInput, passingDeps({ vacancyStatus: 'Filled' }))
    ).rejects.toMatchObject({ code: 'VACANCY_NOT_OPEN' });
  });

  it('rejects when team is Locked', async () => {
    await expect(
      assertInvitationIssuanceContext(baseInput, passingDeps({ recruitment_status: 'Locked' }))
    ).rejects.toMatchObject({ code: 'TEAM_NOT_MUTABLE' });
  });

  it('allows invitation issuance when event is archived as long as team is Open', async () => {
    await expect(
      assertInvitationIssuanceContext(baseInput, passingDeps({ eventStatus: 'Archived' }))
    ).resolves.toBeUndefined();
  });

  it('rejects when invitee is not Looking for Team', async () => {
    await expect(
      assertInvitationIssuanceContext(baseInput, passingDeps({ isLooking: false }))
    ).rejects.toMatchObject({ code: 'INVITEE_NOT_AVAILABLE' });
  });

  it('rejects when invitee is already confirmed for this team', async () => {
    await expect(
      assertInvitationIssuanceContext(
        baseInput,
        passingDeps({ confirmedIds: [ownerParticipant.id, otherParticipant.id] })
      )
    ).rejects.toMatchObject({ code: 'INVITEE_ALREADY_CONFIRMED' });
  });

  it('allows invitation when invitee is confirmed on a different team but looking for team platform-wide', async () => {
    const deps = passingDeps();
    deps.teamsRepo.listConfirmedParticipantIdsForTeam = vi.fn().mockResolvedValue([ownerParticipant.id]);
    await expect(assertInvitationIssuanceContext(baseInput, deps)).resolves.toBeUndefined();
  });

  it('allows invitation when invitee has platform-wide LFT enabled even if not bound to team shadow event', async () => {
    const deps = passingDeps();
    deps.availabilityRepo.findByParticipantId = vi.fn().mockResolvedValue({
      participantId: otherParticipant.id,
      isLooking: true,
      desiredRole: 'Frontend',
      commitmentHours: 10,
      goal: 'Learning',
      updatedAt: null,
    });
    await expect(assertInvitationIssuanceContext(baseInput, deps)).resolves.toBeUndefined();
  });

  it('rejects suspended invitee', async () => {
    await expect(
      assertInvitationIssuanceContext(
        baseInput,
        passingDeps({ invitee: { ...otherParticipant, is_suspended: true } })
      )
    ).rejects.toMatchObject({ code: 'INVITEE_NOT_ELIGIBLE' });
  });
});
