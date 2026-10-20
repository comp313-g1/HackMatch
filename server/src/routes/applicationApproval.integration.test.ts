/**
 * US-020 approval conflicts and permissions — Integration Suite (#195)
 *
 * Exercises the complete Express approval pipeline without external services:
 * Firebase token -> MFA -> active account -> PART role -> verified account ->
 * request validation -> owner authorization -> atomic Postgres RPC error mapping.
 * Repository responses model the transaction boundary, while the real PostgreSQL
 * functions remain covered by the opt-in DB suite and migration contract tests.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { app } from '../app.js';
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

const applicationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const approvalPath = `/api/applications/${applicationId}/approve`;

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
    message: 'I can help with the frontend.',
    created_at: '2026-10-20T10:00:00.000Z',
    updated_at: '2026-10-20T10:00:00.000Z',
    ...overrides,
  };
}

function committedApproval(options: { teamNowFull?: boolean } = {}) {
  const timestamp = '2026-10-20T12:00:00.000Z';
  const teamNowFull = options.teamNowFull ?? false;

  return {
    approved: true as const,
    changed: true,
    idempotent: false,
    existingOutcome: 'Accepted' as const,
    application: applicationRow({
      status: 'Accepted',
      resolved_at: timestamp,
      updated_at: timestamp,
    }),
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
    vacancy: {
      ...sampleVacancy,
      status: 'Filled' as const,
      updated_at: timestamp,
    },
    teamName: sampleTeam.name,
    vacancyRole: sampleVacancy.role,
    memberCount: teamNowFull ? 4 : 2,
    maxTeamSize: 4,
    availabilityCleared: true,
    membershipCommitted: true,
    cascade: {
      winningRequestId: applicationId,
      eventInvitationsCanceled: 1,
      eventApplicationsWithdrawn: 2,
      slotRequestsCanceled: 1,
      teamRequestsCanceled: teamNowFull ? 3 : 0,
      teamNowFull,
    },
    notice: teamNowFull
      ? 'Application approved. The team is now full and remaining requests were canceled.'
      : 'Application approved. Competing pending requests were cleared.',
  };
}

function tokenWithoutMfa(): DecodedIdToken {
  return {
    uid: ownerParticipant.firebase_uid,
    email: ownerParticipant.email,
    role: 'PART',
    auth_time: AUTH_TIME,
  } as unknown as DecodedIdToken;
}

describe('US-020 Application Approval Integration Suite (conflicts and permissions) #195', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockVerifyIdToken.mockReset();
    mockVerifyIdToken.mockResolvedValue(validOwnerDecodedToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(ownerParticipant);
    vi.spyOn(teamsRepository, 'findApplicationById').mockResolvedValue(applicationRow());
    vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(sampleTeam);
    vi.spyOn(teamsRepository, 'approveTeamApplication').mockResolvedValue(committedApproval());
  });

  describe('happy path and capacity boundary', () => {
    it('authenticates the owner and returns the committed membership and vacancy', async () => {
      const res = await request(app)
        .post(approvalPath)
        .set('Authorization', validTokenHeader)
        .send({ participantId: 'forged-participant-id-is-ignored' });

      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(teamsRepository.approveTeamApplication).toHaveBeenCalledOnce();
      expect(teamsRepository.approveTeamApplication).toHaveBeenCalledWith(
        ownerParticipant.id,
        applicationId
      );
      expect(res.body).toMatchObject({
        approved: true,
        changed: true,
        idempotent: false,
        application: {
          id: applicationId,
          applicantParticipantId: otherParticipant.id,
          status: 'Accepted',
        },
        membership: {
          participantId: otherParticipant.id,
          role: 'Member',
          status: 'Confirmed',
        },
        vacancy: { id: sampleVacancyId, status: 'Filled' },
        availabilityCleared: true,
        membershipCommitted: true,
      });
    });

    it('returns full-team cleanup when approval fills the final roster place', async () => {
      vi.mocked(teamsRepository.approveTeamApplication).mockResolvedValue(
        committedApproval({ teamNowFull: true })
      );

      const res = await request(app)
        .post(approvalPath)
        .set('Authorization', validTokenHeader)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        memberCount: 4,
        maxTeamSize: 4,
        cascade: {
          winningRequestId: applicationId,
          eventInvitationsCanceled: 1,
          eventApplicationsWithdrawn: 2,
          slotRequestsCanceled: 1,
          teamRequestsCanceled: 3,
          teamNowFull: true,
        },
      });
    });

    it('returns an idempotent success without replaying effects for a repeated approval', async () => {
      vi.mocked(teamsRepository.approveTeamApplication).mockResolvedValue({
        ...committedApproval(),
        changed: false,
        idempotent: true,
        cascade: {
          winningRequestId: applicationId,
          eventInvitationsCanceled: 0,
          eventApplicationsWithdrawn: 0,
          slotRequestsCanceled: 0,
          teamRequestsCanceled: 0,
          teamNowFull: false,
        },
        notice: 'Application was already approved. No changes were made.',
      });

      const res = await request(app)
        .post(approvalPath)
        .set('Authorization', validTokenHeader)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        approved: true,
        changed: false,
        idempotent: true,
        existingOutcome: 'Accepted',
        cascade: {
          eventInvitationsCanceled: 0,
          eventApplicationsWithdrawn: 0,
          slotRequestsCanceled: 0,
          teamRequestsCanceled: 0,
        },
      });
    });
  });

  describe('server-side validation and authorization', () => {
    it('rejects a malformed application id before any lookup or mutation', async () => {
      const res = await request(app)
        .post('/api/applications/not-a-uuid/approve')
        .set('Authorization', validTokenHeader)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        code: 'VALIDATION_ERROR',
        errors: { applicationId: expect.stringMatching(/valid UUID/i) },
      });
      expect(teamsRepository.findApplicationById).not.toHaveBeenCalled();
      expect(teamsRepository.approveTeamApplication).not.toHaveBeenCalled();
    });

    it('rejects an unauthenticated visitor before any lookup or mutation', async () => {
      const res = await request(app).post(approvalPath).send({});

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
      expect(res.headers['www-authenticate']).toContain('Bearer');
      expect(teamsRepository.findApplicationById).not.toHaveBeenCalled();
      expect(teamsRepository.approveTeamApplication).not.toHaveBeenCalled();
    });

    it('returns an explicit expired-token response before any lookup or mutation', async () => {
      mockVerifyIdToken.mockRejectedValue({ code: 'auth/id-token-expired' });

      const res = await request(app)
        .post(approvalPath)
        .set('Authorization', validTokenHeader)
        .send({});

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('TOKEN_EXPIRED');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(teamsRepository.findApplicationById).not.toHaveBeenCalled();
      expect(teamsRepository.approveTeamApplication).not.toHaveBeenCalled();
    });

    it('rejects an owner without the MFA claim before any mutation', async () => {
      mockVerifyIdToken.mockResolvedValue(tokenWithoutMfa());

      const res = await request(app)
        .post(approvalPath)
        .set('Authorization', validTokenHeader)
        .send({});

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('MFA_REQUIRED');
      expect(teamsRepository.findApplicationById).not.toHaveBeenCalled();
      expect(teamsRepository.approveTeamApplication).not.toHaveBeenCalled();
    });

    it.each([
      {
        name: 'suspended',
        participant: { ...ownerParticipant, is_suspended: true },
        code: 'ACCOUNT_SUSPENDED',
      },
      {
        name: 'unverified',
        participant: { ...ownerParticipant, is_verified: false },
        code: 'EMAIL_NOT_VERIFIED',
      },
    ])('rejects a $name owner before any mutation', async ({ participant, code }) => {
      vi.mocked(participantsRepository.findByFirebaseUid).mockResolvedValue(participant);

      const res = await request(app)
        .post(approvalPath)
        .set('Authorization', validTokenHeader)
        .send({});

      expect(res.status).toBe(403);
      expect(res.body.code).toBe(code);
      expect(teamsRepository.findApplicationById).not.toHaveBeenCalled();
      expect(teamsRepository.approveTeamApplication).not.toHaveBeenCalled();
    });

    it('rejects an ADMIN even when the body forges the owner participant id', async () => {
      mockVerifyIdToken.mockResolvedValue(validAdminDecodedToken);
      vi.mocked(participantsRepository.findByFirebaseUid).mockResolvedValue(adminParticipant);

      const res = await request(app)
        .post(approvalPath)
        .set('Authorization', adminTokenHeader)
        .send({ actorParticipantId: ownerParticipant.id });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_ROLE');
      expect(teamsRepository.findApplicationById).not.toHaveBeenCalled();
      expect(teamsRepository.approveTeamApplication).not.toHaveBeenCalled();
    });

    it('denies an authenticated non-owner without invoking the approval transaction', async () => {
      mockVerifyIdToken.mockResolvedValue(validOtherDecodedToken);
      vi.mocked(participantsRepository.findByFirebaseUid).mockResolvedValue(otherParticipant);

      const res = await request(app)
        .post(approvalPath)
        .set('Authorization', otherTokenHeader)
        .send({ actorParticipantId: ownerParticipant.id });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_NOT_TEAM_OWNER');
      expect(teamsRepository.approveTeamApplication).not.toHaveBeenCalled();
    });

    it('returns 404 for a missing application without querying a team or mutating state', async () => {
      vi.mocked(teamsRepository.findApplicationById).mockResolvedValue(null);

      const res = await request(app)
        .post(approvalPath)
        .set('Authorization', validTokenHeader)
        .send({});

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({
        code: 'APPLICATION_NOT_FOUND',
        errors: { _form: expect.any(String) },
      });
      expect(teamsRepository.findTeamById).not.toHaveBeenCalled();
      expect(teamsRepository.approveTeamApplication).not.toHaveBeenCalled();
    });
  });

  describe('atomic conflicts and failure handling', () => {
    it.each([
      ['VACANCY_NOT_OPEN', { vacancyStatus: 'Filled' }, 'vacancyId'],
      ['CAPACITY_EXCEEDED', { current: 4, max: 4 }, '_form'],
      ['TEAM_NOT_MUTABLE', { recruitmentStatus: 'Locked' }, '_form'],
      ['EVENT_NOT_RECRUITING', { eventStatus: 'Archived' }, '_form'],
      [
        'APPLICATION_APPLICANT_ALREADY_CONFIRMED',
        { eventId: sampleEventId },
        '_form',
      ],
      ['APPLICATION_APPLICANT_NOT_ELIGIBLE', { reason: 'ACCOUNT_SUSPENDED' }, '_form'],
      ['APPLICATION_NOT_APPROVABLE', { status: 'Withdrawn' }, '_form'],
      [
        'APPLICATION_DECISION_CONFLICT',
        { requestedDecision: 'approve', existingOutcome: 'Declined', retryable: false },
        '_form',
      ],
    ])(
      'returns explicit 409 %s without a partial success payload',
      async (code, details, field) => {
        vi.mocked(teamsRepository.approveTeamApplication).mockRejectedValue({
          message: code,
          code: 'P0001',
          detail: JSON.stringify(details),
        });

        const res = await request(app)
          .post(approvalPath)
          .set('Authorization', validTokenHeader)
          .send({});

        expect(res.status).toBe(409);
        expect(res.body.code).toBe(code);
        expect(res.body.details).toEqual(details);
        if (field) expect(res.body.errors[field]).toEqual(expect.any(String));
        expect(res.body).not.toHaveProperty('membership');
        expect(res.body).not.toHaveProperty('cascade');
        expect(res.headers['cache-control']).toBe('no-store');
      }
    );

    it.each(['40P01', '40001', '55P03'])(
      'maps PostgreSQL concurrency code %s to a retryable 409 response',
      async (databaseCode) => {
        vi.mocked(teamsRepository.approveTeamApplication).mockRejectedValue({
          code: databaseCode,
          message: 'database-internal-detail',
        });

        const res = await request(app)
          .post(approvalPath)
          .set('Authorization', validTokenHeader)
          .send({});

        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({
          code: 'APPLICATION_APPROVAL_CONFLICT',
          details: {
            applicationId,
            reason: 'DATABASE_CONCURRENCY_RETRY',
            retryable: true,
          },
          errors: { _form: expect.stringMatching(/refresh applications/i) },
        });
        expect(JSON.stringify(res.body)).not.toContain('database-internal-detail');
      }
    );

    it('allows one concurrent approval and gives the losing request a clear conflict', async () => {
      vi.mocked(teamsRepository.approveTeamApplication)
        .mockResolvedValueOnce(committedApproval())
        .mockRejectedValueOnce({
          code: '40001',
          message: 'could not serialize access due to concurrent update',
        });

      const [first, second] = await Promise.all([
        request(app).post(approvalPath).set('Authorization', validTokenHeader).send({}),
        request(app).post(approvalPath).set('Authorization', validTokenHeader).send({}),
      ]);
      const responses = [first, second];
      const winner = responses.find((response) => response.status === 200);
      const loser = responses.find((response) => response.status === 409);

      expect(teamsRepository.approveTeamApplication).toHaveBeenCalledTimes(2);
      expect(winner?.body).toMatchObject({
        approved: true,
        membership: { status: 'Confirmed' },
        vacancy: { status: 'Filled' },
      });
      expect(loser?.body).toMatchObject({
        code: 'APPLICATION_APPROVAL_CONFLICT',
        details: { reason: 'DATABASE_CONCURRENCY_RETRY', retryable: true },
      });
      expect(loser?.body).not.toHaveProperty('membership');
    });

    it('returns a safe 500 without leaking persistence details', async () => {
      vi.mocked(teamsRepository.approveTeamApplication).mockRejectedValue(
        new Error('postgres password=do-not-leak')
      );
      vi.spyOn(console, 'error').mockImplementation(() => undefined);

      const res = await request(app)
        .post(approvalPath)
        .set('Authorization', validTokenHeader)
        .send({});

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Internal Server Error');
      expect(JSON.stringify(res.body)).not.toContain('do-not-leak');
      expect(res.headers['cache-control']).toBe('no-store');
    });
  });
});
