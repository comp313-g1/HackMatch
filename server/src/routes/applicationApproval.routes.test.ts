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
import type { TeamRequest } from '../db/types.js';

const mockVerifyIdToken = vi.fn();

vi.mock('../config/firebase.js', () => {
  const authMock = { verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args) };
  return {
    firebaseAuth: authMock,
    auth: authMock,
    getFirebaseAdminAuth: vi.fn(),
    verifyEmailActionCode: vi.fn(),
    sendVerificationEmail: vi.fn(),
    _resetFirebaseInstances: vi.fn(),
  };
});

const applicationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const path = `/api/applications/${applicationId}/approve`;

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
    message: null,
    created_at: '2026-10-20T10:00:00.000Z',
    updated_at: '2026-10-20T10:00:00.000Z',
  };
}

function approvalResult() {
  const timestamp = '2026-10-20T12:00:00.000Z';
  return {
    approved: true as const,
    application: {
      ...pendingApplication(),
      status: 'Accepted' as const,
      resolved_at: timestamp,
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
    vacancy: { ...sampleVacancy, status: 'Filled' as const },
    teamName: sampleTeam.name,
    vacancyRole: sampleVacancy.role,
    memberCount: 2,
    maxTeamSize: 4,
    availabilityCleared: true,
    membershipCommitted: true,
    cascade: {
      winningRequestId: applicationId,
      eventInvitationsCanceled: 1,
      eventApplicationsWithdrawn: 2,
      slotRequestsCanceled: 1,
      teamRequestsCanceled: 0,
      teamNowFull: false,
    },
    notice: 'Application approved. Competing pending requests were cleared.',
  };
}

describe('POST /api/applications/:applicationId/approve (US-020 / #190 / #191)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockVerifyIdToken.mockResolvedValue(validOwnerDecodedToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(ownerParticipant);
    vi.spyOn(teamsRepository, 'findApplicationById').mockResolvedValue(pendingApplication());
    vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(sampleTeam);
    vi.spyOn(teamsRepository, 'approveTeamApplication').mockResolvedValue(approvalResult());
  });

  it('rejects unauthenticated approval with 401', async () => {
    const res = await request(app).post(path).send({});

    expect(res.status).toBe(401);
    expect(teamsRepository.approveTeamApplication).not.toHaveBeenCalled();
  });

  it('rejects malformed application ids with field-specific validation', async () => {
    const res = await request(app)
      .post('/api/applications/not-a-uuid/approve')
      .set('Authorization', validTokenHeader)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      code: 'VALIDATION_ERROR',
      errors: { applicationId: expect.stringMatching(/valid UUID/i) },
    });
    expect(teamsRepository.approveTeamApplication).not.toHaveBeenCalled();
  });

  it('denies a non-owner before the approval transaction', async () => {
    mockVerifyIdToken.mockResolvedValue(validOtherDecodedToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(otherParticipant);

    const res = await request(app)
      .post(path)
      .set('Authorization', otherTokenHeader)
      .send({});

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_NOT_TEAM_OWNER');
    expect(teamsRepository.approveTeamApplication).not.toHaveBeenCalled();
  });

  it('returns the confirmed membership and filled vacancy on success', async () => {
    const res = await request(app)
      .post(path)
      .set('Authorization', validTokenHeader)
      .send({});

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({
      approved: true,
      application: { id: applicationId, status: 'Accepted' },
      membership: {
        participantId: otherParticipant.id,
        role: 'Member',
        status: 'Confirmed',
      },
      vacancy: { id: sampleVacancyId, status: 'Filled' },
      memberCount: 2,
      maxTeamSize: 4,
      availabilityCleared: true,
      cascade: {
        winningRequestId: applicationId,
        eventInvitationsCanceled: 1,
        eventApplicationsWithdrawn: 2,
        slotRequestsCanceled: 1,
        teamRequestsCanceled: 0,
        teamNowFull: false,
      },
    });
  });

  it.each([
    ['VACANCY_NOT_OPEN', { vacancyStatus: 'Filled' }],
    ['CAPACITY_EXCEEDED', { current: 4, max: 4 }],
    ['APPLICATION_APPLICANT_ALREADY_CONFIRMED', { eventId: sampleEventId }],
    ['APPLICATION_APPLICANT_NOT_ELIGIBLE', {}],
    ['APPLICATION_NOT_APPROVABLE', { status: 'Withdrawn' }],
    ['APPLICATION_APPROVAL_CONFLICT', { reason: 'DATABASE_CONCURRENCY_RETRY' }],
  ])('returns explicit 409 %s without a success payload', async (code, details) => {
    vi.mocked(teamsRepository.approveTeamApplication).mockRejectedValue({
      message: code,
      code: 'P0001',
      detail: JSON.stringify(details),
    });

    const res = await request(app)
      .post(path)
      .set('Authorization', validTokenHeader)
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.code).toBe(code);
    expect(res.body.details).toEqual(details);
    expect(res.body).not.toHaveProperty('membership');
  });

  it('returns a safe 500 when the transaction is unavailable', async () => {
    vi.mocked(teamsRepository.approveTeamApplication).mockRejectedValue(
      new Error('postgres password=do-not-leak')
    );
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await request(app)
      .post(path)
      .set('Authorization', validTokenHeader)
      .send({});

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal Server Error');
    expect(JSON.stringify(res.body)).not.toContain('do-not-leak');
  });
});

