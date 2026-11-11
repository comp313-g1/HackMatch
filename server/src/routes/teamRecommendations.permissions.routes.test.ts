/**
 * US-016 / #158 — permission checks for the participant's own profile on
 * GET /api/recommendations/teams: only the signed-in participant, never a client-named identity.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import { profileRepository } from '../db/profile.repository.js';
import { teamRecommendationsRepository } from '../db/teamRecommendations.repository.js';
import { availabilityRepository } from '../repositories/availability.repository.js';
import type { Participant } from '../db/types.js';
import { MFA_CLAIM } from '../utils/mfaClaim.js';

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

const ME = '1111aaaa-1111-4111-8111-1111111111bb';
const OTHER = '9999eeee-9999-4999-8999-9999999999ff';
const AUTH_TIME = Math.floor(Date.now() / 1000) - 30;
const URL = '/api/recommendations/teams';
const AUTH = { Authorization: 'Bearer valid-token' };

function participant(over: Partial<Participant> = {}): Participant {
  return {
    id: ME,
    firebase_uid: 'fb-me',
    email: 'me@example.test',
    full_name: 'Me',
    role: 'PART',
    is_verified: true,
    is_suspended: false,
    is_deactivated: false,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function decoded(over: Record<string, unknown> = {}): DecodedIdToken {
  return { uid: 'fb-me', email: 'me@example.test', role: 'PART', auth_time: AUTH_TIME, [MFA_CLAIM]: AUTH_TIME, ...over } as unknown as DecodedIdToken;
}

describe('own-profile permission checks on recommended teams (US-016 / #158)', () => {
  const eligible = () => vi.spyOn(teamRecommendationsRepository, 'listEligibleTeamVacanciesForParticipant');

  beforeEach(() => {
    vi.restoreAllMocks();
    mockVerifyIdToken.mockResolvedValue(decoded());
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(participant());
    vi.spyOn(participantsRepository, 'findById').mockResolvedValue(participant());
    vi.spyOn(profileRepository, 'findProfileByParticipantId').mockResolvedValue({
      participant_id: ME, handle: 'me_dev', primary_role: 'Backend', institution: null, shared_contact_handle: null,
      moderation_status: 'None', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
    });
    vi.spyOn(profileRepository, 'findSkillsByParticipantId').mockResolvedValue([
      { id: '55555555-5555-4555-8555-555555555555', participant_id: ME, skill_name: 'Node.js', created_at: '2026-01-01T00:00:00.000Z' },
    ]);
    vi.spyOn(availabilityRepository, 'findByParticipantId').mockResolvedValue({
      participantId: ME, isLooking: true, desiredRole: 'Backend', commitmentHours: 10, goal: 'Learning', updatedAt: null,
    });
    eligible().mockResolvedValue({ candidates: [], pendingRequestTeamIds: new Set() });
  });

  /** Nothing about anyone's profile may be read or queried when a request is refused. */
  function expectNothingRead(): void {
    expect(teamRecommendationsRepository.listEligibleTeamVacanciesForParticipant).not.toHaveBeenCalled();
    expect(profileRepository.findProfileByParticipantId).not.toHaveBeenCalled();
    expect(profileRepository.findSkillsByParticipantId).not.toHaveBeenCalled();
    expect(availabilityRepository.findByParticipantId).not.toHaveBeenCalled();
  }

  describe('happy path', () => {
    it('serves the signed-in participant when no identity is named', async () => {
      const response = await request(app).get(URL).set(AUTH);
      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(teamRecommendationsRepository.listEligibleTeamVacanciesForParticipant).toHaveBeenCalledTimes(1);
      expect(teamRecommendationsRepository.listEligibleTeamVacanciesForParticipant).toHaveBeenCalledWith(ME);
      expect(profileRepository.findProfileByParticipantId).toHaveBeenCalledWith(ME);
      expect(availabilityRepository.findByParticipantId).toHaveBeenCalledWith(ME);
    });

    it('still serves the participant when they name their own id, in query or body', async () => {
      const inQuery = await request(app).get(`${URL}?participantId=${ME}`).set(AUTH);
      expect(inQuery.status).toBe(200);
      const inBody = await request(app).get(URL).set(AUTH).send({ participantId: ME.toUpperCase() });
      expect(inBody.status).toBe(200);
      for (const call of eligible().mock.calls) expect(call[0]).toBe(ME);
    });

    it('never uses a client-supplied identity to choose whose data is read', async () => {
      await request(app).get(`${URL}?participantId=${ME}&eventId=88888888-8888-4888-8888-888888888888`).set(AUTH);
      expect(participantsRepository.findById).toHaveBeenCalledWith(ME);
    });
  });

  describe('another participant (403)', () => {
    it.each([
      ['participantId in the query', (r: request.Test) => r.query({ participantId: OTHER })],
      ['participant_id in the query', (r: request.Test) => r.query({ participant_id: OTHER })],
      ['userId in the query', (r: request.Test) => r.query({ userId: OTHER })],
      ['accountId in the query', (r: request.Test) => r.query({ accountId: OTHER })],
      ['profileId in the query', (r: request.Test) => r.query({ profileId: OTHER })],
      ['participantId in the body', (r: request.Test) => r.send({ participantId: OTHER })],
      ['firebaseUid in the query', (r: request.Test) => r.query({ firebaseUid: 'fb-someone-else' })],
    ])('refuses %s with 403 and reads nothing', async (_label, shape) => {
      const response = await shape(request(app).get(URL).set(AUTH));
      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        error: 'You can only view recommendations for your own profile.',
        code: 'FORBIDDEN_NOT_OWN_PROFILE',
      });
      expect(response.headers['cache-control']).toBe('no-store');
      expectNothingRead();
    });

    it('does not say whether the other participant exists, and does not repeat the id', async () => {
      const response = await request(app).get(`${URL}?participantId=${OTHER}`).set(AUTH);
      expect(JSON.stringify(response.body)).not.toContain(OTHER);
      expect(participantsRepository.findById).not.toHaveBeenCalledWith(OTHER);
    });

    it('refuses when the caller names themselves and someone else together', async () => {
      const response = await request(app).get(`${URL}?participantId=${ME}&userId=${OTHER}`).set(AUTH);
      expect(response.status).toBe(403);
      expectNothingRead();
    });
  });

  describe('invalid input (400)', () => {
    it.each([
      ['not an id', 'someone-else'],
      ['blank', ''],
      ['almost an id', `${ME}0`],
    ])('refuses a participantId that is %s', async (_label, value) => {
      const response = await request(app).get(URL).set(AUTH).query({ participantId: value });
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_ERROR', errors: { participantId: expect.any(String) } });
      expect(response.headers['cache-control']).toBe('no-store');
      expectNothingRead();
    });

    it('refuses a repeated participantId (a list)', async () => {
      const response = await request(app).get(`${URL}?participantId=${ME}&participantId=${OTHER}`).set(AUTH);
      expect(response.status).toBe(400);
      expectNothingRead();
    });

    it('refuses a participantId in the body that is not text', async () => {
      const response = await request(app).get(URL).set(AUTH).send({ participantId: 42 });
      expect(response.status).toBe(400);
      expectNothingRead();
    });
  });

  describe('unauthorized access', () => {
    it('refuses a visitor with no token before looking at anything else', async () => {
      const response = await request(app).get(`${URL}?participantId=${OTHER}`);
      expect(response.status).toBe(401);
      expect(response.body.code).toBe('UNAUTHORIZED');
      expectNothingRead();
    });

    it('refuses an invalid token with 401, not 403', async () => {
      mockVerifyIdToken.mockRejectedValue(Object.assign(new Error('Decoding Firebase ID token failed'), { code: 'auth/argument-error' }));
      const response = await request(app).get(`${URL}?participantId=${OTHER}`).set(AUTH);
      expect(response.status).toBe(401);
      expectNothingRead();
    });

    it('requires the email code: a session without it is refused first', async () => {
      mockVerifyIdToken.mockResolvedValue(decoded({ [MFA_CLAIM]: undefined }));
      const response = await request(app).get(`${URL}?participantId=${OTHER}`).set(AUTH);
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('MFA_REQUIRED');
      expectNothingRead();
    });

    it('refuses an ADMIN with the role error, even when they name a participant', async () => {
      mockVerifyIdToken.mockResolvedValue(decoded({ uid: 'fb-admin', role: 'ADMIN' }));
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(participant({ id: OTHER, firebase_uid: 'fb-admin', role: 'ADMIN' }));
      const response = await request(app).get(`${URL}?participantId=${ME}`).set(AUTH);
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('FORBIDDEN_ROLE');
      expectNothingRead();
    });

    it('reports a suspended account as suspended, not as a profile mismatch', async () => {
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(participant({ is_suspended: true }));
      const response = await request(app).get(`${URL}?participantId=${OTHER}`).set(AUTH);
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('ACCOUNT_SUSPENDED');
      expectNothingRead();
    });

    it('reports an unverified account as unverified, not as a profile mismatch', async () => {
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(participant({ is_verified: false }));
      const response = await request(app).get(`${URL}?participantId=${OTHER}`).set(AUTH);
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('EMAIL_NOT_VERIFIED');
      expectNothingRead();
    });
  });

  describe('failure handling', () => {
    it('reports an unexpected storage failure as a server error, never as a permission answer', async () => {
      eligible().mockRejectedValue(new Error('database is down'));
      const response = await request(app).get(`${URL}?participantId=${ME}`).set(AUTH);
      expect(response.status).toBe(500);
      expect(JSON.stringify(response.body)).not.toContain('database is down');
    });

    it('offers no way to change recommendations: other methods are not available', async () => {
      for (const method of ['post', 'put', 'delete', 'patch'] as const) {
        const response = await request(app)[method](URL).set(AUTH).send({ participantId: OTHER });
        expect(response.status).toBe(404);
      }
      expectNothingRead();
    });
  });
});
