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

const ME = '11111111-1111-4111-8111-111111111111';
const TEAM = '22222222-2222-4222-8222-222222222222';
const OWNER = '33333333-3333-4333-8333-333333333333';
const VACANCY = '44444444-4444-4444-8444-444444444444';
const AUTH_TIME = Math.floor(Date.now() / 1000) - 30;

function participant(over: Partial<Participant> = {}): Participant {
  return {
    id: ME,
    firebase_uid: 'fb-me',
    email: 'never-return@example.test',
    full_name: 'Current Participant',
    role: 'PART',
    is_verified: true,
    is_suspended: false,
    is_deactivated: false,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function decoded(role: 'PART' | 'ADMIN' = 'PART'): DecodedIdToken {
  return {
    uid: role === 'PART' ? 'fb-me' : 'fb-admin',
    email: role === 'PART' ? 'never-return@example.test' : 'admin@example.test',
    role,
    auth_time: AUTH_TIME,
    [MFA_CLAIM]: AUTH_TIME,
  } as unknown as DecodedIdToken;
}

describe('GET /api/recommendations/teams (US-016 / #154)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockVerifyIdToken.mockResolvedValue(decoded());
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(participant());
    vi.spyOn(participantsRepository, 'findById').mockResolvedValue(participant());
    vi.spyOn(profileRepository, 'findProfileByParticipantId').mockResolvedValue({
      participant_id: ME,
      handle: 'me_dev',
      primary_role: 'Backend',
      institution: null,
      shared_contact_handle: null,
      moderation_status: 'None',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });
    vi.spyOn(profileRepository, 'findSkillsByParticipantId').mockResolvedValue([
      { id: '55555555-5555-4555-8555-555555555555', participant_id: ME, skill_name: 'Node.js', created_at: '2026-01-01T00:00:00.000Z' },
    ]);
    vi.spyOn(availabilityRepository, 'findByParticipantId').mockResolvedValue({
      participantId: ME,
      isLooking: true,
      desiredRole: 'Backend',
      commitmentHours: 10,
      goal: 'Learning',
      updatedAt: null,
    });
    vi.spyOn(teamRecommendationsRepository, 'listEligibleTeamVacanciesForParticipant').mockResolvedValue({
      candidates: [
        {
          team: {
            id: TEAM,
            owner_participant_id: OWNER,
            name: 'Safe Team',
            pitch: 'Safe public pitch',
            goal: 'Learning',
            commitment_hours: 10,
            recruitment_status: 'Open',
            locked_at: null,
            disbanded_at: null,
            moderation_hidden_at: null,
            moderation_status: 'None',
            created_at: '2026-01-01T00:00:00.000Z',
          },
          vacancy: {
            id: VACANCY,
            team_id: TEAM,
            role: 'Backend',
            skills: ['Node.js'],
            status: 'Open',
            removed_at: null,
            created_at: '2026-01-01T00:00:00.000Z',
          },
          confirmedMemberIds: new Set([OWNER]),
        },
      ],
      pendingRequestTeamIds: new Set(),
    });
  });

  it('denies an unauthenticated visitor', async () => {
    const response = await request(app).get('/api/recommendations/teams');
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('UNAUTHORIZED');
    expect(teamRecommendationsRepository.listEligibleTeamVacanciesForParticipant).not.toHaveBeenCalled();
  });

  it('denies an ADMIN instead of accepting a client-selected participant identity', async () => {
    const admin = participant({
      id: '66666666-6666-4666-8666-666666666666',
      firebase_uid: 'fb-admin',
      role: 'ADMIN',
    });
    mockVerifyIdToken.mockResolvedValue(decoded('ADMIN'));
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(admin);

    const response = await request(app)
      .get('/api/recommendations/teams?participantId=77777777-7777-4777-8777-777777777777')
      .set('Authorization', 'Bearer admin-token');

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN_ROLE');
    expect(teamRecommendationsRepository.listEligibleTeamVacanciesForParticipant).not.toHaveBeenCalled();
  });

  it('uses the authenticated PART and returns only the safe candidate DTO', async () => {
    const response = await request(app)
      .get('/api/recommendations/teams?eventId=88888888-8888-4888-8888-888888888888')
      .set('Authorization', 'Bearer valid-token');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(teamRecommendationsRepository.listEligibleTeamVacanciesForParticipant).toHaveBeenCalledWith(ME);
    expect(response.body.recommendations).toEqual([
      {
        rank: 1,
        matchPercent: 100,
        matchedSkills: ['Node.js'],
        missingSkills: [],
        roleMatched: true,
        contributions: {
          skill: 'Matched 1 of 1 required skills with primary-role match (×1.2, capped at 1.0).',
          goal: 'Identical goals.',
          hours: 'Commitment 10h vs requested 10h.',
        },
        teamId: TEAM,
        teamName: 'Safe Team',
        pitch: 'Safe public pitch',
        goal: 'Learning',
        commitmentHours: 10,
        recruitmentStatus: 'Open',
        vacancyId: VACANCY,
        vacancyRole: 'Backend',
        desiredSkills: ['Node.js'],
      },
    ]);
    const body = JSON.stringify(response.body);
    expect(body).not.toContain('never-return@example.test');
    expect(body).not.toContain('fb-me');
    expect(body).not.toContain('88888888-8888-4888-8888-888888888888');
    expect(body).not.toMatch(/eventId|participantId|owner_participant_id|communication/i);
  });

  it('returns a successful empty collection when no eligible vacancy exists', async () => {
    vi.spyOn(teamRecommendationsRepository, 'listEligibleTeamVacanciesForParticipant').mockResolvedValue({
      candidates: [],
      pendingRequestTeamIds: new Set(),
    });
    const response = await request(app)
      .get('/api/recommendations/teams')
      .set('Authorization', 'Bearer valid-token');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ok', recommendations: [], empty: true });
  });

  it('preserves verification and suspension gates', async () => {
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(
      participant({ is_suspended: true })
    );
    const suspended = await request(app)
      .get('/api/recommendations/teams')
      .set('Authorization', 'Bearer valid-token');
    expect(suspended.status).toBe(403);
    expect(suspended.body.code).toBe('ACCOUNT_SUSPENDED');

    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(
      participant({ is_verified: false })
    );
    const unverified = await request(app)
      .get('/api/recommendations/teams')
      .set('Authorization', 'Bearer valid-token');
    expect(unverified.status).toBe(403);
    expect(unverified.body.code).toBe('EMAIL_NOT_VERIFIED');
  });
});
