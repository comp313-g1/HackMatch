import { describe, it, expect, vi, beforeEach } from 'vitest';
import { submitApplication } from './applications.js';
import { teamsRepository } from '../db/teams.repository.js';
import {
  otherParticipant,
  ownerParticipant,
  sampleEventId,
  sampleTeamId,
  sampleVacancyId,
} from '../routes/team.testUtils.js';

describe('submitApplication (US-018 / #172 / FR-053 / FR-054)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('maps RPC success to Pending Review application view (happy path)', async () => {
    vi.spyOn(teamsRepository, 'submitTeamApplication').mockResolvedValue({
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

    const view = await submitApplication({
      actorParticipantId: otherParticipant.id,
      teamId: sampleTeamId,
      vacancyId: sampleVacancyId,
      message: 'Interested in Frontend',
    });

    expect(view).toMatchObject({
      status: 'Pending',
      requestType: 'Application',
      vacancyId: sampleVacancyId,
      applicantParticipantId: otherParticipant.id,
      message: 'Interested in Frontend',
      pendingCountForEvent: 1,
    });
    expect(teamsRepository.submitTeamApplication).toHaveBeenCalledWith(
      otherParticipant.id,
      sampleTeamId,
      sampleVacancyId,
      'Interested in Frontend'
    );
  });

  it('maps APPLICATION_PENDING_LIMIT from Postgres exception', async () => {
    vi.spyOn(teamsRepository, 'submitTeamApplication').mockRejectedValue({
      message: 'APPLICATION_PENDING_LIMIT',
      code: 'P0001',
      detail: JSON.stringify({ limit: 3, pendingCount: 3 }),
    });

    await expect(
      submitApplication({
        actorParticipantId: otherParticipant.id,
        teamId: sampleTeamId,
        vacancyId: sampleVacancyId,
        message: null,
      })
    ).rejects.toMatchObject({
      code: 'APPLICATION_PENDING_LIMIT',
      status: 409,
    });
  });

  it('maps DUPLICATE_PENDING_APPLICATION unique violation', async () => {
    vi.spyOn(teamsRepository, 'submitTeamApplication').mockRejectedValue({
      message: 'duplicate key value violates unique constraint',
      code: '23505',
      details: 'Key (team_id, participant_id)=(...) already exists. uq_team_requests_pending_application',
    });

    await expect(
      submitApplication({
        actorParticipantId: otherParticipant.id,
        teamId: sampleTeamId,
        vacancyId: sampleVacancyId,
        message: null,
      })
    ).rejects.toMatchObject({
      code: 'DUPLICATE_PENDING_APPLICATION',
      status: 409,
    });
  });

  it('maps CANNOT_APPLY_TO_OWN_TEAM when owner applies', async () => {
    vi.spyOn(teamsRepository, 'submitTeamApplication').mockRejectedValue({
      message: 'CANNOT_APPLY_TO_OWN_TEAM',
      code: 'P0001',
    });

    await expect(
      submitApplication({
        actorParticipantId: ownerParticipant.id,
        teamId: sampleTeamId,
        vacancyId: sampleVacancyId,
        message: null,
      })
    ).rejects.toMatchObject({
      code: 'CANNOT_APPLY_TO_OWN_TEAM',
      status: 400,
    });
  });
});
