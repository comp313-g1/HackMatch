import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  applicationStatusLabel,
  listMyApplications,
  submitApplication,
  withdrawApplication,
} from './applications.js';
import { teamsRepository } from '../db/teams.repository.js';
import type { TeamRequest } from '../db/types.js';
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

function passingQuotas(
  pendingCount = 0,
  duplicate: Pick<TeamRequest, 'id'> | null = null
) {
  return {
    teamsRepo: {
      findTeamById: vi.fn().mockResolvedValue(sampleTeam),
      findPendingApplicationForTeam: vi.fn().mockResolvedValue(duplicate),
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

  it('returns duplicate error before the pending limit when both conditions apply (#176)', async () => {
    const rpcSpy = vi.spyOn(teamsRepository, 'submitTeamApplication');
    const duplicate = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    };

    await expect(
      submitApplication(
        {
          actorParticipantId: otherParticipant.id,
          teamId: sampleTeamId,
          vacancyId: sampleVacancyId,
          message: null,
        },
        { eligibility: passingEligibility(), quotas: passingQuotas(3, duplicate) }
      )
    ).rejects.toMatchObject({
      code: 'DUPLICATE_PENDING_APPLICATION',
      status: 409,
      details: expect.objectContaining({
        teamId: sampleTeamId,
        existingApplicationId: duplicate.id,
      }),
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
describe('listMyApplications / withdrawApplication (US-018 / #175 / FR-055)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('maps Pending to Pending Review status label', () => {
    expect(applicationStatusLabel('Pending')).toBe('Pending Review');
    expect(applicationStatusLabel('Withdrawn')).toBe('Withdrawn');
  });

  it('lists applicant applications with withdrawable flags (status inspect)', async () => {
    vi.spyOn(teamsRepository, 'listMyApplications').mockResolvedValue([
      {
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
          message: 'Interested',
          created_at: '2026-10-19T12:00:00.000Z',
          updated_at: '2026-10-19T12:00:00.000Z',
        },
        vacancyRole: 'Frontend',
        teamName: 'HackMatch Innovators',
      },
    ]);

    const result = await listMyApplications(otherParticipant.id);

    expect(result.empty).toBe(false);
    expect(result.applications[0]).toMatchObject({
      status: 'Pending',
      statusLabel: 'Pending Review',
      withdrawable: true,
      teamName: 'HackMatch Innovators',
      vacancyRole: 'Frontend',
    });
  });

  it('returns empty guidance when the applicant has no applications', async () => {
    vi.spyOn(teamsRepository, 'listMyApplications').mockResolvedValue([]);

    const result = await listMyApplications(otherParticipant.id);

    expect(result.empty).toBe(true);
    expect(result.message).toMatch(/No applications yet/i);
  });

  it('withdraws Pending application and returns owner/applicant alerts (US-018-T5)', async () => {
    vi.spyOn(teamsRepository, 'withdrawTeamApplication').mockResolvedValue({
      application: {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        team_id: sampleTeamId,
        event_id: sampleEventId,
        vacancy_id: sampleVacancyId,
        participant_id: otherParticipant.id,
        request_type: 'Application',
        status: 'Withdrawn',
        cancel_reason: 'APPLICANT_WITHDRAWN',
        resolved_at: '2026-10-19T16:00:00.000Z',
        expires_at: null,
        message: 'Interested',
        created_at: '2026-10-19T12:00:00.000Z',
        updated_at: '2026-10-19T16:00:00.000Z',
      },
      changed: true,
      idempotent: false,
      teamName: 'HackMatch Innovators',
      vacancyRole: 'Frontend',
      alerts: [
        {
          audience: 'applicant',
          type: 'team_application_withdrawn',
          message: 'You withdrew your application.',
        },
        {
          audience: 'owner',
          type: 'team_application_withdrawn',
          message: 'An applicant withdrew their Pending Review application.',
        },
      ],
      notice:
        'Pending Review application withdrawn. Your pending quota for this event is released.',
    });

    const result = await withdrawApplication(
      otherParticipant.id,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    );

    expect(result.application.status).toBe('Withdrawn');
    expect(result.application.statusLabel).toBe('Withdrawn');
    expect(result.changed).toBe(true);
    expect(result.alerts).toHaveLength(2);
    expect(result.alerts.map((a) => a.audience)).toEqual(
      expect.arrayContaining(['applicant', 'owner'])
    );
    expect(result.notice).toMatch(/withdrawn/i);
  });

  it('treats repeated withdraw as idempotent success', async () => {
    vi.spyOn(teamsRepository, 'withdrawTeamApplication').mockResolvedValue({
      application: {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        team_id: sampleTeamId,
        event_id: sampleEventId,
        vacancy_id: sampleVacancyId,
        participant_id: otherParticipant.id,
        request_type: 'Application',
        status: 'Withdrawn',
        cancel_reason: 'APPLICANT_WITHDRAWN',
        resolved_at: '2026-10-19T15:00:00.000Z',
        expires_at: null,
        message: null,
        created_at: '2026-10-19T12:00:00.000Z',
        updated_at: '2026-10-19T15:00:00.000Z',
      },
      changed: false,
      idempotent: true,
      teamName: 'HackMatch Innovators',
      vacancyRole: 'Frontend',
      alerts: [],
      notice: 'Application was already withdrawn.',
    });

    const result = await withdrawApplication(
      otherParticipant.id,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    );

    expect(result.idempotent).toBe(true);
    expect(result.changed).toBe(false);
    expect(result.application.status).toBe('Withdrawn');
  });

  it('maps APPLICATION_NOT_WITHDRAWABLE from repository', async () => {
    vi.spyOn(teamsRepository, 'withdrawTeamApplication').mockRejectedValue({
      message: 'APPLICATION_NOT_WITHDRAWABLE',
      code: 'P0001',
      detail: JSON.stringify({ status: 'Accepted' }),
    });

    await expect(
      withdrawApplication(otherParticipant.id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    ).rejects.toMatchObject({ code: 'APPLICATION_NOT_WITHDRAWABLE', status: 409 });
  });

  it('maps FORBIDDEN_NOT_APPLICANT from repository', async () => {
    vi.spyOn(teamsRepository, 'withdrawTeamApplication').mockRejectedValue({
      message: 'FORBIDDEN_NOT_APPLICANT',
      code: 'P0001',
    });

    await expect(
      withdrawApplication(ownerParticipant.id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    ).rejects.toMatchObject({ code: 'FORBIDDEN_NOT_APPLICANT', status: 403 });
  });
});
