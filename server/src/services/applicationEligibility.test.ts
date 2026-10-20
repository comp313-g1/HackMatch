import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  assertApplicationSubmissionContext,
  evaluateApplicantAccount,
  evaluateApplicantNotConfirmed,
  evaluateApplicantNotOwner,
  evaluateApplicationOpenSlot,
  evaluateTeamUnlockedAndRecruiting,
} from './applicationEligibility.js';
import {
  ownerParticipant,
  otherParticipant,
  sampleTeam,
  sampleTeamId,
  sampleVacancyId,
  sampleVacancy,
  sampleParts,
} from '../routes/team.testUtils.js';

describe('applicationEligibility pure guards (US-018 / #173)', () => {
  it('rejects inactive / unverified / suspended applicants (US-018-T6)', () => {
    expect(evaluateApplicantAccount(null).code).toBe('APPLICANT_NOT_ELIGIBLE');
    expect(evaluateApplicantAccount({ ...otherParticipant, is_verified: false }).code).toBe(
      'APPLICANT_NOT_ELIGIBLE'
    );
    expect(evaluateApplicantAccount({ ...otherParticipant, is_suspended: true }).code).toBe(
      'APPLICANT_NOT_ELIGIBLE'
    );
    expect(evaluateApplicantAccount({ ...otherParticipant, role: 'ADMIN' }).code).toBe(
      'APPLICANT_NOT_ELIGIBLE'
    );
    expect(evaluateApplicantAccount(otherParticipant).ok).toBe(true);
  });

  it('rejects applicants already confirmed for the event (one-team rule)', () => {
    expect(evaluateApplicantNotConfirmed(true).code).toBe('APPLICANT_ALREADY_CONFIRMED');
    expect(evaluateApplicantNotConfirmed(false).ok).toBe(true);
  });

  it('rejects applying to own team', () => {
    expect(
      evaluateApplicantNotOwner(ownerParticipant.id, ownerParticipant.id).code
    ).toBe('CANNOT_APPLY_TO_OWN_TEAM');
    expect(evaluateApplicantNotOwner(otherParticipant.id, ownerParticipant.id).ok).toBe(true);
  });

  it('requires an Open vacancy on the team', () => {
    expect(evaluateApplicationOpenSlot(undefined, sampleTeamId).code).toBe('VACANCY_NOT_FOUND');
    expect(
      evaluateApplicationOpenSlot({ ...sampleVacancy, status: 'Filled' }, sampleTeamId).code
    ).toBe('VACANCY_NOT_OPEN');
    expect(evaluateApplicationOpenSlot(sampleVacancy, sampleTeamId).ok).toBe(true);
  });

  it('requires unlocked recruiting team/event', () => {
    const event = { status: 'Published' as const, end_date: '2099-01-01T00:00:00.000Z' };
    expect(evaluateTeamUnlockedAndRecruiting(null, event).code).toBe('TEAM_NOT_FOUND');
    expect(
      evaluateTeamUnlockedAndRecruiting(
        { ...sampleTeam, recruitment_status: 'Locked' },
        event
      ).code
    ).toBe('TEAM_NOT_MUTABLE');
    expect(
      evaluateTeamUnlockedAndRecruiting(sampleTeam, {
        status: 'Archived',
        end_date: '2099-01-01T00:00:00.000Z',
      }).code
    ).toBe('EVENT_NOT_RECRUITING');
    expect(evaluateTeamUnlockedAndRecruiting(sampleTeam, event).ok).toBe(true);
  });
});

describe('assertApplicationSubmissionContext (US-018 / #173)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function passingDeps(overrides?: {
    vacancyStatus?: 'Open' | 'Filled' | 'Removed';
    recruitment_status?: 'Open' | 'Locked' | 'Disbanded';
    eventStatus?: 'Published' | 'Archived' | 'Disabled';
    applicant?: typeof otherParticipant;
    confirmedIds?: string[];
    teamMissing?: boolean;
  }) {
    return {
      teamsRepo: {
        findTeamById: vi.fn().mockResolvedValue(
          overrides?.teamMissing ? null : sampleTeam
        ),
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
        listConfirmedParticipantIdsForEvent: vi
          .fn()
          .mockResolvedValue(overrides?.confirmedIds ?? [ownerParticipant.id]),
      },
      participantsRepo: {
        findById: vi.fn().mockResolvedValue(overrides?.applicant ?? otherParticipant),
      },
    };
  }

  it('passes when verified PART applies to open unlocked slot', async () => {
    await expect(
      assertApplicationSubmissionContext(
        {
          actorParticipantId: otherParticipant.id,
          teamId: sampleTeamId,
          vacancyId: sampleVacancyId,
        },
        passingDeps()
      )
    ).resolves.toBeUndefined();
  });

  it('rejects locked team before RPC', async () => {
    await expect(
      assertApplicationSubmissionContext(
        {
          actorParticipantId: otherParticipant.id,
          teamId: sampleTeamId,
          vacancyId: sampleVacancyId,
        },
        passingDeps({ recruitment_status: 'Locked' })
      )
    ).rejects.toMatchObject({ code: 'TEAM_NOT_MUTABLE', status: 409 });
  });

  it('rejects filled vacancy before RPC', async () => {
    await expect(
      assertApplicationSubmissionContext(
        {
          actorParticipantId: otherParticipant.id,
          teamId: sampleTeamId,
          vacancyId: sampleVacancyId,
        },
        passingDeps({ vacancyStatus: 'Filled' })
      )
    ).rejects.toMatchObject({ code: 'VACANCY_NOT_OPEN', status: 409 });
  });

  it('rejects confirmed event member (US-018-T6)', async () => {
    await expect(
      assertApplicationSubmissionContext(
        {
          actorParticipantId: otherParticipant.id,
          teamId: sampleTeamId,
          vacancyId: sampleVacancyId,
        },
        passingDeps({ confirmedIds: [ownerParticipant.id, otherParticipant.id] })
      )
    ).rejects.toMatchObject({ code: 'APPLICANT_ALREADY_CONFIRMED', status: 409 });
  });

  it('rejects unverified applicant before RPC (US-018-T6)', async () => {
    await expect(
      assertApplicationSubmissionContext(
        {
          actorParticipantId: otherParticipant.id,
          teamId: sampleTeamId,
          vacancyId: sampleVacancyId,
        },
        passingDeps({ applicant: { ...otherParticipant, is_verified: false } })
      )
    ).rejects.toMatchObject({ code: 'APPLICANT_NOT_ELIGIBLE', status: 403 });
  });

  it('rejects owner applying to own team', async () => {
    await expect(
      assertApplicationSubmissionContext(
        {
          actorParticipantId: ownerParticipant.id,
          teamId: sampleTeamId,
          vacancyId: sampleVacancyId,
        },
        {
          ...passingDeps({ applicant: ownerParticipant }),
          teamsRepo: {
            ...passingDeps().teamsRepo,
            findTeamById: vi.fn().mockResolvedValue(sampleTeam),
          },
        }
      )
    ).rejects.toMatchObject({ code: 'CANNOT_APPLY_TO_OWN_TEAM', status: 400 });
  });
});
