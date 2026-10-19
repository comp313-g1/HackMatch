import { describe, it, expect, vi, beforeEach } from 'vitest';
import { issueInvitation, listOwnerInvitations } from './invitations.js';
import { teamsRepository } from '../db/teams.repository.js';
import { TeamServiceError } from './teamErrors.js';
import {
  ownerParticipant,
  otherParticipant,
  sampleTeamId,
  sampleVacancyId,
  sampleEventId,
  sampleTeam,
  sampleParts,
  sampleVacancy,
} from '../routes/team.testUtils.js';

function passingEligibilityDeps() {
  return {
    teamsRepo: {
      findTeamById: vi.fn().mockResolvedValue(sampleTeam),
      getTeamViewParts: vi.fn().mockResolvedValue({
        ...sampleParts,
        event: {
          max_team_size: 4,
          status: 'Published' as const,
          end_date: '2099-01-01T00:00:00.000Z',
        },
        vacancies: [sampleVacancy],
      }),
      listConfirmedParticipantIdsForEvent: vi.fn().mockResolvedValue([ownerParticipant.id]),
    },
    participantsRepo: {
      findById: vi.fn().mockResolvedValue(otherParticipant),
    },
    availabilityRepo: {
      findByParticipantId: vi.fn().mockResolvedValue({
        participantId: otherParticipant.id,
        isLooking: true,
        desiredRole: 'Frontend' as const,
        commitmentHours: 10,
        goal: 'Learning' as const,
        updatedAt: null,
      }),
    },
  };
}

