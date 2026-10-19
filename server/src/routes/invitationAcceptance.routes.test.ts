import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import { teamsRepository } from '../db/teams.repository.js';
import {
  otherParticipant,
  ownerParticipant,
  sampleEventId,
  sampleParts,
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

const invitationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const acceptPath = `/api/invitations/${invitationId}/accept`;

describe('POST /api/invitations/:id/accept (US-017 / #165 / FR-051)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockVerifyIdToken.mockResolvedValue(validOtherDecodedToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(otherParticipant);
    vi.spyOn(participantsRepository, 'findById').mockResolvedValue(otherParticipant);
    vi.spyOn(teamsRepository, 'findInvitationById').mockResolvedValue({
      id: invitationId,
      team_id: sampleTeamId,
      event_id: sampleEventId,
      vacancy_id: sampleVacancyId,
      participant_id: otherParticipant.id,
      request_type: 'Invitation',
      status: 'Pending',
      cancel_reason: null,
      resolved_at: null,
      expires_at: '2099-01-01T00:00:00.000Z',
      created_at: '2026-10-19T12:00:00.000Z',
      updated_at: '2026-10-19T12:00:00.000Z',
    });
    vi.spyOn(teamsRepository, 'getTeamViewParts').mockResolvedValue({
      ...sampleParts,
      team: sampleTeam,
      event: {
        max_team_size: 4,
        status: 'Published',
        end_date: '2099-01-01T00:00:00.000Z',
      },
      vacancies: [sampleVacancy],
    });
    vi.spyOn(teamsRepository, 'listConfirmedParticipantIdsForEvent').mockResolvedValue([
      ownerParticipant.id,
    ]);
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).post(acceptPath).send({});
    expect(res.status).toBe(401);
  });

  it('returns eligible when invitation is still within 48h and context is open (happy path)', async () => {
    const res = await request(app)
      .post(acceptPath)
      .set('Authorization', otherTokenHeader)
      .send({});

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.eligible).toBe(true);
    expect(res.body.invitation.status).toBe('Pending');
    expect(res.body.notice).toMatch(/48-hour/i);
  });

  it('returns 409 INVITATION_EXPIRED when past TTL even if still Pending (US-017-T3)', async () => {
    vi.spyOn(teamsRepository, 'findInvitationById').mockResolvedValue({
      id: invitationId,
      team_id: sampleTeamId,
      event_id: sampleEventId,
      vacancy_id: sampleVacancyId,
      participant_id: otherParticipant.id,
      request_type: 'Invitation',
      status: 'Pending',
      cancel_reason: null,
      resolved_at: null,
      expires_at: '2020-01-01T00:00:00.000Z',
      created_at: '2019-12-30T00:00:00.000Z',
      updated_at: '2019-12-30T00:00:00.000Z',
    });
    vi.spyOn(teamsRepository, 'markInvitationExpiredIfDue').mockResolvedValue({
      invitation: {
        id: invitationId,
        team_id: sampleTeamId,
        event_id: sampleEventId,
        vacancy_id: sampleVacancyId,
        participant_id: otherParticipant.id,
        request_type: 'Invitation',
        status: 'Expired',
        cancel_reason: null,
        resolved_at: '2020-01-01T00:00:00.000Z',
        expires_at: '2020-01-01T00:00:00.000Z',
        created_at: '2019-12-30T00:00:00.000Z',
        updated_at: '2020-01-01T00:00:00.000Z',
      },
      changed: true,
    });

    const res = await request(app)
      .post(acceptPath)
      .set('Authorization', otherTokenHeader)
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('INVITATION_EXPIRED');
    expect(res.body.errors.invitationId).toMatch(/expired/i);
    expect(teamsRepository.markInvitationExpiredIfDue).toHaveBeenCalledWith(invitationId);
  });

  it('returns 409 VACANCY_NOT_OPEN when the slot closed before accept (US-017-T6)', async () => {
    vi.spyOn(teamsRepository, 'getTeamViewParts').mockResolvedValue({
      ...sampleParts,
      team: sampleTeam,
      event: {
        max_team_size: 4,
        status: 'Published',
        end_date: '2099-01-01T00:00:00.000Z',
      },
      vacancies: [{ ...sampleVacancy, status: 'Filled' }],
    });

    const res = await request(app)
      .post(acceptPath)
      .set('Authorization', otherTokenHeader)
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('VACANCY_NOT_OPEN');
  });

  it('returns 403 when a non-invitee tries to accept', async () => {
    mockVerifyIdToken.mockResolvedValue(validOwnerDecodedToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(ownerParticipant);

    const res = await request(app)
      .post(acceptPath)
      .set('Authorization', validTokenHeader)
      .send({});

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_NOT_INVITEE');
  });
});
