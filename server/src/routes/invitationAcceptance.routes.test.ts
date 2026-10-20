import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import { teamsRepository } from '../db/teams.repository.js';
import {
  otherParticipant,
  ownerParticipant,
  sampleEventId,
  sampleTeam,
  sampleTeamId,
  sampleVacancy,
  sampleVacancyId,
  validOtherDecodedToken,
  validOwnerDecodedToken,
  otherTokenHeader,
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
const membershipId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const acceptPath = '/api/invitations/' + invitationId + '/accept';

function acceptedResult() {
  const timestamp = '2026-10-20T12:00:00.000Z';
  return {
    accepted: true as const,
    invitation: {
      id: invitationId,
      team_id: sampleTeamId,
      event_id: sampleEventId,
      vacancy_id: sampleVacancyId,
      participant_id: otherParticipant.id,
      request_type: 'Invitation' as const,
      status: 'Accepted' as const,
      cancel_reason: null,
      resolved_at: timestamp,
      expires_at: '2026-10-21T12:00:00.000Z',
      message: null,
      created_at: '2026-10-19T12:00:00.000Z',
      updated_at: timestamp,
    },
    membership: {
      id: membershipId,
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
      eventInvitationsCanceled: 0,
      eventApplicationsWithdrawn: 0,
      slotRequestsCanceled: 0,
      teamRequestsCanceled: 0,
      teamNowFull: false,
    },
    notice: 'Invitation accepted. Team membership is confirmed and the vacancy is filled.',
  };
}

describe('POST /api/invitations/:id/accept (US-019 / #180 / FR-056 / FR-083)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockVerifyIdToken.mockResolvedValue(validOtherDecodedToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(otherParticipant);
    vi.spyOn(teamsRepository, 'acceptTeamInvitation').mockResolvedValue(acceptedResult());
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).post(acceptPath).send({});

    expect(res.status).toBe(401);
    expect(teamsRepository.acceptTeamInvitation).not.toHaveBeenCalled();
  });

  it('atomically accepts the invitation and returns confirmed membership (happy path)', async () => {
    const res = await request(app)
      .post(acceptPath)
      .set('Authorization', otherTokenHeader)
      .send({});

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({
      accepted: true,
      invitation: {
        id: invitationId,
        status: 'Accepted',
        teamName: sampleTeam.name,
      },
      membership: {
        id: membershipId,
        participantId: otherParticipant.id,
        role: 'Member',
        status: 'Confirmed',
      },
      vacancy: { id: sampleVacancyId, status: 'Filled' },
      memberCount: 2,
      maxTeamSize: 4,
      availabilityCleared: true,
    });
    expect(res.body.notice).toMatch(/membership is confirmed/i);
    expect(teamsRepository.acceptTeamInvitation).toHaveBeenCalledWith(
      otherParticipant.id,
      invitationId
    );
  });

  it.each([
    {
      name: 'expired invitation',
      code: 'INVITATION_EXPIRED',
      status: 409,
      details: { status: 'Expired' },
    },
    {
      name: 'closed vacancy',
      code: 'VACANCY_NOT_OPEN',
      status: 409,
      details: { vacancyStatus: 'Filled' },
    },
    {
      name: 'full team',
      code: 'CAPACITY_EXCEEDED',
      status: 409,
      details: { current: 4, max: 4 },
    },
    {
      name: 'existing event membership',
      code: 'INVITEE_ALREADY_CONFIRMED',
      status: 409,
      details: { eventId: sampleEventId },
    },
  ])('returns an explicit conflict for $name without a success payload', async (scenario) => {
    vi.spyOn(teamsRepository, 'acceptTeamInvitation').mockRejectedValue({
      message: scenario.code,
      code: 'P0001',
      detail: JSON.stringify(scenario.details),
    });

    const res = await request(app)
      .post(acceptPath)
      .set('Authorization', otherTokenHeader)
      .send({});

    expect(res.status).toBe(scenario.status);
    expect(res.body.code).toBe(scenario.code);
    expect(res.body.details).toEqual(scenario.details);
    expect(res.body).not.toHaveProperty('membership');
  });

  it('returns 403 when a different participant tries to accept', async () => {
    mockVerifyIdToken.mockResolvedValue(validOwnerDecodedToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(ownerParticipant);
    vi.spyOn(teamsRepository, 'acceptTeamInvitation').mockRejectedValue({
      message: 'FORBIDDEN_NOT_INVITEE',
      code: 'P0001',
    });

    const res = await request(app)
      .post(acceptPath)
      .set('Authorization', validTokenHeader)
      .send({});

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_NOT_INVITEE');
    expect(res.body).not.toHaveProperty('membership');
  });

  it('returns a safe 500 response when the acceptance transaction is unavailable', async () => {
    vi.spyOn(teamsRepository, 'acceptTeamInvitation').mockRejectedValue(
      new Error('postgres password=super-secret transport failure')
    );

    const res = await request(app)
      .post(acceptPath)
      .set('Authorization', otherTokenHeader)
      .send({});

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal Server Error');
    expect(JSON.stringify(res.body)).not.toContain('super-secret');
  });
});
