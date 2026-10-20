import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getInvitationDetailForInvitee,
  invitationStatusLabel,
  listMyInvitations,
  respondToInvitation,
} from './invitationResponse.js';
import { teamsRepository } from '../db/teams.repository.js';
import * as invitationAcceptance from './invitationAcceptance.js';
import {
  otherParticipant,
  ownerParticipant,
  sampleEventId,
  sampleTeam,
  sampleTeamId,
  sampleVacancy,
  sampleVacancyId,
} from '../routes/team.testUtils.js';

const invitationId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const pendingInvitation = {
  id: invitationId,
  team_id: sampleTeamId,
  event_id: sampleEventId,
  vacancy_id: sampleVacancyId,
  participant_id: otherParticipant.id,
  request_type: 'Invitation' as const,
  status: 'Pending' as const,
  cancel_reason: null,
  resolved_at: null,
  expires_at: '2099-10-21T12:00:00.000Z',
  message: null,
  created_at: '2026-10-19T12:00:00.000Z',
  updated_at: '2026-10-19T12:00:00.000Z',
};

describe('invitationResponse (US-019 / #179)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('maps Pending+expired clock to Expired label', () => {
    expect(invitationStatusLabel('Pending', true)).toBe('Expired');
    expect(invitationStatusLabel('Pending', false)).toBe('Pending');
    expect(invitationStatusLabel('Declined')).toBe('Declined');
  });

  it('lists invitee invitations with canRespond for current Pending', async () => {
    vi.spyOn(teamsRepository, 'listMyInvitations').mockResolvedValue([
      {
        invitation: pendingInvitation,
        vacancyRole: 'Frontend',
        teamName: 'HackMatch Innovators',
      },
    ]);

    const result = await listMyInvitations(otherParticipant.id);

    expect(result.empty).toBe(false);
    expect(result.invitations[0]).toMatchObject({
      status: 'Pending',
      statusLabel: 'Pending',
      canRespond: true,
      teamName: 'HackMatch Innovators',
      vacancyRole: 'Frontend',
    });
  });

  it('returns empty guidance when invitee has no invitations', async () => {
    vi.spyOn(teamsRepository, 'listMyInvitations').mockResolvedValue([]);
    const result = await listMyInvitations(otherParticipant.id);
    expect(result.empty).toBe(true);
    expect(result.message).toMatch(/No invitations yet/i);
  });

  it('returns invitee-only detail with permitted team fields', async () => {
    vi.spyOn(teamsRepository, 'findInvitationById').mockResolvedValue(pendingInvitation);
    vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(sampleTeam);
    vi.spyOn(teamsRepository, 'getTeamViewParts').mockResolvedValue({
      team: sampleTeam,
      event: { max_team_size: 4, status: 'Published', end_date: '2099-01-01T00:00:00.000Z' },
      members: [],
      vacancies: [sampleVacancy],
    } as never);

    const detail = await getInvitationDetailForInvitee(otherParticipant.id, invitationId);

    expect(detail.permittedDetails).toMatchObject({
      teamName: sampleTeam.name,
      vacancyRole: sampleVacancy.role,
      statusLabel: 'Pending',
    });
    expect(detail.canRespond).toBe(true);
  });

  it('rejects detail for non-invitee', async () => {
    vi.spyOn(teamsRepository, 'findInvitationById').mockResolvedValue(pendingInvitation);

    await expect(
      getInvitationDetailForInvitee(ownerParticipant.id, invitationId)
    ).rejects.toMatchObject({ code: 'FORBIDDEN_NOT_INVITEE', status: 403 });
  });

  it('accept decision runs FR-051 revalidation without membership commit', async () => {
    vi.spyOn(invitationAcceptance, 'revalidateInvitationForAcceptance').mockResolvedValue({
      eligible: true,
      invitation: pendingInvitation,
      expiresAt: pendingInvitation.expires_at!,
      teamName: 'HackMatch Innovators',
      vacancyRole: 'Frontend',
      notice: 'Invitation is still valid for acceptance.',
    });

    const result = await respondToInvitation(otherParticipant.id, invitationId, 'accept');

    expect(result.decision).toBe('accept');
    expect(result.membershipCommitted).toBe(false);
    expect(result.eligible).toBe(true);
    expect(result.notice).toMatch(/valid/i);
  });

  it('decline decision commits Declined and returns owner/invitee alerts', async () => {
    vi.spyOn(teamsRepository, 'declineTeamInvitation').mockResolvedValue({
      invitation: {
        ...pendingInvitation,
        status: 'Declined',
        cancel_reason: 'INVITEE_DECLINED',
        resolved_at: '2026-10-19T16:00:00.000Z',
      },
      changed: true,
      idempotent: false,
      teamName: 'HackMatch Innovators',
      vacancyRole: 'Frontend',
      alerts: [
        {
          audience: 'invitee',
          type: 'team_invitation_declined',
          message: 'You declined the invitation.',
        },
        {
          audience: 'owner',
          type: 'team_invitation_declined',
          message: 'An invitee declined the pending invitation.',
        },
      ],
      notice: 'Invitation declined. The team owner has been notified. Your availability is unchanged.',
    });

    const result = await respondToInvitation(otherParticipant.id, invitationId, 'decline');

    expect(result.decision).toBe('decline');
    expect(result.invitation.status).toBe('Declined');
    expect(result.changed).toBe(true);
    expect(result.alerts).toHaveLength(2);
    expect(result.notice).toMatch(/availability is unchanged/i);
  });

  it('maps INVITATION_NOT_DECLINABLE from repository', async () => {
    vi.spyOn(teamsRepository, 'declineTeamInvitation').mockRejectedValue({
      message: 'INVITATION_NOT_DECLINABLE',
      code: 'P0001',
    });

    await expect(
      respondToInvitation(otherParticipant.id, invitationId, 'decline')
    ).rejects.toMatchObject({ code: 'INVITATION_NOT_DECLINABLE', status: 409 });
  });
});
