/**
 * US-015 Candidate Recommendations — Integration Suite
 *
 * Exercises scoring, owner permissions, and FR-046 exclusions across the full
 * Express middleware pipeline (Firebase token → MFA → active → PART → verified → owner).
 *
 * Maps to acceptance tests:
 *   US-015-T1 ranked scores
 *   US-015-T2 explainable contributions
 *   US-015-T3 LFT / confirmed exclusions
 *   US-015-T4 empty pool
 *   US-015-T5 scoring failure → unranked degraded list
 *   US-015-T6 non-owner / no open slot denied
 *
 * Auth/validation failure paths and POST /api/scoring/compatibility boundaries included
 * for repeatable evidence of server-side validation and authorization.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import { teamsRepository } from '../db/teams.repository.js';
import { availabilityRepository } from '../repositories/availability.repository.js';
import * as availabilityService from '../services/availability.service.js';
import * as recommendationsService from '../services/recommendations.js';
import {
  EMPTY_RECOMMENDATIONS_MESSAGE,
  SCORING_DEGRADED_NOTICE,
} from '../services/recommendations.js';
import {
  ownerParticipant,
  otherParticipant,
  sampleTeamId,
  sampleVacancyId,
  sampleTeam,
  sampleParts,
  sampleVacancy,
  validOwnerDecodedToken,
  validOtherDecodedToken,
  validTokenHeader,
  otherTokenHeader,
  AUTH_TIME,
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

import type { AvailableCandidateCard } from '../services/availability.service.js';

const recPath = `/api/teams/${sampleTeamId}/vacancies/${sampleVacancyId}/recommendations`;

const eligibleCandidate: AvailableCandidateCard = {
  participantId: otherParticipant.id,
  displayName: 'Other Participant',
  handle: 'other_dev',
  institution: null,
  primaryRole: 'Frontend',
  desiredRole: 'Frontend',
  commitmentHours: 10,
  goal: 'Project Completion',
  skills: ['React', 'TypeScript'],
  portfolioLinks: [],
  updatedAt: '2026-10-18T00:00:00.000Z',
};

const frSlotVacancy = {
  ...sampleVacancy,
  skills: ['React', 'TypeScript', 'CSS', 'Testing'],
};

function mockOwnerTeamContext(overrides?: {
  vacancies?: typeof sampleParts.vacancies;
  team?: typeof sampleTeam;
  end_date?: string;
  status?: 'Published' | 'Archived' | 'Disabled';
}): void {
  vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(overrides?.team ?? sampleTeam);
  vi.spyOn(teamsRepository, 'getTeamViewParts').mockResolvedValue({
    ...sampleParts,
    team: overrides?.team ?? sampleTeam,
    event: {
      max_team_size: 4,
      status: overrides?.status ?? 'Published',
      end_date: overrides?.end_date ?? '2099-01-01T00:00:00.000Z',
    },
    vacancies: overrides?.vacancies ?? [frSlotVacancy],
  });
  vi.spyOn(teamsRepository, 'listConfirmedParticipantIdsForEvent').mockResolvedValue([
    ownerParticipant.id,
  ]);
}

function mockEligiblePool(
  candidates: AvailableCandidateCard[] = [eligibleCandidate]
): void {
  vi.spyOn(availabilityService, 'listAvailableCandidates').mockResolvedValue(candidates);
  vi.spyOn(participantsRepository, 'findById').mockImplementation(async (id: string) => {
    if (id === otherParticipant.id) return otherParticipant;
    if (id === ownerParticipant.id) return ownerParticipant;
    return {
      ...otherParticipant,
      id,
      firebase_uid: `fb-${id.slice(0, 8)}`,
      email: `${id.slice(0, 8)}@example.com`,
    };
  });
  vi.spyOn(availabilityRepository, 'findByParticipantId').mockResolvedValue({
    participantId: otherParticipant.id,
    isLooking: true,
    desiredRole: 'Frontend',
    commitmentHours: 10,
    goal: 'Project Completion',
    updatedAt: '2026-10-18T00:00:00.000Z',
  });
}

describe('US-015 Recommendations Integration Suite (scoring, permissions, exclusions)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockVerifyIdToken.mockResolvedValue(validOwnerDecodedToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(ownerParticipant);
    mockOwnerTeamContext();
  });

  describe('US-015-T1 / T2: ranked scores and explainable contributions', () => {
    it('returns deterministic FR-045 displayScore 70.0 with skill/goal/hours explanation items', async () => {
      mockEligiblePool();

      const res = await request(app).get(recPath).set('Authorization', validTokenHeader);

      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body.status).toBe('ok');
      expect(res.body.empty).toBe(false);
      expect(res.body.candidates).toHaveLength(1);
      expect(res.body.candidates[0].displayScore).toBe('70.0');
      expect(res.body.candidates[0].score).toBeGreaterThanOrEqual(0);
      expect(res.body.candidates[0].score).toBeLessThanOrEqual(100);
      expect(res.body.candidates[0].rank).toBe(1);
      expect(res.body.candidates[0].explanation.items.map((i: { label: string }) => i.label)).toEqual(
        ['Skills', 'Goal', 'Hours']
      );
      expect(res.body.candidates[0].contributions.skill).toMatch(/Matched 2 of 4/);
      expect(res.body.candidates[0].contributions.goal).toMatch(/Identical|identical|goal/i);
      expect(res.body.candidates[0].contributions.hours).toMatch(/10h|20h/);
      expect(JSON.stringify(res.body)).not.toMatch(/"internalId"/i);
    });

    it('ranks equal scores by display handle (tie-break evidence)', async () => {
      const zoeId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
      const amyId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
      mockOwnerTeamContext({
        vacancies: [{ ...frSlotVacancy, skills: [], role: 'Backend' }],
        team: { ...sampleTeam, commitment_hours: 0, goal: 'Learning' },
      });
      mockEligiblePool([
        {
          ...eligibleCandidate,
          participantId: zoeId,
          handle: 'zoe',
          displayName: 'Zoe',
          primaryRole: 'Backend',
          desiredRole: 'Backend',
          skills: [],
          commitmentHours: 0,
          goal: 'Learning',
        },
        {
          ...eligibleCandidate,
          participantId: amyId,
          handle: 'amy',
          displayName: 'Amy',
          primaryRole: 'Backend',
          desiredRole: 'Backend',
          skills: [],
          commitmentHours: 0,
          goal: 'Learning',
        },
      ]);

      const res = await request(app).get(recPath).set('Authorization', validTokenHeader);

      expect(res.status).toBe(200);
      expect(res.body.candidates.map((c: { handle: string }) => c.handle)).toEqual(['amy', 'zoe']);
      expect(res.body.candidates.map((c: { rank: number }) => c.rank)).toEqual([1, 2]);
      expect(
        res.body.candidates.every(
          (c: { score: number }) => c.score >= 0 && c.score <= 100 && c.score === 100
        )
      ).toBe(true);
    });
  });

  describe('US-015-T3: exclusions (not Looking for Team / confirmed / inactive)', () => {
    it('excludes candidates already confirmed for the event and reports exclusion counts', async () => {
      mockEligiblePool();
      vi.spyOn(teamsRepository, 'listConfirmedParticipantIdsForEvent').mockResolvedValue([
        ownerParticipant.id,
        otherParticipant.id,
      ]);

      const res = await request(app).get(recPath).set('Authorization', validTokenHeader);

      expect(res.status).toBe(200);
      expect(res.body.empty).toBe(true);
      expect(res.body.candidates).toEqual([]);
      expect(res.body.exclusions.confirmed).toBe(1);
      expect(res.body.exclusions.totalExcluded).toBeGreaterThanOrEqual(1);
    });

    it('excludes candidates who are not Looking for Team after revalidation', async () => {
      mockEligiblePool();
      vi.spyOn(availabilityRepository, 'findByParticipantId').mockResolvedValue({
        participantId: otherParticipant.id,
        isLooking: false,
        desiredRole: 'Frontend',
        commitmentHours: 10,
        goal: 'Project Completion',
        updatedAt: null,
      });

      const res = await request(app).get(recPath).set('Authorization', validTokenHeader);

      expect(res.status).toBe(200);
      expect(res.body.empty).toBe(true);
      expect(res.body.exclusions.unavailable).toBe(1);
      expect(res.body.candidates).toEqual([]);
    });

    it('excludes suspended (inactive) candidates after revalidation', async () => {
      mockEligiblePool();
      vi.spyOn(participantsRepository, 'findById').mockResolvedValue({
        ...otherParticipant,
        is_suspended: true,
      });

      const res = await request(app).get(recPath).set('Authorization', validTokenHeader);

      expect(res.status).toBe(200);
      expect(res.body.empty).toBe(true);
      expect(res.body.exclusions.inactive).toBe(1);
      expect(res.body.candidates).toEqual([]);
    });
  });

  describe('US-015-T4: empty eligible pool', () => {
    it('returns no-results message when the Looking-for-Team pool is empty', async () => {
      vi.spyOn(availabilityService, 'listAvailableCandidates').mockResolvedValue([]);

      const res = await request(app).get(recPath).set('Authorization', validTokenHeader);

      expect(res.status).toBe(200);
      expect(res.body.empty).toBe(true);
      expect(res.body.candidates).toEqual([]);
      expect(res.body.message).toBe(EMPTY_RECOMMENDATIONS_MESSAGE);
      expect(res.body.message).toMatch(/Looking for Team|eligible/i);
    });
  });

  describe('US-015-T5: scoring failure degraded fallback (NR-016)', () => {
    it('surfaces unranked eligible list through the HTTP pipeline when scoring degrades', async () => {
      // Service-layer NR-016 (scoring throw → degraded) is covered in recommendations.test.ts.
      // Here we verify the Express path returns that degraded contract without inventing scores.
      vi.spyOn(recommendationsService, 'getRecommendationsForOpenSlot').mockResolvedValue({
        status: 'degraded',
        teamId: sampleTeamId,
        vacancyId: sampleVacancyId,
        slot: {
          vacancyId: sampleVacancyId,
          role: 'Frontend',
          requiredSkills: ['React', 'TypeScript', 'CSS', 'Testing'],
          requestedHours: 20,
          goal: 'Project Completion',
        },
        candidates: [
          {
            participantId: otherParticipant.id,
            displayName: 'Other Participant',
            handle: 'other_dev',
            primaryRole: 'Frontend',
            desiredRole: 'Frontend',
            skills: ['React', 'TypeScript'],
            commitmentHours: 10,
            goal: 'Project Completion',
          },
        ],
        empty: false,
        message: null,
        notice: 'Scores use self-declared skills, role, goal, and hours as a recommendation aid.',
        exclusions: {
          inactive: 0,
          unavailable: 0,
          confirmed: 0,
          owner: 0,
          totalExcluded: 0,
        },
        degradedNotice: SCORING_DEGRADED_NOTICE,
      });

      const res = await request(app).get(recPath).set('Authorization', validTokenHeader);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('degraded');
      expect(res.body.degradedNotice).toBe(SCORING_DEGRADED_NOTICE);
      expect(res.body.candidates).toHaveLength(1);
      expect(res.body.candidates[0].participantId).toBe(otherParticipant.id);
      expect(res.body.candidates[0].displayScore).toBeUndefined();
      expect(res.body.candidates[0].rank).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toMatch(/"internalId"/i);
    });
  });

  describe('US-015-T6: permissions and open-slot gates', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const res = await request(app).get(recPath);
      expect(res.status).toBe(401);
    });

    it('rejects non-owners with 403 FORBIDDEN_NOT_TEAM_OWNER', async () => {
      mockVerifyIdToken.mockResolvedValue(validOtherDecodedToken);
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(otherParticipant);

      const res = await request(app).get(recPath).set('Authorization', otherTokenHeader);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_NOT_TEAM_OWNER');
    });

    it('rejects missing MFA claim with 403 MFA_REQUIRED', async () => {
      mockVerifyIdToken.mockResolvedValue({
        uid: ownerParticipant.firebase_uid,
        email: ownerParticipant.email,
        role: 'PART',
        auth_time: AUTH_TIME,
      } as unknown as DecodedIdToken);

      const res = await request(app).get(recPath).set('Authorization', validTokenHeader);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('MFA_REQUIRED');
    });

    it('rejects unverified owner with 403 EMAIL_NOT_VERIFIED', async () => {
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue({
        ...ownerParticipant,
        is_verified: false,
      });

      const res = await request(app).get(recPath).set('Authorization', validTokenHeader);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
    });

    it('rejects suspended owner with 403 ACCOUNT_SUSPENDED', async () => {
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue({
        ...ownerParticipant,
        is_suspended: true,
      });

      const res = await request(app).get(recPath).set('Authorization', validTokenHeader);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('ACCOUNT_SUSPENDED');
    });

    it('rejects filled vacancy (no open slot) with 409 SLOT_NOT_OPEN_FOR_RECOMMENDATIONS', async () => {
      mockOwnerTeamContext({
        vacancies: [{ ...frSlotVacancy, status: 'Filled' }],
      });

      const res = await request(app).get(recPath).set('Authorization', validTokenHeader);

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('SLOT_NOT_OPEN_FOR_RECOMMENDATIONS');
    });

    it('rejects locked team with 409 SLOT_NOT_OPEN_FOR_RECOMMENDATIONS', async () => {
      mockOwnerTeamContext({
        team: { ...sampleTeam, recruitment_status: 'Locked' },
      });

      const res = await request(app).get(recPath).set('Authorization', validTokenHeader);

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('SLOT_NOT_OPEN_FOR_RECOMMENDATIONS');
    });

    it('rejects invalid vacancy UUID with 400 VALIDATION_ERROR and field errors', async () => {
      const res = await request(app)
        .get(`/api/teams/${sampleTeamId}/vacancies/not-a-uuid/recommendations`)
        .set('Authorization', validTokenHeader);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors.vacancyId).toBeTruthy();
    });
  });

  describe('POST /api/scoring/compatibility permissions, validation, boundaries', () => {
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

    it('rejects unauthenticated scoring with 401', async () => {
      const res = await request(app).post('/api/scoring/compatibility').send(happyBody);
      expect(res.status).toBe(401);
    });

    it('rejects scoring without MFA with 403 MFA_REQUIRED', async () => {
      mockVerifyIdToken.mockResolvedValue({
        uid: ownerParticipant.firebase_uid,
        email: ownerParticipant.email,
        role: 'PART',
        auth_time: AUTH_TIME,
      } as unknown as DecodedIdToken);

      const res = await request(app)
        .post('/api/scoring/compatibility')
        .set('Authorization', validTokenHeader)
        .send(happyBody);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('MFA_REQUIRED');
    });

    it('returns 400 with field errors and submitted payload on invalid role (preserves input)', async () => {
      const body = {
        ...happyBody,
        slot: { ...happyBody.slot, role: 'Wizard' },
      };
      const res = await request(app)
        .post('/api/scoring/compatibility')
        .set('Authorization', validTokenHeader)
        .send(body);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('COMPATIBILITY_SCORE_VALIDATION');
      expect(res.body.errors.role).toBeTruthy();
      expect(res.body.submitted).toEqual(body);
    });

    it('bounds perfect skill/goal/hours match at displayScore 100.0', async () => {
      const res = await request(app)
        .post('/api/scoring/compatibility')
        .set('Authorization', validTokenHeader)
        .send({
          slot: {
            role: 'Frontend',
            requiredSkills: ['React'],
            requestedHours: 10,
            goal: 'Learning',
          },
          candidate: {
            primaryRole: 'Frontend',
            skills: ['React'],
            commitmentHours: 10,
            goal: 'Learning',
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.displayScore).toBe('100.0');
      expect(res.body.score).toBe(100);
      expect(res.body.score).toBeLessThanOrEqual(100);
    });

    it('scores fully missing candidate inputs as 0.0 (boundary / missing→0)', async () => {
      const res = await request(app)
        .post('/api/scoring/compatibility')
        .set('Authorization', validTokenHeader)
        .send({
          slot: {
            role: 'Frontend',
            requiredSkills: ['React', 'Vue'],
            requestedHours: 20,
            goal: 'Competitive',
          },
          candidate: {
            primaryRole: null,
            skills: [],
            commitmentHours: null,
            goal: null,
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.hadMissingInput).toBe(true);
      expect(res.body.displayScore).toBe('0.0');
      expect(res.body.score).toBe(0);
      expect(res.body.components).toEqual({ skill: 0, goal: 0, hours: 0 });
    });
  });
});
