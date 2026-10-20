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
const path = `/api/applications/${applicationId}/decline`;

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
    message: 'Ready to contribute',
    created_at: '2026-10-20T10:00:00.000Z',
    updated_at: '2026-10-20T10:00:00.000Z',
  };
}

function declineResult() {
  const timestamp = '2026-10-20T12:00:00.000Z';
  return {
    application: {
      ...pendingApplication(),
      status: 'Declined' as const,
      cancel_reason: 'OWNER_DECLINED',
      resolved_at: timestamp,
      updated_at: timestamp,
    },
    changed: true,
    idempotent: false,
    teamName: sampleTeam.name,
    vacancyRole: 'Backend',
    alerts: [
      {
        audience: 'applicant' as const,
        type: 'team_application_declined',
        message: 'Your application was declined.',
      },
      {
        audience: 'owner' as const,
        type: 'team_application_declined',
        message: 'You declined an application.',
      },
    ],
    effects: {
      applicationChanged: true,
      applicantAlertCreated: true,
      ownerAlertCreated: true,
      pendingQuotaReleased: true,
      availabilityChanged: false as const,
      membershipChanged: false as const,
      vacancyChanged: false as const,
      capacityChanged: false as const,
    },
    notice: 'Application declined. The applicant was notified.',
  };
}

describe('POST /api/applications/:applicationId/decline (US-020 / #192)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockVerifyIdToken.mockResolvedValue(validOwnerDecodedToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(ownerParticipant);
    vi.spyOn(teamsRepository, 'findApplicationById').mockResolvedValue(pendingApplication());
    vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(sampleTeam);
    vi.spyOn(teamsRepository, 'declineTeamApplication').mockResolvedValue(declineResult());
  });

  it('rejects unauthenticated decline with 401 and performs no mutation', async () => {
    const res = await request(app).post(path).send({});

    expect(res.status).toBe(401);
    expect(teamsRepository.declineTeamApplication).not.toHaveBeenCalled();
  });

  it('rejects malformed application ids with field-specific validation', async () => {
    const res = await request(app)
      .post('/api/applications/not-a-uuid/decline')
      .set('Authorization', validTokenHeader)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      code: 'VALIDATION_ERROR',
      errors: { applicationId: expect.stringMatching(/valid UUID/i) },
    });
    expect(teamsRepository.declineTeamApplication).not.toHaveBeenCalled();
  });

  it('denies a non-owner before the decline transaction', async () => {
    mockVerifyIdToken.mockResolvedValue(validOtherDecodedToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(otherParticipant);

    const res = await request(app)
      .post(path)
      .set('Authorization', otherTokenHeader)
      .send({});

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_NOT_TEAM_OWNER');
    expect(teamsRepository.declineTeamApplication).not.toHaveBeenCalled();
  });

  it('returns Declined, alerts, quota release, and unchanged roster effects', async () => {
    const res = await request(app)
      .post(path)
      .set('Authorization', validTokenHeader)
      .send({});

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({
      decision: 'decline',
      application: {
        id: applicationId,
        status: 'Declined',
        cancelReason: 'OWNER_DECLINED',
      },
      alerts: [
        { audience: 'applicant', type: 'team_application_declined' },
        { audience: 'owner', type: 'team_application_declined' },
      ],
      effects: {
        pendingQuotaReleased: true,
        availabilityChanged: false,
        membershipChanged: false,
        vacancyChanged: false,
        capacityChanged: false,
      },
    });
  });

  it('returns explicit 409 for a stale or already-completed decision', async () => {
    vi.mocked(teamsRepository.declineTeamApplication).mockRejectedValue({
      message: 'APPLICATION_NOT_DECLINABLE',
      code: 'P0001',
      detail: JSON.stringify({ status: 'Accepted' }),
    });

    const res = await request(app)
      .post(path)
      .set('Authorization', validTokenHeader)
      .send({});

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'APPLICATION_NOT_DECLINABLE',
      details: { status: 'Accepted' },
      errors: { _form: expect.stringMatching(/Pending Review/i) },
    });
    expect(res.body).not.toHaveProperty('alerts');
  });

  it('returns a safe 500 when decline or alert persistence fails', async () => {
    vi.mocked(teamsRepository.declineTeamApplication).mockRejectedValue(
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
