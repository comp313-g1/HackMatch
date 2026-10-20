import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import { teamsRepository } from '../db/teams.repository.js';
import * as invitationAcceptance from '../services/invitationAcceptance.js';
import {
  otherParticipant,
  ownerParticipant,
  sampleEventId,
  sampleTeam,
  sampleTeamId,
  sampleVacancy,
  sampleVacancyId,
  validOtherDecodedToken,
  otherTokenHeader,
  validOwnerDecodedToken,
  validTokenHeader,
} from './team.testUtils.js';

const mockVerifyIdToken = vi.fn();

vi.mock('../config/firebase.js', () => {
  const authMock = {
    verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
  };
  return {
    firebaseAuth: authMock,
    auth: authMock,
    getFirebaseAdminAuth: vi.fn(),
    verifyEmailActionCode: vi.fn(),
    sendVerificationEmail: vi.fn(),
    _resetFirebaseInstances: vi.fn(),
  };
});

const invitationId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const minePath = '/api/invitations/mine';
const detailPath = `/api/invitations/${invitationId}`;
const respondPath = `/api/invitations/${invitationId}/respond`;

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

describe('Invitee invitation detail + respond (US-019 / #179 / #182)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockVerifyIdToken.mockResolvedValue(validOtherDecodedToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(otherParticipant);
  });

  it('rejects unauthenticated mine list with 401', async () => {
    const res = await request(app).get(minePath);
    expect(res.status).toBe(401);
  });

  it('lists inbound invitations for the addressed PART', async () => {
    vi.spyOn(teamsRepository, 'listMyInvitations').mockResolvedValue([
      {
        invitation: pendingInvitation,
        vacancyRole: 'Frontend',
        teamName: 'HackMatch Innovators',
      },
    ]);

    const res = await request(app).get(minePath).set('Authorization', otherTokenHeader);

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.invitations[0]).toMatchObject({
      status: 'Pending',
      canRespond: true,
      teamName: 'HackMatch Innovators',
    });
  });

  it('returns invitee detail with permitted team fields', async () => {
    vi.spyOn(teamsRepository, 'findInvitationById').mockResolvedValue(pendingInvitation);
    vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(sampleTeam);
    vi.spyOn(teamsRepository, 'getTeamViewParts').mockResolvedValue({
      team: sampleTeam,
      event: { max_team_size: 4, status: 'Published', end_date: '2099-01-01T00:00:00.000Z' },
      members: [],
      vacancies: [sampleVacancy],
    } as never);

    const res = await request(app).get(detailPath).set('Authorization', otherTokenHeader);

    expect(res.status).toBe(200);
    expect(res.body.invitation.permittedDetails.teamName).toBe(sampleTeam.name);
    expect(res.body.invitation.permittedDetails.vacancyRole).toBe(sampleVacancy.role);
  });

  it('forbids detail access for non-invitee', async () => {
    mockVerifyIdToken.mockResolvedValue(validOwnerDecodedToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(ownerParticipant);
    vi.spyOn(teamsRepository, 'findInvitationById').mockResolvedValue(pendingInvitation);

    const res = await request(app).get(detailPath).set('Authorization', validTokenHeader);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_NOT_INVITEE');
  });

  it('rejects invalid respond decision with field error', async () => {
    const res = await request(app)
      .post(respondPath)
      .set('Authorization', otherTokenHeader)
      .send({ decision: 'maybe' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.errors.decision).toMatch(/accept or decline/i);
  });

  it('rejects unauthenticated decline attempts before the repository', async () => {
    const declineSpy = vi.spyOn(teamsRepository, 'declineTeamInvitation');

    const res = await request(app).post(respondPath).send({ decision: 'decline' });

    expect(res.status).toBe(401);
    expect(declineSpy).not.toHaveBeenCalled();
  });

  it('rejects a malformed invitation id with an explicit field error', async () => {
    const declineSpy = vi.spyOn(teamsRepository, 'declineTeamInvitation');

    const res = await request(app)
      .post('/api/invitations/not-a-uuid/respond')
      .set('Authorization', otherTokenHeader)
      .send({ decision: 'decline' });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      code: 'VALIDATION_ERROR',
      errors: { invitationId: expect.stringMatching(/valid UUID/i) },
    });
    expect(declineSpy).not.toHaveBeenCalled();
  });

  it('accept respond atomically commits membership and fills the vacancy (#180)', async () => {
    const timestamp = '2026-10-20T12:00:00.000Z';
    vi.spyOn(invitationAcceptance, 'acceptInvitation').mockResolvedValue({
      accepted: true,
      invitation: { ...pendingInvitation, status: 'Accepted', resolved_at: timestamp },
      membership: {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        team_id: sampleTeamId,
        event_id: sampleEventId,
        participant_id: otherParticipant.id,
        role: 'Member',
        status: 'Confirmed',
        removal_reason: null,
        joined_at: timestamp,
        ended_at: null,
        created_at: timestamp,
        updated_at: timestamp,
      },
      vacancy: { ...sampleVacancy, status: 'Filled' },
      teamName: 'HackMatch Innovators',
      vacancyRole: 'Frontend',
      memberCount: 2,
      maxTeamSize: 4,
      availabilityCleared: true,
      membershipCommitted: true,
      cascade: {
        eventInvitationsCanceled: 1,
        eventApplicationsWithdrawn: 1,
        slotRequestsCanceled: 0,
        teamRequestsCanceled: 0,
        teamNowFull: false,
      },
      notice:
        'Invitation accepted. Membership confirmed, the vacancy is filled, and competing pending requests for this event were cleared.',
    });

    const res = await request(app)
      .post(respondPath)
      .set('Authorization', otherTokenHeader)
      .send({ decision: 'accept' });

    expect(res.status).toBe(200);
    expect(res.body.decision).toBe('accept');
    expect(res.body.membershipCommitted).toBe(true);
    expect(res.body.eligible).toBe(true);
    expect(res.body.invitation.status).toBe('Accepted');
    expect(res.body.membership).toMatchObject({ role: 'Member', status: 'Confirmed' });
    expect(res.body.vacancy.status).toBe('Filled');
    expect(res.body.cascade).toMatchObject({
      eventInvitationsCanceled: 1,
      eventApplicationsWithdrawn: 1,
    });
  });

  it('returns the explicit winning state when a competing acceptance resolves first (#184)', async () => {
    vi.spyOn(invitationAcceptance, 'acceptInvitation').mockRejectedValue({
      message: 'INVITATION_ACCEPTANCE_CONFLICT',
      code: 'P0001',
      detail: JSON.stringify({
        invitationId,
        status: 'Canceled',
        reason: 'SLOT_FILLED',
        retryable: false,
      }),
    });

    const res = await request(app)
      .post(respondPath)
      .set('Authorization', otherTokenHeader)
      .send({ decision: 'accept' });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'INVITATION_ACCEPTANCE_CONFLICT',
      details: {
        invitationId,
        status: 'Canceled',
        reason: 'SLOT_FILLED',
        retryable: false,
      },
      errors: { invitationId: expect.stringMatching(/another acceptance/i) },
    });
    expect(res.body).not.toHaveProperty('membership');
  });

  it('decline respond returns Declined status and alerts (US-019-T2)', async () => {
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
      effects: {
        invitationChanged: true,
        ownerAlertCreated: true,
        inviteeAlertCreated: true,
        availabilityChanged: false,
        membershipChanged: false,
        vacancyChanged: false,
      },
      notice: 'Invitation declined. The team owner has been notified. Your availability is unchanged.',
    });

    const res = await request(app)
      .post(respondPath)
      .set('Authorization', otherTokenHeader)
      .send({ decision: 'decline' });

    expect(res.status).toBe(200);
    expect(res.body.decision).toBe('decline');
    expect(res.body.invitation.status).toBe('Declined');
    expect(res.body.alerts).toHaveLength(2);
    expect(res.body.effects).toEqual({
      invitationChanged: true,
      ownerAlertCreated: true,
      inviteeAlertCreated: true,
      availabilityChanged: false,
      membershipChanged: false,
      vacancyChanged: false,
    });
    expect(teamsRepository.declineTeamInvitation).toHaveBeenCalledWith(
      otherParticipant.id,
      invitationId
    );
  });

  it('forbids a different participant from declining and makes no mutation', async () => {
    mockVerifyIdToken.mockResolvedValue(validOwnerDecodedToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(ownerParticipant);
    const declineSpy = vi.spyOn(teamsRepository, 'declineTeamInvitation').mockRejectedValue({
      message: 'FORBIDDEN_NOT_INVITEE',
      code: 'P0001',
    });

    const res = await request(app)
      .post(respondPath)
      .set('Authorization', validTokenHeader)
      .send({ decision: 'decline' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_NOT_INVITEE');
    expect(declineSpy).toHaveBeenCalledWith(ownerParticipant.id, invitationId);
  });

  it.each(['INVITATION_NOT_DECLINABLE', 'INVITATION_EXPIRED'] as const)(
    'returns a clear 409 for %s without reporting success',
    async (code) => {
      vi.spyOn(teamsRepository, 'declineTeamInvitation').mockRejectedValue({
        message: code,
        code: 'P0001',
        detail: JSON.stringify({ status: code === 'INVITATION_EXPIRED' ? 'Expired' : 'Accepted' }),
      });

      const res = await request(app)
        .post(respondPath)
        .set('Authorization', otherTokenHeader)
        .send({ decision: 'decline' });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe(code);
      expect(res.body.errors.invitationId).toBeTruthy();
    }
  );

  it('returns a safe 500 when decline persistence fails unexpectedly', async () => {
    vi.spyOn(teamsRepository, 'declineTeamInvitation').mockRejectedValue(
      new Error('postgres password=secret decline failure')
    );

    const res = await request(app)
      .post(respondPath)
      .set('Authorization', otherTokenHeader)
      .send({ decision: 'decline' });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal Server Error' });
    expect(JSON.stringify(res.body)).not.toContain('password');
  });
});