describe('issueInvitation (US-017 / FR-048 / #163)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns Pending invitation view with recommendation source (happy path)', async () => {
    const expiresAt = '2026-10-21T12:00:00.000Z';
    vi.spyOn(teamsRepository, 'issueTeamInvitation').mockResolvedValue({
      invitation: {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        team_id: sampleTeamId,
        event_id: sampleEventId,
        vacancy_id: sampleVacancyId,
        participant_id: otherParticipant.id,
        request_type: 'Invitation',
        status: 'Pending',
        cancel_reason: null,
        resolved_at: null,
        expires_at: expiresAt,
        created_at: '2026-10-19T12:00:00.000Z',
        updated_at: '2026-10-19T12:00:00.000Z',
      },
      expiresAt,
      vacancyRole: 'Frontend',
      teamName: 'HackMatch Innovators',
    });

    const view = await issueInvitation(
      {
        actorParticipantId: ownerParticipant.id,
        teamId: sampleTeamId,
        vacancyId: sampleVacancyId,
        inviteeParticipantId: otherParticipant.id,
        source: 'recommendation',
      },
      passingEligibilityDeps()
    );

    expect(teamsRepository.issueTeamInvitation).toHaveBeenCalledWith(
      ownerParticipant.id,
      sampleTeamId,
      sampleVacancyId,
      otherParticipant.id
    );
    expect(view.status).toBe('Pending');
    expect(view.source).toBe('recommendation');
    expect(view.expiresAt).toBe(expiresAt);
    expect(view.notice).toMatch(/does not reserve/i);
  });

  it('rejects self-invite before repository call', async () => {
    const spy = vi.spyOn(teamsRepository, 'issueTeamInvitation');
    await expect(
      issueInvitation(
        {
          actorParticipantId: ownerParticipant.id,
          teamId: sampleTeamId,
          vacancyId: sampleVacancyId,
          inviteeParticipantId: ownerParticipant.id,
          source: 'recommendation',
        },
        passingEligibilityDeps()
      )
    ).rejects.toMatchObject({ code: 'CANNOT_INVITE_SELF' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('blocks issuance when invitee is not Looking for Team (#163)', async () => {
    const spy = vi.spyOn(teamsRepository, 'issueTeamInvitation');
    const deps = passingEligibilityDeps();
    deps.availabilityRepo.findByParticipantId.mockResolvedValue({
      participantId: otherParticipant.id,
      isLooking: false,
      desiredRole: 'Frontend',
      commitmentHours: 10,
      goal: 'Learning',
      updatedAt: null,
    });

    await expect(
      issueInvitation(
        {
          actorParticipantId: ownerParticipant.id,
          teamId: sampleTeamId,
          vacancyId: sampleVacancyId,
          inviteeParticipantId: otherParticipant.id,
        },
        deps
      )
    ).rejects.toMatchObject({ code: 'INVITEE_NOT_AVAILABLE', status: 409 });
    expect(spy).not.toHaveBeenCalled();
  });

  it('blocks issuance when vacancy is filled (#163)', async () => {
    const spy = vi.spyOn(teamsRepository, 'issueTeamInvitation');
    const deps = passingEligibilityDeps();
    deps.teamsRepo.getTeamViewParts.mockResolvedValue({
      ...sampleParts,
      event: {
        max_team_size: 4,
        status: 'Published',
        end_date: '2099-01-01T00:00:00.000Z',
      },
      vacancies: [{ ...sampleVacancy, status: 'Filled' }],
    });

    await expect(
      issueInvitation(
        {
          actorParticipantId: ownerParticipant.id,
          teamId: sampleTeamId,
          vacancyId: sampleVacancyId,
          inviteeParticipantId: otherParticipant.id,
        },
        deps
      )
    ).rejects.toMatchObject({ code: 'VACANCY_NOT_OPEN' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('maps repository unique-violation messages to TeamServiceError', async () => {
    vi.spyOn(teamsRepository, 'issueTeamInvitation').mockRejectedValue({
      message: 'DUPLICATE_PENDING_INVITATION',
      code: 'P0001',
    });

    await expect(
      issueInvitation(
        {
          actorParticipantId: ownerParticipant.id,
          teamId: sampleTeamId,
          vacancyId: sampleVacancyId,
          inviteeParticipantId: otherParticipant.id,
        },
        passingEligibilityDeps()
      )
    ).rejects.toMatchObject({ code: 'DUPLICATE_PENDING_INVITATION', status: 409 });
  });
});

describe('listOwnerInvitations (US-017 / #162)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty list for owner with no invitations', async () => {
    vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(sampleTeam);
    vi.spyOn(teamsRepository, 'listTeamInvitations').mockResolvedValue([]);

    const result = await listOwnerInvitations(ownerParticipant.id, sampleTeamId);

    expect(result.empty).toBe(true);
    expect(result.invitations).toEqual([]);
    expect(result.message).toMatch(/No invitations yet/i);
  });

  it('denies non-owners', async () => {
    vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(sampleTeam);

    await expect(listOwnerInvitations(otherParticipant.id, sampleTeamId)).rejects.toMatchObject({
      code: 'FORBIDDEN_NOT_TEAM_OWNER',
    });
  });

  it('flags Pending rows past expires_at via expiredByClock', async () => {
    vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(sampleTeam);
    vi.spyOn(teamsRepository, 'listTeamInvitations').mockResolvedValue([
      {
        invitation: {
          id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          team_id: sampleTeamId,
          event_id: sampleEventId,
          vacancy_id: sampleVacancyId,
          participant_id: otherParticipant.id,
          request_type: 'Invitation',
          status: 'Pending',
          cancel_reason: null,
          resolved_at: null,
          expires_at: '2026-10-18T00:00:00.000Z',
          created_at: '2026-10-16T00:00:00.000Z',
          updated_at: '2026-10-16T00:00:00.000Z',
        },
        inviteeHandle: 'other_dev',
        inviteeDisplayName: 'Other',
        vacancyRole: 'Frontend',
        teamName: 'HackMatch Innovators',
      },
    ]);

    const result = await listOwnerInvitations(
      ownerParticipant.id,
      sampleTeamId,
      new Date('2026-10-19T12:00:00.000Z')
    );

    expect(result.invitations[0].status).toBe('Pending');
    expect(result.invitations[0].expiredByClock).toBe(true);
  });
});
