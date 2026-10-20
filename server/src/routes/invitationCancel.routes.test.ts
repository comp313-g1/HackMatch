import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import { teamsRepository } from '../db/teams.repository.js';
import {
  otherParticipant,
  ownerParticipant,
  sampleEventId,
  sampleTeamId,
  sampleVacancyId,
  validOwnerDecodedToken,
  validOtherDecodedToken,
  validTokenHeader,
  otherTokenHeader,
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
const cancelPath = `/api/invitations/${invitationId}`;

describe('DELETE /api/invitations/:id (US-017 / #166 / FR-052)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockVerifyIdToken.mockResolvedValue(validOwnerDecodedToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(ownerParticipant);
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).delete(cancelPath);
    expect(res.status).toBe(401);
  });

  it('cancels Pending invitation and returns alerts (happy path / US-017-T4)', async () => {
    vi.spyOn(teamsRepository, 'cancelTeamInvitation').mockResolvedValue({
      invitation: {
        id: invitationId,
        team_id: sampleTeamId,
        event_id: sampleEventId,
        vacancy_id: sampleVacancyId,
        participant_id: otherParticipant.id,
        request_type: 'Invitation',
        status: 'Canceled',
        cancel_reason: 'OWNER_CANCELED',
        resolved_at: '2026-10-19T15:00:00.000Z',
        expires_at: '2026-10-21T12:00:00.000Z',
        created_at: '2026-10-19T12:00:00.000Z',
        updated_at: '2026-10-19T15:00:00.000Z',
      },
      changed: true,
      idempotent: false,
      teamName: 'HackMatch Innovators',
      vacancyRole: 'Frontend',
      alerts: [
        {
          audience: 'invitee',
          type: 'team_invitation_canceled',
          message: 'Your invitation was canceled by the team owner.',
        },
        {
          audience: 'owner',
          type: 'team_invitation_canceled',
          message: 'You canceled the pending invitation.',
        },
      ],
      notice: 'Pending invitation canceled. Quota for this slot and invitee is released.',
    });

    const res = await request(app)
      .delete(cancelPath)
      .set('Authorization', validTokenHeader);

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.invitation.status).toBe('Canceled');
    expect(res.body.alerts).toHaveLength(2);
    expect(res.body.notice).toMatch(/canceled/i);
    expect(teamsRepository.cancelTeamInvitation).toHaveBeenCalledWith(
      ownerParticipant.id,
      invitationId
    );
  });

  it('returns 200 idempotent when invitation is already Canceled', async () => {
    vi.spyOn(teamsRepository, 'cancelTeamInvitation').mockResolvedValue({
      invitation: {
        id: invitationId,
        team_id: sampleTeamId,
        event_id: sampleEventId,
        vacancy_id: sampleVacancyId,
        participant_id: otherParticipant.id,
        request_type: 'Invitation',
        status: 'Canceled',
        cancel_reason: 'OWNER_CANCELED',
        resolved_at: '2026-10-19T14:00:00.000Z',
        expires_at: '2026-10-21T12:00:00.000Z',
        created_at: '2026-10-19T12:00:00.000Z',
        updated_at: '2026-10-19T14:00:00.000Z',
      },
      changed: false,
      idempotent: true,
      teamName: 'HackMatch Innovators',
      vacancyRole: 'Frontend',
      alerts: [],
      notice: 'Invitation was already canceled.',
    });

    const res = await request(app)
      .delete(cancelPath)
      .set('Authorization', validTokenHeader);

    expect(res.status).toBe(200);
    expect(res.body.idempotent).toBe(true);
  });

  it('returns 403 when non-owner tries to cancel', async () => {
    mockVerifyIdToken.mockResolvedValue(validOtherDecodedToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(otherParticipant);
    vi.spyOn(teamsRepository, 'cancelTeamInvitation').mockRejectedValue({
      message: 'FORBIDDEN_NOT_TEAM_OWNER',
      code: 'P0001',
    });

    const res = await request(app)
      .delete(cancelPath)
      .set('Authorization', otherTokenHeader);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_NOT_TEAM_OWNER');
  });

  it('returns 409 when invitation is not Pending', async () => {
    vi.spyOn(teamsRepository, 'cancelTeamInvitation').mockRejectedValue({
      message: 'INVITATION_NOT_CANCELABLE',
      code: 'P0001',
    });

    const res = await request(app)
      .delete(cancelPath)
      .set('Authorization', validTokenHeader);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('INVITATION_NOT_CANCELABLE');
    expect(res.body.errors.invitationId).toBeTruthy();
  });
});
