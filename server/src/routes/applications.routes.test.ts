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
  validOtherDecodedToken,
  validOwnerDecodedToken,
  otherTokenHeader,
  validTokenHeader,
  AUTH_TIME,
} from './team.testUtils.js';
import type { DecodedIdToken } from 'firebase-admin/auth';

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

const applyPath = `/api/teams/${sampleTeamId}/applications`;

describe('POST /api/teams/:teamId/applications (US-018 / #172)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockVerifyIdToken.mockResolvedValue(validOtherDecodedToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(otherParticipant);
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).post(applyPath).send({
      vacancyId: sampleVacancyId,
      message: 'hi',
    });
    expect(res.status).toBe(401);
  });

  it('rejects missing MFA with 403 MFA_REQUIRED', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: otherParticipant.firebase_uid,
      email: otherParticipant.email,
      role: 'PART',
      auth_time: AUTH_TIME,
    } as unknown as DecodedIdToken);

    const res = await request(app)
      .post(applyPath)
      .set('Authorization', otherTokenHeader)
      .send({ vacancyId: sampleVacancyId });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('MFA_REQUIRED');
  });

  it('rejects invalid vacancy UUID with 400 and field errors (draft kept by client)', async () => {
    const res = await request(app)
      .post(applyPath)
      .set('Authorization', otherTokenHeader)
      .send({ vacancyId: 'bad', message: 'still here' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.errors.vacancyId).toBeTruthy();
  });

  it('rejects message longer than 250 characters with 400 field error', async () => {
    const res = await request(app)
      .post(applyPath)
      .set('Authorization', otherTokenHeader)
      .send({
        vacancyId: sampleVacancyId,
        message: 'x'.repeat(251),
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.errors.message).toMatch(/250/i);
  });

  it('creates Pending Review application (happy path / atomic RPC)', async () => {
    vi.spyOn(teamsRepository, 'submitTeamApplication').mockResolvedValue({
      application: {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
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
        created_at: '2026-10-19T15:00:00.000Z',
        updated_at: '2026-10-19T15:00:00.000Z',
      },
      vacancyRole: 'Frontend',
      teamName: 'HackMatch Innovators',
      pendingCountForEvent: 1,
      notice: 'Pending Review application created. The team owner has been notified.',
    });

    const res = await request(app)
      .post(applyPath)
      .set('Authorization', otherTokenHeader)
      .send({
        vacancyId: sampleVacancyId,
        message: 'Ready to contribute',
      });

    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.application).toMatchObject({
      status: 'Pending',
      requestType: 'Application',
      vacancyId: sampleVacancyId,
      message: 'Ready to contribute',
      pendingCountForEvent: 1,
    });
    expect(teamsRepository.submitTeamApplication).toHaveBeenCalledWith(
      otherParticipant.id,
      sampleTeamId,
      sampleVacancyId,
      'Ready to contribute'
    );
  });

  it('returns 409 APPLICATION_PENDING_LIMIT when RPC enforces 3-pending cap (FR-054)', async () => {
    vi.spyOn(teamsRepository, 'submitTeamApplication').mockRejectedValue({
      message: 'APPLICATION_PENDING_LIMIT',
      code: 'P0001',
      detail: JSON.stringify({ limit: 3, pendingCount: 3 }),
    });

    const res = await request(app)
      .post(applyPath)
      .set('Authorization', otherTokenHeader)
      .send({ vacancyId: sampleVacancyId, message: null });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('APPLICATION_PENDING_LIMIT');
    expect(res.body.errors._form).toMatch(/3 pending/i);
  });

  it('returns 409 DUPLICATE_PENDING_APPLICATION for second pending on same team', async () => {
    vi.spyOn(teamsRepository, 'submitTeamApplication').mockRejectedValue({
      message: 'DUPLICATE_PENDING_APPLICATION',
      code: 'P0001',
    });

    const res = await request(app)
      .post(applyPath)
      .set('Authorization', otherTokenHeader)
      .send({ vacancyId: sampleVacancyId });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DUPLICATE_PENDING_APPLICATION');
  });

  it('returns 409 VACANCY_NOT_OPEN with vacancyId field error', async () => {
    vi.spyOn(teamsRepository, 'submitTeamApplication').mockRejectedValue({
      message: 'VACANCY_NOT_OPEN',
      code: 'P0001',
    });

    const res = await request(app)
      .post(applyPath)
      .set('Authorization', otherTokenHeader)
      .send({ vacancyId: sampleVacancyId });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('VACANCY_NOT_OPEN');
    expect(res.body.errors.vacancyId).toBeTruthy();
  });

  it('rejects unverified applicant with 403 EMAIL_NOT_VERIFIED', async () => {
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue({
      ...otherParticipant,
      is_verified: false,
    });

    const res = await request(app)
      .post(applyPath)
      .set('Authorization', otherTokenHeader)
      .send({ vacancyId: sampleVacancyId });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('allows owner token path only if not applying as owner — owner applying is 400 from RPC', async () => {
    mockVerifyIdToken.mockResolvedValue(validOwnerDecodedToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(ownerParticipant);
    vi.spyOn(teamsRepository, 'submitTeamApplication').mockRejectedValue({
      message: 'CANNOT_APPLY_TO_OWN_TEAM',
      code: 'P0001',
    });

    const res = await request(app)
      .post(applyPath)
      .set('Authorization', validTokenHeader)
      .send({ vacancyId: sampleVacancyId });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CANNOT_APPLY_TO_OWN_TEAM');
  });
});
