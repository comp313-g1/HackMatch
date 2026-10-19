import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import { teamsRepository } from '../db/teams.repository.js';
import {
  ownerParticipant,
  otherParticipant,
  sampleTeamId,
  sampleVacancyId,
  sampleEventId,
  sampleTeam,
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

const invitePath = `/api/teams/${sampleTeamId}/invitations`;

describe('POST /api/teams/:teamId/invitations (US-017 / FR-048)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockVerifyIdToken.mockResolvedValue(validOwnerDecodedToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(ownerParticipant);
    vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(sampleTeam);
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).post(invitePath).send({
      vacancyId: sampleVacancyId,
      inviteeParticipantId: otherParticipant.id,
      source: 'recommendation',
    });
    expect(res.status).toBe(401);
  });

  it('rejects non-owners with 403', async () => {
    mockVerifyIdToken.mockResolvedValue(validOtherDecodedToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(otherParticipant);

    const res = await request(app)
      .post(invitePath)
      .set('Authorization', otherTokenHeader)
      .send({
        vacancyId: sampleVacancyId,
        inviteeParticipantId: ownerParticipant.id,
        source: 'recommendation',
      });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_NOT_TEAM_OWNER');
  });

  it('rejects invalid body with 400 and field errors (draft fields preserved by client)', async () => {
    const res = await request(app)
      .post(invitePath)
      .set('Authorization', validTokenHeader)
      .send({
        vacancyId: 'bad',
        inviteeParticipantId: otherParticipant.id,
        source: 'recommendation',
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.errors.vacancyId).toBeTruthy();
  });

  it('creates a Pending invitation from recommendation source (happy path)', async () => {
    const expiresAt = '2026-10-21T15:00:00.000Z';
    vi.spyOn(teamsRepository, 'issueTeamInvitation').mockResolvedValue({
      invitation: {
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        team_id: sampleTeamId,
        event_id: sampleEventId,
        vacancy_id: sampleVacancyId,
        participant_id: otherParticipant.id,
        request_type: 'Invitation',
        status: 'Pending',
        cancel_reason: null,
        resolved_at: null,
        expires_at: expiresAt,
        created_at: '2026-10-19T15:00:00.000Z',
        updated_at: '2026-10-19T15:00:00.000Z',
      },
      expiresAt,
      vacancyRole: 'Frontend',
      teamName: 'HackMatch Innovators',
    });

    const res = await request(app)
      .post(invitePath)
      .set('Authorization', validTokenHeader)
      .send({
        vacancyId: sampleVacancyId,
        inviteeParticipantId: otherParticipant.id,
        source: 'recommendation',
      });

    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.invitation).toMatchObject({
      status: 'Pending',
      source: 'recommendation',
      vacancyId: sampleVacancyId,
      inviteeParticipantId: otherParticipant.id,
      expiresAt,
    });
    expect(teamsRepository.issueTeamInvitation).toHaveBeenCalledWith(
      ownerParticipant.id,
      sampleTeamId,
      sampleVacancyId,
      otherParticipant.id
    );
  });

  it('returns 409 when a pending invite already exists for the invitee', async () => {
    vi.spyOn(teamsRepository, 'issueTeamInvitation').mockRejectedValue({
      message: 'DUPLICATE_PENDING_INVITATION',
      code: 'P0001',
    });

    const res = await request(app)
      .post(invitePath)
      .set('Authorization', validTokenHeader)
      .send({
        vacancyId: sampleVacancyId,
        inviteeParticipantId: otherParticipant.id,
        source: 'recommendation',
      });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DUPLICATE_PENDING_INVITATION');
  });

  it('returns 409 when invitee is not Looking for Team', async () => {
    vi.spyOn(teamsRepository, 'issueTeamInvitation').mockRejectedValue({
      message: 'INVITEE_NOT_AVAILABLE',
      code: 'P0001',
    });

    const res = await request(app)
      .post(invitePath)
      .set('Authorization', validTokenHeader)
      .send({
        vacancyId: sampleVacancyId,
        inviteeParticipantId: otherParticipant.id,
        source: 'recommendation',
      });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('INVITEE_NOT_AVAILABLE');
  });
});
