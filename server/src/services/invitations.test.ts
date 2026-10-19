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
} from '../routes/team.testUtils.js';

describe('issueInvitation (US-017 / FR-048)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns Pending invitation view with recommendation source', async () => {
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

    const view = await issueInvitation({
      actorParticipantId: ownerParticipant.id,
      teamId: sampleTeamId,
      vacancyId: sampleVacancyId,
      inviteeParticipantId: otherParticipant.id,
      source: 'recommendation',
    });

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
      issueInvitation({
        actorParticipantId: ownerParticipant.id,
        teamId: sampleTeamId,
        vacancyId: sampleVacancyId,
        inviteeParticipantId: ownerParticipant.id,
        source: 'recommendation',
      })
    ).rejects.toMatchObject({ code: 'CANNOT_INVITE_SELF' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('maps repository unique-violation messages to TeamServiceError', async () => {
    vi.spyOn(teamsRepository, 'issueTeamInvitation').mockRejectedValue({
      message: 'DUPLICATE_PENDING_INVITATION',
      code: 'P0001',
    });

    await expect(
      issueInvitation({
        actorParticipantId: ownerParticipant.id,
        teamId: sampleTeamId,
        vacancyId: sampleVacancyId,
        inviteeParticipantId: otherParticipant.id,
      })
    ).rejects.toBeInstanceOf(TeamServiceError);

    await expect(
      issueInvitation({
        actorParticipantId: ownerParticipant.id,
        teamId: sampleTeamId,
        vacancyId: sampleVacancyId,
        inviteeParticipantId: otherParticipant.id,
      })
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
