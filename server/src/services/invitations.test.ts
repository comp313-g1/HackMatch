import { describe, it, expect, vi, beforeEach } from 'vitest';
import { issueInvitation } from './invitations.js';
import { teamsRepository } from '../db/teams.repository.js';
import { TeamServiceError } from './teamErrors.js';
import {
  ownerParticipant,
  otherParticipant,
  sampleTeamId,
  sampleVacancyId,
  sampleEventId,
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
