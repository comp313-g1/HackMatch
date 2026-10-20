import { describe, expect, it, vi } from 'vitest';
import { approveApplication } from './applicationApproval.js';
import {
  otherParticipant,
  ownerParticipant,
  sampleEventId,
  sampleTeam,
  sampleTeamId,
  sampleVacancy,
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

function committedApproval() {
  const timestamp = '2026-10-20T12:00:00.000Z';
  return {
    approved: true as const,
    changed: true,
    idempotent: false,
    existingOutcome: 'Accepted' as const,
    application: {
      ...pendingApplication(),
      status: 'Accepted' as const,
      resolved_at: timestamp,
      updated_at: timestamp,
    },
    membership: {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      team_id: sampleTeamId,
      event_id: sampleEventId,
      participant_id: otherParticipant.id,
      role: 'Member' as const,
      status: 'Confirmed' as const,
      removal_reason: null,
      joined_at: timestamp,
      ended_at: null,
      created_at: timestamp,
      updated_at: timestamp,
    },
    vacancy: { ...sampleVacancy, status: 'Filled' as const, updated_at: timestamp },
    teamName: sampleTeam.name,
    vacancyRole: sampleVacancy.role,
    memberCount: 2,
    maxTeamSize: 4,
    availabilityCleared: true,
    membershipCommitted: true,
    cascade: {
      winningRequestId: applicationId,
      eventInvitationsCanceled: 2,
      eventApplicationsWithdrawn: 1,
      slotRequestsCanceled: 3,
      teamRequestsCanceled: 0,
      teamNowFull: false,
    },
    notice: 'Application approved. Competing pending requests were cleared.',
  };
}

function passingRepo() {
  return {
    findApplicationById: vi.fn().mockResolvedValue(pendingApplication()),
    findTeamById: vi.fn().mockResolvedValue(sampleTeam),
    approveTeamApplication: vi.fn().mockResolvedValue(committedApproval()),
  };
}

describe('approveApplication (US-020 / #190 / #191 / #193 / FR-061)', () => {
  it('returns the committed membership and filled vacancy from the atomic RPC', async () => {
    const teamsRepo = passingRepo();

    const result = await approveApplication(
      { actorParticipantId: ownerParticipant.id, applicationId },
      { teamsRepo }
    );

    expect(teamsRepo.approveTeamApplication).toHaveBeenCalledWith(
      ownerParticipant.id,
      applicationId
    );
    expect(result).toMatchObject({
      approved: true,
      changed: true,
      idempotent: false,
      existingOutcome: 'Accepted',
      application: { status: 'Accepted', statusLabel: 'Accepted' },
      membership: { participantId: otherParticipant.id, status: 'Confirmed' },
      vacancy: { id: sampleVacancyId, status: 'Filled' },
      memberCount: 2,
      maxTeamSize: 4,
      availabilityCleared: true,
      cascade: {
        winningRequestId: applicationId,
        eventInvitationsCanceled: 2,
        eventApplicationsWithdrawn: 1,
        slotRequestsCanceled: 3,
        teamRequestsCanceled: 0,
        teamNowFull: false,
      },
    });
  });

  it('returns the existing Accepted outcome for an idempotent repeat', async () => {
    const teamsRepo = passingRepo();
    teamsRepo.approveTeamApplication.mockResolvedValue({
      ...committedApproval(),
      changed: false,
      idempotent: true,
      cascade: {
        winningRequestId: applicationId,
        eventInvitationsCanceled: 0,
        eventApplicationsWithdrawn: 0,
        slotRequestsCanceled: 0,
        teamRequestsCanceled: 0,
        teamNowFull: false,
      },
      notice: 'Application was already approved. No changes were made.',
    });

    const result = await approveApplication(
      { actorParticipantId: ownerParticipant.id, applicationId },
      { teamsRepo }
    );

    expect(result).toMatchObject({
      approved: true,
      changed: false,
      idempotent: true,
      existingOutcome: 'Accepted',
      application: { status: 'Accepted' },
      cascade: {
        eventInvitationsCanceled: 0,
        eventApplicationsWithdrawn: 0,
        slotRequestsCanceled: 0,
        teamRequestsCanceled: 0,
      },
    });
  });

  it('returns historical Accepted state when later lifecycle changes removed live records', async () => {
    const teamsRepo = passingRepo();
    teamsRepo.approveTeamApplication.mockResolvedValue({
      ...committedApproval(),
      changed: false,
      idempotent: true,
      membership: null,
      vacancy: null,
      membershipCommitted: false,
      notice: 'Application was already approved. No changes were made.',
    });

    const result = await approveApplication(
      { actorParticipantId: ownerParticipant.id, applicationId },
      { teamsRepo }
    );

    expect(result).toMatchObject({
      idempotent: true,
      existingOutcome: 'Accepted',
      membership: null,
      vacancy: null,
      membershipCommitted: false,
    });
  });

  it('denies non-owners before invoking the transaction', async () => {
    const teamsRepo = passingRepo();

    await expect(
      approveApplication(
        { actorParticipantId: otherParticipant.id, applicationId },
        { teamsRepo }
      )
    ).rejects.toMatchObject({ code: 'FORBIDDEN_NOT_TEAM_OWNER', status: 403 });
    expect(teamsRepo.approveTeamApplication).not.toHaveBeenCalled();
  });

  it('returns APPLICATION_NOT_FOUND without querying a team', async () => {
    const teamsRepo = passingRepo();
    teamsRepo.findApplicationById.mockResolvedValue(null);

    await expect(
      approveApplication(
        { actorParticipantId: ownerParticipant.id, applicationId },
        { teamsRepo }
      )
    ).rejects.toMatchObject({ code: 'APPLICATION_NOT_FOUND', status: 404 });
    expect(teamsRepo.findTeamById).not.toHaveBeenCalled();
  });

  it.each([
    'VACANCY_NOT_OPEN',
    'CAPACITY_EXCEEDED',
    'APPLICATION_APPLICANT_NOT_ELIGIBLE',
    'APPLICATION_APPLICANT_ALREADY_CONFIRMED',
    'TEAM_NOT_MUTABLE',
    'EVENT_NOT_RECRUITING',
    'APPLICATION_NOT_APPROVABLE',
    'APPLICATION_DECISION_CONFLICT',
    'APPLICATION_APPROVAL_CONFLICT',
  ] as const)('maps %s to an explicit service failure', async (code) => {
    const teamsRepo = passingRepo();
    teamsRepo.approveTeamApplication.mockRejectedValue({
      message: code,
      code: 'P0001',
      detail: JSON.stringify({ applicationId }),
    });

    await expect(
      approveApplication(
        { actorParticipantId: ownerParticipant.id, applicationId },
        { teamsRepo }
      )
    ).rejects.toMatchObject({ code, status: 409 });
  });

  it.each(['40P01', '40001', '55P03'])(
    'maps PostgreSQL concurrency code %s to a retryable approval conflict',
    async (databaseCode) => {
      const teamsRepo = passingRepo();
      teamsRepo.approveTeamApplication.mockRejectedValue({
        code: databaseCode,
        message: 'internal database detail',
      });

      await expect(
        approveApplication(
          { actorParticipantId: ownerParticipant.id, applicationId },
          { teamsRepo }
        )
      ).rejects.toMatchObject({
        code: 'APPLICATION_APPROVAL_CONFLICT',
        details: { reason: 'DATABASE_CONCURRENCY_RETRY', retryable: true },
      });
    }
  );

  it('preserves unknown persistence failures for the safe 500 handler', async () => {
    const teamsRepo = passingRepo();
    const failure = new Error('database password=secret');
    teamsRepo.approveTeamApplication.mockRejectedValue(failure);

    await expect(
      approveApplication(
        { actorParticipantId: ownerParticipant.id, applicationId },
        { teamsRepo }
      )
    ).rejects.toBe(failure);
  });
});

