/**
 * US-018 application limits and permissions — Integration Suite (#177)
 *
 * Exercises the complete Express pipeline for application submission:
 * Firebase token -> MFA -> active account -> PART role -> verified account ->
 * request validation -> service -> atomic Postgres RPC error mapping.
 *
 * The real Postgres invariants are covered separately by
 * applications.db.integration.test.ts when RUN_DB_INTEGRATION=1. This suite is
 * deterministic and runs offline on every Vitest/CI invocation.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { app } from '../app.js';
import { APPLICATION_MESSAGE_MAX_LENGTH } from '../db/applicationModel.js';
import { participantsRepository } from '../db/participants.repository.js';
import { teamsRepository } from '../db/teams.repository.js';
import type { TeamRequest } from '../db/types.js';
import {
  AUTH_TIME,
  adminParticipant,
  adminTokenHeader,
  otherParticipant,
  otherTokenHeader,
  ownerParticipant,
  sampleEventId,
  sampleParts,
  sampleTeam,
  sampleTeamId,
  sampleVacancy,
  sampleVacancyId,
  validAdminDecodedToken,
  validOtherDecodedToken,
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

const applyPath = `/api/teams/${sampleTeamId}/applications`;
const applicationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function applicationRow(overrides: Partial<TeamRequest> = {}): TeamRequest {
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
    created_at: '2026-10-19T15:00:00.000Z',
    updated_at: '2026-10-19T15:00:00.000Z',
    ...overrides,
  };
}

function mockSuccessfulSubmission(options?: {
  message?: string | null;
  pendingCountForEvent?: number;
  eventId?: string;
}): void {
  const message = options?.message ?? null;
  vi.spyOn(teamsRepository, 'submitTeamApplication').mockResolvedValue({
    application: applicationRow({
      event_id: options?.eventId ?? sampleEventId,
      message,
    }),
    vacancyRole: 'Frontend',
    teamName: 'HackMatch Innovators',
    pendingCountForEvent: options?.pendingCountForEvent ?? 1,
    notice: 'Pending Review application created. The team owner has been notified.',
  });
}

function tokenWithoutMfa(): DecodedIdToken {
  return {
    uid: otherParticipant.firebase_uid,
    email: otherParticipant.email,
    role: 'PART',
    auth_time: AUTH_TIME,
  } as unknown as DecodedIdToken;
}

describe('US-018 Applications Integration Suite (limits and permissions) #177', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockVerifyIdToken.mockReset();
    mockVerifyIdToken.mockResolvedValue(validOtherDecodedToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(otherParticipant);
    vi.spyOn(participantsRepository, 'findById').mockResolvedValue(otherParticipant);
    vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(sampleTeam);
    vi.spyOn(teamsRepository, 'getTeamViewParts').mockResolvedValue({
      ...sampleParts,
      event: {
        max_team_size: 4,
        status: 'Published',
        end_date: '2099-01-01T00:00:00.000Z',
      },
      vacancies: [sampleVacancy],
    });
    vi.spyOn(teamsRepository, 'listConfirmedParticipantIdsForTeam').mockResolvedValue([
      ownerParticipant.id,
    ]);
    vi.spyOn(teamsRepository, 'listConfirmedParticipantIdsForEvent').mockResolvedValue([
      ownerParticipant.id,
    ]);
    vi.spyOn(teamsRepository, 'findPendingApplicationForTeam').mockResolvedValue(null);
    vi.spyOn(teamsRepository, 'countPendingApplicationsForParticipant').mockResolvedValue(0);
    vi.spyOn(teamsRepository, 'countPendingApplicationsForEvent').mockResolvedValue(0);
  });

  describe('happy path and message boundaries', () => {
    it('creates Pending Review state, returns the owner alert notice, and uses authenticated identity', async () => {
      mockSuccessfulSubmission({ message: 'Ready to contribute' });

      const res = await request(app)
        .post(applyPath)
        .set('Authorization', otherTokenHeader)
        .send({ vacancyId: sampleVacancyId, message: '  Ready to contribute  ' });

      expect(res.status).toBe(201);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body.application).toMatchObject({
        id: applicationId,
        applicantParticipantId: otherParticipant.id,
        status: 'Pending',
        requestType: 'Application',
        message: 'Ready to contribute',
        notice: expect.stringMatching(/owner has been notified/i),
      });
      expect(teamsRepository.submitTeamApplication).toHaveBeenCalledWith(
        otherParticipant.id,
        sampleTeamId,
        sampleVacancyId,
        'Ready to contribute'
      );
    });

    it('accepts a message at the exact 250-character boundary', async () => {
      const boundaryMessage = 'x'.repeat(APPLICATION_MESSAGE_MAX_LENGTH);
      mockSuccessfulSubmission({ message: boundaryMessage });

      const res = await request(app)
        .post(applyPath)
        .set('Authorization', otherTokenHeader)
        .send({ vacancyId: sampleVacancyId, message: boundaryMessage });

      expect(res.status).toBe(201);
      expect(teamsRepository.submitTeamApplication).toHaveBeenCalledWith(
        otherParticipant.id,
        sampleTeamId,
        sampleVacancyId,
        boundaryMessage
      );
    });

    it('normalizes an omitted or whitespace-only optional message to null', async () => {
      mockSuccessfulSubmission();

      const res = await request(app)
        .post(applyPath)
        .set('Authorization', otherTokenHeader)
        .send({ vacancyId: sampleVacancyId, message: '   ' });

      expect(res.status).toBe(201);
      expect(teamsRepository.submitTeamApplication).toHaveBeenCalledWith(
        otherParticipant.id,
        sampleTeamId,
        sampleVacancyId,
        null
      );
    });
  });

  describe('server-side input validation', () => {
    it.each([
      {
        name: 'missing vacancyId',
        body: { message: 'Interested' },
        field: 'vacancyId',
      },
      {
        name: 'invalid vacancy UUID',
        body: { vacancyId: 'not-a-uuid', message: 'Interested' },
        field: 'vacancyId',
      },
      {
        name: 'non-string message',
        body: { vacancyId: sampleVacancyId, message: 42 },
        field: 'message',
      },
      {
        name: 'unknown client-controlled participantId',
        body: { vacancyId: sampleVacancyId, participantId: ownerParticipant.id },
        field: 'participantId',
      },
    ])('rejects $name without invoking persistence', async ({ body, field }) => {
      const submitSpy = vi.spyOn(teamsRepository, 'submitTeamApplication');

      const res = await request(app)
        .post(applyPath)
        .set('Authorization', otherTokenHeader)
        .send(body);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors[field]).toBeTruthy();
      expect(res.headers['cache-control']).toBe('no-store');
      expect(submitSpy).not.toHaveBeenCalled();
    });

    it('rejects a 251-character message and performs no write', async () => {
      const submitSpy = vi.spyOn(teamsRepository, 'submitTeamApplication');

      const res = await request(app)
        .post(applyPath)
        .set('Authorization', otherTokenHeader)
        .send({
          vacancyId: sampleVacancyId,
          message: 'x'.repeat(APPLICATION_MESSAGE_MAX_LENGTH + 1),
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors.message).toMatch(/250/);
      expect(submitSpy).not.toHaveBeenCalled();
    });

    it('rejects an invalid team UUID before invoking persistence', async () => {
      const submitSpy = vi.spyOn(teamsRepository, 'submitTeamApplication');

      const res = await request(app)
        .post('/api/teams/not-a-uuid/applications')
        .set('Authorization', otherTokenHeader)
        .send({ vacancyId: sampleVacancyId });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors.teamId).toBeTruthy();
      expect(submitSpy).not.toHaveBeenCalled();
    });
  });

  describe('authentication and participant permissions', () => {
    it('rejects a visitor with 401 before persistence', async () => {
      const submitSpy = vi.spyOn(teamsRepository, 'submitTeamApplication');

      const res = await request(app)
        .post(applyPath)
        .send({ vacancyId: sampleVacancyId });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
      expect(res.headers['www-authenticate']).toContain('Bearer');
      expect(submitSpy).not.toHaveBeenCalled();
    });

    it('returns explicit TOKEN_EXPIRED when Firebase rejects an expired token', async () => {
      mockVerifyIdToken.mockRejectedValue({ code: 'auth/id-token-expired' });

      const res = await request(app)
        .post(applyPath)
        .set('Authorization', otherTokenHeader)
        .send({ vacancyId: sampleVacancyId });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('TOKEN_EXPIRED');
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('rejects a PART without the MFA claim', async () => {
      mockVerifyIdToken.mockResolvedValue(tokenWithoutMfa());

      const res = await request(app)
        .post(applyPath)
        .set('Authorization', otherTokenHeader)
        .send({ vacancyId: sampleVacancyId });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('MFA_REQUIRED');
    });

    it('rejects an ADMIN even when a participant id is supplied in the body', async () => {
      mockVerifyIdToken.mockResolvedValue(validAdminDecodedToken);
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(adminParticipant);
      const submitSpy = vi.spyOn(teamsRepository, 'submitTeamApplication');

      const res = await request(app)
        .post(applyPath)
        .set('Authorization', adminTokenHeader)
        .send({ vacancyId: sampleVacancyId, participantId: otherParticipant.id });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_ROLE');
      expect(submitSpy).not.toHaveBeenCalled();
    });

    it.each([
      {
        name: 'unverified',
        participant: { ...otherParticipant, is_verified: false },
        code: 'EMAIL_NOT_VERIFIED',
      },
      {
        name: 'suspended',
        participant: { ...otherParticipant, is_suspended: true },
        code: 'ACCOUNT_SUSPENDED',
      },
    ])('rejects a $name PART before persistence', async ({ participant, code }) => {
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(participant);
      const submitSpy = vi.spyOn(teamsRepository, 'submitTeamApplication');

      const res = await request(app)
        .post(applyPath)
        .set('Authorization', otherTokenHeader)
        .send({ vacancyId: sampleVacancyId });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe(code);
      expect(submitSpy).not.toHaveBeenCalled();
    });
  });

  describe('atomic application limits and eligibility failures', () => {
    it('allows the third pending application and reports the event count', async () => {
      mockSuccessfulSubmission({ pendingCountForEvent: 3 });

      const res = await request(app)
        .post(applyPath)
        .set('Authorization', otherTokenHeader)
        .send({ vacancyId: sampleVacancyId });

      expect(res.status).toBe(201);
      expect(res.body.application.pendingCountForEvent).toBe(3);
    });

    it('blocks the fourth pending application with count details and no success payload', async () => {
      vi.spyOn(teamsRepository, 'submitTeamApplication').mockRejectedValue({
        message: 'APPLICATION_PENDING_LIMIT',
        code: 'P0001',
        detail: JSON.stringify({
          limit: 3,
          pendingCount: 3,
          eventId: sampleEventId,
        }),
      });

      const res = await request(app)
        .post(applyPath)
        .set('Authorization', otherTokenHeader)
        .send({ vacancyId: sampleVacancyId });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        code: 'APPLICATION_PENDING_LIMIT',
        details: { limit: 3, pendingCount: 3, eventId: sampleEventId },
        errors: { _form: expect.stringMatching(/3 pending applications/i) },
      });
      expect(res.body.application).toBeUndefined();
    });

    it('prioritizes duplicate-team guidance when the applicant is also at the event limit (#176)', async () => {
      vi.spyOn(teamsRepository, 'findPendingApplicationForTeam').mockResolvedValue(
        { id: applicationId }
      );
      const countSpy = vi
        .spyOn(teamsRepository, 'countPendingApplicationsForEvent')
        .mockResolvedValue(3);
      const submitSpy = vi.spyOn(teamsRepository, 'submitTeamApplication');

      const res = await request(app)
        .post(applyPath)
        .set('Authorization', otherTokenHeader)
        .send({ vacancyId: sampleVacancyId, message: 'Keep this draft' });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('DUPLICATE_PENDING_APPLICATION');
      expect(res.body.errors._form).toMatch(/withdraw it or wait/i);
      expect(res.body.details).toMatchObject({
        teamId: sampleTeamId,
        existingApplicationId: applicationId,
      });
      expect(countSpy).not.toHaveBeenCalled();
      expect(submitSpy).not.toHaveBeenCalled();
    });

    it('enforces the atomic 3-pending-application cap platform-wide across teams with distinct backend shadow event_ids', async () => {
      vi.spyOn(teamsRepository, 'countPendingApplicationsForParticipant').mockResolvedValue(3);
      const submitSpy = vi.spyOn(teamsRepository, 'submitTeamApplication');

      const res = await request(app)
        .post(applyPath)
        .set('Authorization', otherTokenHeader)
        .send({ vacancyId: sampleVacancyId });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('APPLICATION_PENDING_LIMIT');
      expect(res.body.errors._form).toMatch(/3 pending applications/i);
      expect(submitSpy).not.toHaveBeenCalled();
    });

    it('allows a participant confirmed on another team to apply to an open slot on target team', async () => {
      vi.spyOn(teamsRepository, 'listConfirmedParticipantIdsForTeam').mockResolvedValue([
        ownerParticipant.id,
      ]);
      mockSuccessfulSubmission();

      const res = await request(app)
        .post(applyPath)
        .set('Authorization', otherTokenHeader)
        .send({ vacancyId: sampleVacancyId });

      expect(res.status).toBe(201);
      expect(res.body.application).toMatchObject({
        status: 'Pending',
        vacancyId: sampleVacancyId,
      });
    });

    it('blocks a participant already confirmed for the target team before the RPC write', async () => {
      vi.spyOn(teamsRepository, 'listConfirmedParticipantIdsForTeam').mockResolvedValue([
        ownerParticipant.id,
        otherParticipant.id,
      ]);
      const submitSpy = vi.spyOn(teamsRepository, 'submitTeamApplication');

      const res = await request(app)
        .post(applyPath)
        .set('Authorization', otherTokenHeader)
        .send({ vacancyId: sampleVacancyId });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('APPLICANT_ALREADY_CONFIRMED');
      expect(submitSpy).not.toHaveBeenCalled();
    });

    it('blocks the team owner from applying before the RPC write', async () => {
      mockVerifyIdToken.mockResolvedValue(validOwnerDecodedToken);
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(ownerParticipant);
      vi.spyOn(participantsRepository, 'findById').mockResolvedValue(ownerParticipant);
      const submitSpy = vi.spyOn(teamsRepository, 'submitTeamApplication');

      const res = await request(app)
        .post(applyPath)
        .set('Authorization', validTokenHeader)
        .send({ vacancyId: sampleVacancyId });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('CANNOT_APPLY_TO_OWN_TEAM');
      expect(submitSpy).not.toHaveBeenCalled();
    });

    it.each([
      {
        name: 'locked team',
        teamStatus: 'Locked' as const,
        vacancies: [sampleVacancy],
        code: 'TEAM_NOT_MUTABLE',
      },
      {
        name: 'filled vacancy',
        teamStatus: 'Open' as const,
        vacancies: [{ ...sampleVacancy, status: 'Filled' as const }],
        code: 'VACANCY_NOT_OPEN',
      },
      {
        name: 'vacancy belonging to no slot on the team',
        teamStatus: 'Open' as const,
        vacancies: [],
        code: 'VACANCY_NOT_FOUND',
      },
    ])('blocks $name before the RPC write', async ({ teamStatus, vacancies, code }) => {
      vi.spyOn(teamsRepository, 'getTeamViewParts').mockResolvedValue({
        ...sampleParts,
        team: { ...sampleTeam, recruitment_status: teamStatus },
        vacancies,
      });
      const submitSpy = vi.spyOn(teamsRepository, 'submitTeamApplication');

      const res = await request(app)
        .post(applyPath)
        .set('Authorization', otherTokenHeader)
        .send({ vacancyId: sampleVacancyId });

      expect(res.status).toBe(code === 'VACANCY_NOT_FOUND' ? 404 : 409);
      expect(res.body.code).toBe(code);
      expect(submitSpy).not.toHaveBeenCalled();
    });

    it('rejects an applicant that fails the server-loaded eligibility check', async () => {
      vi.spyOn(participantsRepository, 'findById').mockResolvedValue({
        ...otherParticipant,
        is_verified: false,
      });
      const submitSpy = vi.spyOn(teamsRepository, 'submitTeamApplication');

      const res = await request(app)
        .post(applyPath)
        .set('Authorization', otherTokenHeader)
        .send({ vacancyId: sampleVacancyId });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('APPLICANT_NOT_ELIGIBLE');
      expect(submitSpy).not.toHaveBeenCalled();
    });

    it.each([
      {
        code: 'DUPLICATE_PENDING_APPLICATION',
        status: 409,
        field: '_form',
      },
      {
        code: 'APPLICANT_ALREADY_CONFIRMED',
        status: 409,
        field: '_form',
      },
      {
        code: 'CANNOT_APPLY_TO_OWN_TEAM',
        status: 400,
        field: '_form',
      },
      {
        code: 'TEAM_NOT_MUTABLE',
        status: 409,
        field: undefined,
      },
      {
        code: 'EVENT_NOT_RECRUITING',
        status: 409,
        field: undefined,
      },
      {
        code: 'VACANCY_NOT_FOUND',
        status: 404,
        field: 'vacancyId',
      },
      {
        code: 'VACANCY_NOT_OPEN',
        status: 409,
        field: 'vacancyId',
      },
      {
        code: 'APPLICANT_NOT_ELIGIBLE',
        status: 403,
        field: '_form',
      },
    ])('maps $code to explicit HTTP $status response', async ({ code, status, field }) => {
      vi.spyOn(teamsRepository, 'submitTeamApplication').mockRejectedValue({
        message: code,
        code: 'P0001',
      });

      const res = await request(app)
        .post(applyPath)
        .set('Authorization', otherTokenHeader)
        .send({ vacancyId: sampleVacancyId });

      expect(res.status).toBe(status);
      expect(res.body.code).toBe(code);
      expect(res.body.error).toEqual(expect.any(String));
      if (field) expect(res.body.errors[field]).toEqual(expect.any(String));
      expect(res.headers['cache-control']).toBe('no-store');
    });
  });

  describe('unexpected dependency failure', () => {
    it('returns a safe 500 response without leaking database details', async () => {
      vi.spyOn(teamsRepository, 'submitTeamApplication').mockRejectedValue(
        new Error('postgres password=do-not-leak')
      );
      vi.spyOn(console, 'error').mockImplementation(() => undefined);

      const res = await request(app)
        .post(applyPath)
        .set('Authorization', otherTokenHeader)
        .send({ vacancyId: sampleVacancyId });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Internal Server Error');
      expect(JSON.stringify(res.body)).not.toContain('do-not-leak');
      expect(res.headers['cache-control']).toBe('no-store');
    });
  });
});
