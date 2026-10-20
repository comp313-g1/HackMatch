import { describe, it, expect, vi, beforeEach } from 'vitest';
import { submitApplication } from './applications.js';
import { teamsRepository } from '../db/teams.repository.js';
import {
  otherParticipant,
  ownerParticipant,
  sampleEventId,
  sampleParts,
  sampleTeam,
  sampleTeamId,
  sampleVacancy,
  sampleVacancyId,
} from '../routes/team.testUtils.js';

function passingEligibility(overrides?: {
  vacancyStatus?: 'Open' | 'Filled' | 'Removed';
  recruitment_status?: 'Open' | 'Locked' | 'Disbanded';
  confirmedIds?: string[];
  applicant?: typeof otherParticipant;
}) {
  return {
    teamsRepo: {
      findTeamById: vi.fn().mockResolvedValue(sampleTeam),
      getTeamViewParts: vi.fn().mockResolvedValue({
        ...sampleParts,
        team: {
          ...sampleTeam,
          recruitment_status: overrides?.recruitment_status ?? 'Open',
        },
        event: {
          max_team_size: 4,
          status: 'Published' as const,
          end_date: '2099-01-01T00:00:00.000Z',
        },
        vacancies: [{ ...sampleVacancy, status: overrides?.vacancyStatus ?? 'Open' }],
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

function passingQuotas(pendingCount = 0) {
  return {
    teamsRepo: {
      findTeamById: vi.fn().mockResolvedValue(sampleTeam),
      countPendingApplicationsForEvent: vi.fn().mockResolvedValue(pendingCount),
    },
  };
}

describe('submitApplication (US-018 / #172 / #173 / #174)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('maps RPC success to Pending Review application view (happy path)', async () => {
    const rpcSpy = vi.spyOn(teamsRepository, 'submitTeamApplication').mockResolvedValue({
      application: {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        team_id: sampleTeamId,
        event_id: sampleEventId,
        vacancy_id: sampleVacancyId,
        participant_id: otherParticipant.id,
        request_type: 'Application',
        status: 'Pending',
        cancel_reason: null,
        resolved_at: null,
        expires_at: null,
        message: 'Interested in Frontend',
        created_at: '2026-10-19T15:00:00.000Z',
        updated_at: '2026-10-19T15:00:00.000Z',
      },
      vacancyRole: 'Frontend',
      teamName: 'HackMatch Innovators',
      pendingCountForEvent: 1,
      notice: 'Pending Review application created. The team owner has been notified.',
    });

    const view = await submitApplication(
      {
        actorParticipantId: otherParticipant.id,
        teamId: sampleTeamId,
        vacancyId: sampleVacancyId,
        message: 'Interested in Frontend',
      },
      { eligibility: passingEligibility(), quotas: passingQuotas(1) }
    );

    expect(view).toMatchObject({
      status: 'Pending',
      requestType: 'Application',
      vacancyId: sampleVacancyId,
      applicantParticipantId: otherParticipant.id,
      message: 'Interested in Frontend',
      pendingCountForEvent: 1,
    });
    expect(rpcSpy).toHaveBeenCalledWith(
      otherParticipant.id,
      sampleTeamId,
      sampleVacancyId,
      'Interested in Frontend'
    );
  });

  it('blocks filled vacancy in Express preflight before RPC (#173)', async () => {
    const rpcSpy = vi.spyOn(teamsRepository, 'submitTeamApplication');

    await expect(
      submitApplication(
        {
          actorParticipantId: otherParticipant.id,
          teamId: sampleTeamId,
          vacancyId: sampleVacancyId,
          message: null,
        },
        { eligibility: passingEligibility({ vacancyStatus: 'Filled' }), quotas: passingQuotas() }
      )
    ).rejects.toMatchObject({ code: 'VACANCY_NOT_OPEN', status: 409 });
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('blocks locked team in Express preflight before RPC (#173)', async () => {
    const rpcSpy = vi.spyOn(teamsRepository, 'submitTeamApplication');

    await expect(
      submitApplication(
        {
          actorParticipantId: otherParticipant.id,
          teamId: sampleTeamId,
          vacancyId: sampleVacancyId,
          message: null,
        },
        {
          eligibility: passingEligibility({ recruitment_status: 'Locked' }),
          quotas: passingQuotas(),
        }
      )
    ).rejects.toMatchObject({ code: 'TEAM_NOT_MUTABLE', status: 409 });
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('blocks confirmed event member in Express preflight (#173 / T6)', async () => {
    const rpcSpy = vi.spyOn(teamsRepository, 'submitTeamApplication');

    await expect(
      submitApplication(
        {
          actorParticipantId: otherParticipant.id,
          teamId: sampleTeamId,
          vacancyId: sampleVacancyId,
          message: null,
        },
        {
          eligibility: passingEligibility({
            confirmedIds: [ownerParticipant.id, otherParticipant.id],
          }),
          quotas: passingQuotas(),
        }
      )
    ).rejects.toMatchObject({ code: 'APPLICANT_ALREADY_CONFIRMED', status: 409 });
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('blocks 4th Pending application in Express quota preflight before RPC (#174 / T4)', async () => {
    const rpcSpy = vi.spyOn(teamsRepository, 'submitTeamApplication');

    await expect(
      submitApplication(
        {
          actorParticipantId: otherParticipant.id,
          teamId: sampleTeamId,
          vacancyId: sampleVacancyId,
          message: null,
        },
        { eligibility: passingEligibility(), quotas: passingQuotas(3) }
      )
    ).rejects.toMatchObject({
      code: 'APPLICATION_PENDING_LIMIT',
      status: 409,
      details: expect.objectContaining({ limit: 3, pendingCount: 3 }),
    });
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('maps APPLICATION_PENDING_LIMIT from Postgres exception after preflight passes', async () => {
    vi.spyOn(teamsRepository, 'submitTeamApplication').mockRejectedValue({
      message: 'APPLICATION_PENDING_LIMIT',
      code: 'P0001',
      detail: JSON.stringify({ limit: 3, pendingCount: 3 }),
    });

    await expect(
      submitApplication(
        {
          actorParticipantId: otherParticipant.id,
          teamId: sampleTeamId,
          vacancyId: sampleVacancyId,
          message: null,
        },
        { eligibility: passingEligibility(), quotas: passingQuotas(2) }
      )
    ).rejects.toMatchObject({
      code: 'APPLICATION_PENDING_LIMIT',
      status: 409,
    });
  });

  it('maps DUPLICATE_PENDING_APPLICATION unique violation', async () => {
    vi.spyOn(teamsRepository, 'submitTeamApplication').mockRejectedValue({
      message: 'duplicate key value violates unique constraint',
      code: '23505',
      details:
        'Key (team_id, participant_id)=(...) already exists. uq_team_requests_pending_application',
    });

    await expect(
      submitApplication(
        {
          actorParticipantId: otherParticipant.id,
          teamId: sampleTeamId,
          vacancyId: sampleVacancyId,
          message: null,
        },
        { eligibility: passingEligibility(), quotas: passingQuotas(0) }
      )
    ).rejects.toMatchObject({
      code: 'DUPLICATE_PENDING_APPLICATION',
      status: 409,
    });
  });

  it('rejects owner applying via preflight CANNOT_APPLY_TO_OWN_TEAM (#173)', async () => {
    const rpcSpy = vi.spyOn(teamsRepository, 'submitTeamApplication');

    await expect(
      submitApplication(
        {
          actorParticipantId: ownerParticipant.id,
          teamId: sampleTeamId,
          vacancyId: sampleVacancyId,
          message: null,
        },
        {
          eligibility: passingEligibility({ applicant: ownerParticipant }),
          quotas: passingQuotas(),
        }
      )
    ).rejects.toMatchObject({
      code: 'CANNOT_APPLY_TO_OWN_TEAM',
      status: 400,
    });
    expect(rpcSpy).not.toHaveBeenCalled();
  });
});