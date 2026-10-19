import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import { MFA_CLAIM } from '../utils/mfaClaim.js';
import type { Participant } from '../db/types.js';

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

const AUTH_TIME = Math.floor(Date.now() / 1000) - 30;

describe('POST /api/scoring/compatibility (US-015 FR-043–045)', () => {
  const verifiedParticipant: Participant = {
    id: '11111111-1111-4111-8111-111111111111',
    firebase_uid: 'fb-verified-1',
    email: 'part@example.com',
    full_name: 'Verified Participant',
    role: 'PART',
    is_verified: true,
    is_suspended: false,
    created_at: '2026-10-18T00:00:00.000Z',
    updated_at: '2026-10-18T00:00:00.000Z',
  };

  const validDecodedToken = {
    uid: 'fb-verified-1',
    email: 'part@example.com',
    role: 'PART',
    auth_time: AUTH_TIME,
    [MFA_CLAIM]: AUTH_TIME,
  } as unknown as DecodedIdToken;

  const authHeader = 'Bearer valid-mfa-token';

  const happyBody = {
    slot: {
      role: 'Frontend',
      requiredSkills: ['React', 'TypeScript', 'CSS', 'Testing'],
      requestedHours: 20,
      goal: 'Project Completion',
    },
    candidate: {
      primaryRole: 'Frontend',
      skills: ['React', 'TypeScript'],
      commitmentHours: 10,
      goal: 'Project Completion',
      displayHandle: 'alice',
    },
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    mockVerifyIdToken.mockResolvedValue(validDecodedToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(verifiedParticipant);
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).post('/api/scoring/compatibility').send(happyBody);
    expect(res.status).toBe(401);
  });

  it('returns 70.0 with explainable contributions on the FR-045 example', async () => {
    const res = await request(app)
      .post('/api/scoring/compatibility')
      .set('Authorization', authHeader)
      .send(happyBody);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.displayScore).toBe('70.0');
    expect(res.body.components).toEqual({
      skill: expect.closeTo(0.6, 5),
      goal: 1,
      hours: expect.closeTo(0.5, 5),
    });
    expect(res.body.contributions.skill).toMatch(/Matched 2 of 4/);
    expect(res.body.hadMissingInput).toBe(false);
    expect(res.body.notice).toMatch(/self-declared/);
  });

  it('returns 400 with field errors and submitted payload when role is invalid', async () => {
    const body = {
      ...happyBody,
      slot: { ...happyBody.slot, role: 'Wizard' },
    };
    const res = await request(app)
      .post('/api/scoring/compatibility')
      .set('Authorization', authHeader)
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('COMPATIBILITY_SCORE_VALIDATION');
    expect(res.body.errors.role).toBeTruthy();
    expect(res.body.submitted).toEqual(body);
  });

  it('scores missing goal/hours as 0 and flags hadMissingInput (success path)', async () => {
    const res = await request(app)
      .post('/api/scoring/compatibility')
      .set('Authorization', authHeader)
      .send({
        slot: {
          role: 'Backend',
          requiredSkills: ['Go'],
          requestedHours: 15,
          goal: 'Competitive',
        },
        candidate: {
          primaryRole: 'Backend',
          skills: ['Go'],
          commitmentHours: null,
          goal: null,
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.hadMissingInput).toBe(true);
    expect(res.body.components.goal).toBe(0);
    expect(res.body.components.hours).toBe(0);
    expect(res.body.displayScore).toBe('33.3');
    expect(res.body.contributions.goal).toMatch(/scored 0/);
  });
});
