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

function mockEligibleApplyContext(overrides?: {
  vacancyStatus?: 'Open' | 'Filled' | 'Removed';
  recruitment_status?: 'Open' | 'Locked' | 'Disbanded';
  confirmedIds?: string[];
  pendingCountForEvent?: number;
}): void {
  vi.spyOn(participantsRepository, 'findById').mockResolvedValue(otherParticipant);
  vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(sampleTeam);
  vi.spyOn(teamsRepository, 'getTeamViewParts').mockResolvedValue({
    ...sampleParts,
    team: {
      ...sampleTeam,
      recruitment_status: overrides?.recruitment_status ?? 'Open',
    },
    event: {
      max_team_size: 4,
      status: 'Published',
      end_date: '2099-01-01T00:00:00.000Z',
    },
    vacancies: [{ ...sampleVacancy, status: overrides?.vacancyStatus ?? 'Open' }],
  });
  vi.spyOn(teamsRepository, 'listConfirmedParticipantIdsForTeam').mockResolvedValue(
    overrides?.confirmedIds ?? [ownerParticipant.id]
  );
  vi.spyOn(teamsRepository, 'listConfirmedParticipantIdsForEvent').mockResolvedValue(
    overrides?.confirmedIds ?? [ownerParticipant.id]
  );
  vi.spyOn(teamsRepository, 'countPendingApplicationsForParticipant').mockResolvedValue(
    overrides?.pendingCountForEvent ?? 0
  );
  vi.spyOn(teamsRepository, 'countPendingApplicationsForEvent').mockResolvedValue(
    overrides?.pendingCountForEvent ?? 0
  );
  vi.spyOn(teamsRepository, 'findPendingApplicationForTeam').mockResolvedValue(null);
}

describe('POST /api/teams/:teamId/applications (US-018 / #172 / #173)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockVerifyIdToken.mockResolvedValue(validOtherDecodedToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(otherParticipant);
    mockEligibleApplyContext();
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

  it('accepts slotId alias for vacancyId in request body', async () => {
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
        message: null,
        created_at: '2026-10-19T15:00:00.000Z',
        updated_at: '2026-10-19T15:00:00.000Z',
      },
      vacancyRole: 'Frontend',
      teamName: 'HackMatch Innovators',
      pendingCountForEvent: 1,
      notice: 'Pending Review application created.',
    });

    const res = await request(app)
      .post(applyPath)
      .set('Authorization', otherTokenHeader)
      .send({
        slotId: sampleVacancyId,
      });

    expect(res.status).toBe(201);
    expect(teamsRepository.submitTeamApplication).toHaveBeenCalledWith(
      otherParticipant.id,
      sampleTeamId,
      sampleVacancyId,
      null
    );
  });

  it('rejects eventId in request body as unknown field', async () => {
    const res = await request(app)
      .post(applyPath)
      .set('Authorization', otherTokenHeader)
      .send({
        vacancyId: sampleVacancyId,
        eventId: sampleEventId,
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.errors.eventId).toBeTruthy();
  });

  it('returns 409 APPLICATION_PENDING_LIMIT from Express quota preflight (#174 / T4)', async () => {
    mockEligibleApplyContext({ pendingCountForEvent: 3 });
    const rpcSpy = vi.spyOn(teamsRepository, 'submitTeamApplication');

    const res = await request(app)
      .post(applyPath)
      .set('Authorization', otherTokenHeader)
      .send({ vacancyId: sampleVacancyId, message: null });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('APPLICATION_PENDING_LIMIT');
    expect(res.body.errors._form).toMatch(/3 pending/i);
    expect(res.body.errors._form).toMatch(/withdraw one or wait/i);
    expect(res.body.details).toMatchObject({ limit: 3, pendingCount: 3 });
    expect(rpcSpy).not.toHaveBeenCalled();
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
    expect(res.body.errors._form).toMatch(/withdraw it or wait/i);
  });

  it('returns the duplicate error before the event limit when both conditions apply (#176)', async () => {
    mockEligibleApplyContext({ pendingCountForEvent: 3 });
    vi.spyOn(teamsRepository, 'findPendingApplicationForTeam').mockResolvedValue({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
    const rpcSpy = vi.spyOn(teamsRepository, 'submitTeamApplication');

    const res = await request(app)
      .post(applyPath)
      .set('Authorization', otherTokenHeader)
      .send({ vacancyId: sampleVacancyId });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DUPLICATE_PENDING_APPLICATION');
    expect(res.body.details).toEqual({
      teamId: sampleTeamId,
      existingApplicationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
    expect(res.body.errors._form).toMatch(/withdraw it or wait/i);
    expect(rpcSpy).not.toHaveBeenCalled();
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

  it('rejects owner applying to own team via Express preflight (#173)', async () => {
    mockVerifyIdToken.mockResolvedValue(validOwnerDecodedToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(ownerParticipant);
    vi.spyOn(participantsRepository, 'findById').mockResolvedValue(ownerParticipant);
    vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(sampleTeam);
    const rpcSpy = vi.spyOn(teamsRepository, 'submitTeamApplication');

    const res = await request(app)
      .post(applyPath)
      .set('Authorization', validTokenHeader)
      .send({ vacancyId: sampleVacancyId });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CANNOT_APPLY_TO_OWN_TEAM');
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('rejects locked team with 409 TEAM_NOT_MUTABLE (#173)', async () => {
    mockEligibleApplyContext({ recruitment_status: 'Locked' });
    const rpcSpy = vi.spyOn(teamsRepository, 'submitTeamApplication');

    const res = await request(app)
      .post(applyPath)
      .set('Authorization', otherTokenHeader)
      .send({ vacancyId: sampleVacancyId });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('TEAM_NOT_MUTABLE');
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('rejects filled vacancy with 409 VACANCY_NOT_OPEN (#173)', async () => {
    mockEligibleApplyContext({ vacancyStatus: 'Filled' });
    const rpcSpy = vi.spyOn(teamsRepository, 'submitTeamApplication');

    const res = await request(app)
      .post(applyPath)
      .set('Authorization', otherTokenHeader)
      .send({ vacancyId: sampleVacancyId });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('VACANCY_NOT_OPEN');
    expect(res.body.errors.vacancyId).toBeTruthy();
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('rejects confirmed event member with 409 APPLICANT_ALREADY_CONFIRMED (#173 / T6)', async () => {
    mockEligibleApplyContext({
      confirmedIds: [ownerParticipant.id, otherParticipant.id],
    });
    const rpcSpy = vi.spyOn(teamsRepository, 'submitTeamApplication');

    const res = await request(app)
      .post(applyPath)
      .set('Authorization', otherTokenHeader)
      .send({ vacancyId: sampleVacancyId });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('APPLICANT_ALREADY_CONFIRMED');
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('returns safe 500 when the duplicate lookup fails and does not attempt the RPC', async () => {
    vi.spyOn(teamsRepository, 'findPendingApplicationForTeam').mockRejectedValue(
      new Error('database password=do-not-leak')
    );
    const rpcSpy = vi.spyOn(teamsRepository, 'submitTeamApplication');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await request(app)
      .post(applyPath)
      .set('Authorization', otherTokenHeader)
      .send({ vacancyId: sampleVacancyId });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal Server Error');
    expect(JSON.stringify(res.body)).not.toContain('do-not-leak');
    expect(rpcSpy).not.toHaveBeenCalled();
  });
});
