import { describe, expect, it, vi } from 'vitest';
import { declineApplication } from './applicationDecline.js';
import {
  otherParticipant,
  ownerParticipant,
  sampleEventId,
  sampleTeam,
  sampleTeamId,
  sampleVacancyId,
} from '../routes/team.testUtils.js';
import type { TeamRequest } from '../db/types.js';

const applicationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function pendingApplication(): TeamRequest {
  return {
    id: applicationId,
    team_id: sampleTeamId,
    event_id: sampleEventId,
    vacancy_id: sampleVacancyId,
    participant_id: otherParticipant.id,
    request_type: 'Application',
    status: 'Pending',
    cancel_reason: null,
    resolved_at: null,
    expires_at: null,
    message: 'Ready to contribute',
    created_at: '2026-10-20T10:00:00.000Z',
    updated_at: '2026-10-20T10:00:00.000Z',
  };
}

function committedDecline() {
  const timestamp = '2026-10-20T12:00:00.000Z';
  return {
    application: {
      ...pendingApplication(),
      status: 'Declined' as const,
      cancel_reason: 'OWNER_DECLINED',
      resolved_at: timestamp,
      updated_at: timestamp,
    },
    changed: true,
    idempotent: false,
    existingOutcome: 'Declined' as const,
    teamName: sampleTeam.name,
    vacancyRole: 'Backend',
    alerts: [
      {
        audience: 'applicant' as const,
        type: 'team_application_declined',
        message: 'Your application was declined.',
      },
      {
        audience: 'owner' as const,
        type: 'team_application_declined',
        message: 'You declined an application.',
      },
    ],
    effects: {
      applicationChanged: true,
      applicantAlertCreated: true,
      ownerAlertCreated: true,
      pendingQuotaReleased: true,
      availabilityChanged: false as const,
      membershipChanged: false as const,
      vacancyChanged: false as const,
      capacityChanged: false as const,
    },
    notice: 'Application declined. The applicant was notified.',
  };
}

function passingRepo() {
  return {
    findApplicationById: vi.fn().mockResolvedValue(pendingApplication()),
    findTeamById: vi.fn().mockResolvedValue(sampleTeam),
    declineTeamApplication: vi.fn().mockResolvedValue(committedDecline()),
  };
}

describe('declineApplication (US-020 / #192 / #193 / FR-062)', () => {
  it('returns Declined with both alerts and unchanged roster effects', async () => {
    const teamsRepo = passingRepo();

    const result = await declineApplication(
      { actorParticipantId: ownerParticipant.id, applicationId },
      { teamsRepo }
    );

    expect(teamsRepo.declineTeamApplication).toHaveBeenCalledWith(
      ownerParticipant.id,
      applicationId
    );
    expect(result).toMatchObject({
      decision: 'decline',
      application: {
        id: applicationId,
        status: 'Declined',
        cancelReason: 'OWNER_DECLINED',
      },
      changed: true,
      idempotent: false,
      existingOutcome: 'Declined',
      alerts: [
        { audience: 'applicant', type: 'team_application_declined' },
        { audience: 'owner', type: 'team_application_declined' },
      ],
      effects: {
        pendingQuotaReleased: true,
        availabilityChanged: false,
        membershipChanged: false,
        vacancyChanged: false,
        capacityChanged: false,
      },
    });
  });

  it('returns the existing Declined outcome without duplicate alerts on repeat', async () => {
    const teamsRepo = passingRepo();
    teamsRepo.declineTeamApplication.mockResolvedValue({
      ...committedDecline(),
      changed: false,
      idempotent: true,
      alerts: [],
      effects: {
        applicationChanged: false,
        applicantAlertCreated: false,
        ownerAlertCreated: false,
        pendingQuotaReleased: false,
        availabilityChanged: false,
        membershipChanged: false,
        vacancyChanged: false,
        capacityChanged: false,
      },
      notice: 'Application was already declined. No changes or duplicate alerts were created.',
    });

    const result = await declineApplication(
      { actorParticipantId: ownerParticipant.id, applicationId },
      { teamsRepo }
    );

    expect(result).toMatchObject({
      decision: 'decline',
      changed: false,
      idempotent: true,
      existingOutcome: 'Declined',
      application: { status: 'Declined' },
      alerts: [],
      effects: {
        applicationChanged: false,
        applicantAlertCreated: false,
        ownerAlertCreated: false,
        pendingQuotaReleased: false,
      },
    });
  });

  it('denies a non-owner before invoking the decline transaction', async () => {
    const teamsRepo = passingRepo();

    await expect(
      declineApplication(
        { actorParticipantId: otherParticipant.id, applicationId },
        { teamsRepo }
      )
    ).rejects.toMatchObject({ code: 'FORBIDDEN_NOT_TEAM_OWNER', status: 403 });
    expect(teamsRepo.declineTeamApplication).not.toHaveBeenCalled();
  });

  it('returns APPLICATION_NOT_FOUND without querying a team', async () => {
    const teamsRepo = passingRepo();
    teamsRepo.findApplicationById.mockResolvedValue(null);

    await expect(
      declineApplication(
        { actorParticipantId: ownerParticipant.id, applicationId },
        { teamsRepo }
      )
    ).rejects.toMatchObject({ code: 'APPLICATION_NOT_FOUND', status: 404 });
    expect(teamsRepo.findTeamById).not.toHaveBeenCalled();
  });

  it('returns the existing outcome in an explicit opposite-decision conflict', async () => {
    const teamsRepo = passingRepo();
    teamsRepo.declineTeamApplication.mockRejectedValue({
      message: 'APPLICATION_DECISION_CONFLICT',
      code: 'P0001',
      detail: JSON.stringify({
        requestedDecision: 'decline',
        existingOutcome: 'Accepted',
        retryable: false,
      }),
    });

    await expect(
      declineApplication(
        { actorParticipantId: ownerParticipant.id, applicationId },
        { teamsRepo }
      )
    ).rejects.toMatchObject({
      code: 'APPLICATION_DECISION_CONFLICT',
      status: 409,
      details: {
        requestedDecision: 'decline',
        existingOutcome: 'Accepted',
        retryable: false,
      },
    });
  });

  it('preserves unknown persistence failures for the safe 500 handler', async () => {
    const teamsRepo = passingRepo();
    const failure = new Error('database password=secret');
    teamsRepo.declineTeamApplication.mockRejectedValue(failure);

    await expect(
      declineApplication(
        { actorParticipantId: ownerParticipant.id, applicationId },
        { teamsRepo }
      )
    ).rejects.toBe(failure);
  });
});
