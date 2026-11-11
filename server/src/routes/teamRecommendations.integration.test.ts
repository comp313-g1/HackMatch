/**
 * US-016 / #159 — recommended teams, end to end on the server: HTTP request -> real sign-in,
 * MFA, role, verification and own-profile checks -> real eligibility (#153), query service (#154),
 * scoring (#155) -> JSON response. Only the stores are faked (in-memory), so every rule between the
 * request and the response runs for real.
 *
 * The first test also pins the exact response against a shared contract fixture that the client
 * (#156) parses in its own tests, so the two layers cannot drift apart unnoticed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import { profileRepository } from '../db/profile.repository.js';
import {
  teamRecommendationsRepository,
  type RecommendationTeamRecord,
} from '../db/teamRecommendations.repository.js';
import { availabilityRepository } from '../repositories/availability.repository.js';
import type { Participant, ParticipantPrimaryRole, TeamGoal } from '../db/types.js';
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(__dirname, '../test-fixtures');
const readFixture = (name: string): unknown => JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8'));
/**
 * Compares a real response with its contract fixture. To change the contract on purpose, run once
 * with UPDATE_CONTRACT_FIXTURES=1, review the diff, and commit the fixture together with the client.
 */
function expectMatchesFixture(body: unknown, name: string): void {
  if (process.env.UPDATE_CONTRACT_FIXTURES === '1') {
    fs.mkdirSync(FIXTURE_DIR, { recursive: true });
    fs.writeFileSync(path.join(FIXTURE_DIR, name), `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  }
  expect(body).toEqual(readFixture(name));
}

const ME = '1111aaaa-1111-4111-8111-1111111111bb';
const OWNER = '2222cccc-2222-4222-8222-2222222222dd';
const AUTH_TIME = Math.floor(Date.now() / 1000) - 30;
const URL = '/api/recommendations/teams';
const AUTH = { Authorization: 'Bearer valid-token' };
const T0 = '2026-01-01T00:00:00.000Z';

const uuid = (n: number): string => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;

function participant(over: Partial<Participant> = {}): Participant {
  return {
    id: ME, firebase_uid: 'fb-me', email: 'private@example.test', full_name: 'Private Name', role: 'PART',
    is_verified: true, is_suspended: false, is_deactivated: false, created_at: T0, updated_at: T0, ...over,
  };
}

interface Slot {
  n: number;
  name: string;
  goal?: TeamGoal;
  hours?: number;
  role?: ParticipantPrimaryRole;
  skills?: string[];
  team?: Partial<RecommendationTeamRecord['team']>;
  vacancy?: Partial<RecommendationTeamRecord['vacancy']>;
  members?: string[];
}

function slot(s: Slot): RecommendationTeamRecord {
  const teamId = uuid(1000 + s.n);
  return {
    team: {
      id: teamId, owner_participant_id: OWNER, name: s.name, pitch: `${s.name} pitch`, goal: s.goal ?? 'Learning',
      commitment_hours: s.hours ?? 10, recruitment_status: 'Open', locked_at: null, disbanded_at: null,
      moderation_hidden_at: null, moderation_status: 'None', created_at: T0, ...s.team,
    },
    vacancy: {
      id: uuid(2000 + s.n), team_id: teamId, role: s.role ?? 'Backend', skills: s.skills ?? ['Node.js'],
      status: 'Open', removed_at: null, created_at: T0, ...s.vacancy,
    },
    confirmedMemberIds: new Set(s.members ?? [OWNER]),
  };
}

/** The shared example world: three suggestable teams plus one of every kind that must be left out. */
function world(): { candidates: RecommendationTeamRecord[]; pending: Set<string> } {
  const pendingTeam = slot({ n: 9, name: 'Already Applied' });
  return {
    candidates: [
      slot({ n: 1, name: 'Beta Frontend', goal: 'Project Completion', hours: 20, role: 'Frontend', skills: ['React'] }),
      slot({ n: 2, name: 'Alpha Backend', goal: 'Learning', hours: 10, role: 'Backend', skills: ['Node.js', 'PostgreSQL'] }),
      slot({ n: 3, name: 'Gamma Stretch', goal: 'Competitive', hours: 12, role: 'Backend', skills: ['Node.js', 'Go', 'Rust'] }),
      slot({ n: 4, name: 'Locked Team', team: { recruitment_status: 'Locked', locked_at: T0 } }),
      slot({ n: 5, name: 'Hidden Team', team: { moderation_status: 'Hidden' } }),
      slot({ n: 6, name: 'My Own Team', team: { owner_participant_id: ME }, members: [ME] }),
      slot({ n: 7, name: 'Member Team', members: [OWNER, ME] }),
      slot({ n: 8, name: 'Filled Role', vacancy: { status: 'Filled' } }),
      pendingTeam,
    ],
    pending: new Set([pendingTeam.team.id]),
  };
}

describe('recommended teams, end to end (US-016 / #159)', () => {
  const query = () => vi.spyOn(teamRecommendationsRepository, 'listEligibleTeamVacanciesForParticipant');
  const get = () => request(app).get(URL).set(AUTH);

  beforeEach(() => {
    vi.restoreAllMocks();
    mockVerifyIdToken.mockResolvedValue({ uid: 'fb-me', email: 'private@example.test', role: 'PART', auth_time: AUTH_TIME, [MFA_CLAIM]: AUTH_TIME } as unknown as DecodedIdToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(participant());
    vi.spyOn(participantsRepository, 'findById').mockResolvedValue(participant());
    vi.spyOn(profileRepository, 'findProfileByParticipantId').mockResolvedValue({
      participant_id: ME, handle: 'me_dev', primary_role: 'Backend', institution: 'Private Institution',
      shared_contact_handle: '@private', moderation_status: 'None', created_at: T0, updated_at: T0,
    });
    vi.spyOn(profileRepository, 'findSkillsByParticipantId').mockResolvedValue(
      ['Node.js', 'PostgreSQL'].map((skill_name, i) => ({ id: uuid(3000 + i), participant_id: ME, skill_name, created_at: T0 }))
    );
    vi.spyOn(availabilityRepository, 'findByParticipantId').mockResolvedValue({
      participantId: ME, isLooking: true, desiredRole: 'Backend', commitmentHours: 12, goal: 'Learning', updatedAt: T0,
    });
    const w = world();
    query().mockResolvedValue({ candidates: w.candidates, pendingRequestTeamIds: w.pending });
  });

  describe('happy path', () => {
    it('returns the suggestable teams best first, and matches the shared contract fixture', async () => {
      const response = await get();
      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expectMatchesFixture(response.body, 'recommendedTeamsResponse.json');
    });

    it('scores each team from the shared formula and orders by it', async () => {
      const { body } = await get();
      expect(body.recommendations.map((r: { teamName: string }) => r.teamName)).toEqual([
        'Alpha Backend', 'Gamma Stretch', 'Beta Frontend',
      ]);
      expect(body.recommendations.map((r: { matchPercent: number }) => r.matchPercent)).toEqual([100, 47, 37]);
      expect(body.recommendations.map((r: { rank: number }) => r.rank)).toEqual([1, 2, 3]);
    });

    it('lists matched and missing skills in the team\'s own spelling', async () => {
      const { body } = await get();
      const byName = Object.fromEntries(body.recommendations.map((r: { teamName: string }) => [r.teamName, r]));
      expect(byName['Alpha Backend']).toMatchObject({ matchedSkills: ['Node.js', 'PostgreSQL'], missingSkills: [], roleMatched: true });
      expect(byName['Gamma Stretch']).toMatchObject({ matchedSkills: ['Node.js'], missingSkills: ['Go', 'Rust'], roleMatched: true });
      expect(byName['Beta Frontend']).toMatchObject({ matchedSkills: [], missingSkills: ['React'], roleMatched: false });
    });

    it('leaves out every kind of team that must not be suggested', async () => {
      const { body } = await get();
      const names = body.recommendations.map((r: { teamName: string }) => r.teamName);
      for (const hidden of ['Locked Team', 'Hidden Team', 'My Own Team', 'Member Team', 'Filled Role', 'Already Applied']) {
        expect(names).not.toContain(hidden);
      }
    });

    it('gives the same answer every time for the same data', async () => {
      const first = await get();
      const second = await get();
      expect(second.body).toEqual(first.body);
    });

    it('does not depend on the order the database returns the rows in', async () => {
      const w = world();
      query().mockResolvedValue({ candidates: [...w.candidates].reverse(), pendingRequestTeamIds: w.pending });
      const reversed = await get();
      expect(reversed.body).toEqual(readFixture('recommendedTeamsResponse.json'));
    });
  });

  describe('privacy', () => {
    it('never returns accounts, contact details, ownership or internal ids', async () => {
      const text = JSON.stringify((await get()).body);
      expect(text).not.toContain('private@example.test');
      expect(text).not.toContain('Private Name');
      expect(text).not.toContain('Private Institution');
      expect(text).not.toContain('@private');
      expect(text).not.toContain('fb-me');
      expect(text).not.toContain(ME);
      expect(text).not.toContain(OWNER);
      expect(text).not.toMatch(/owner_participant_id|confirmedMemberIds|event_id|eventId|communication|firebase/i);
      expect(text).not.toMatch(/"score"|displayScore|internalId/);
    });

    it('returns only the allowed fields for each team', async () => {
      const { body } = await get();
      for (const item of body.recommendations) {
        expect(Object.keys(item).sort()).toEqual(
          [
            'contributions', 'desiredSkills', 'goal', 'matchPercent', 'matchedSkills', 'missingSkills', 'pitch', 'rank',
            'recruitmentStatus', 'roleMatched', 'teamId', 'teamName', 'vacancyId', 'vacancyRole', 'commitmentHours',
          ].sort()
        );
      }
    });
  });

  describe('empty results', () => {
    it('returns a successful empty list when no team qualifies', async () => {
      query().mockResolvedValue({ candidates: [], pendingRequestTeamIds: new Set() });
      const { status, body } = await get();
      expect(status).toBe(200);
      expect(body).toMatchObject({ status: 'ok', recommendations: [], empty: true, eligibilityReason: null });
      expect(body.message).toMatch(/No eligible open team vacancies/);
      expect(body.notice).toMatch(/not predictions/);
    });

    it('returns an empty list when every team in the pool is excluded', async () => {
      const w = world();
      query().mockResolvedValue({ candidates: w.candidates.slice(3), pendingRequestTeamIds: w.pending });
      const { body } = await get();
      expect(body.empty).toBe(true);
      expect(body.recommendations).toEqual([]);
    });

    it.each([
      ['not looking for a team', () => vi.spyOn(availabilityRepository, 'findByParticipantId').mockResolvedValue(null), 'participant_not_looking'],
      ['looking turned off', () => vi.spyOn(availabilityRepository, 'findByParticipantId').mockResolvedValue({ participantId: ME, isLooking: false, desiredRole: null, commitmentHours: null, goal: null, updatedAt: null }), 'participant_not_looking'],
      ['no skills', () => vi.spyOn(profileRepository, 'findSkillsByParticipantId').mockResolvedValue([]), 'participant_no_skills'],
      ['a hidden profile', () => vi.spyOn(profileRepository, 'findProfileByParticipantId').mockResolvedValue({ participant_id: ME, handle: 'x', primary_role: 'Backend', institution: null, shared_contact_handle: null, moderation_status: 'Hidden', created_at: T0, updated_at: T0 }), 'participant_profile_hidden'],
    ])('explains the empty list for %s and never queries the teams', async (_label, arrange, reason) => {
      arrange();
      const { status, body } = await get();
      expect(status).toBe(200);
      expect(body).toMatchObject({ empty: true, recommendations: [], eligibilityReason: reason });
      expect(teamRecommendationsRepository.listEligibleTeamVacanciesForParticipant).not.toHaveBeenCalled();
    });

    it('gives the not-looking empty answer the same shape the client contract fixture shows', async () => {
      vi.spyOn(availabilityRepository, 'findByParticipantId').mockResolvedValue(null);
      expectMatchesFixture((await get()).body, 'recommendedTeamsEmptyNotLooking.json');
    });

    it('does not spell out an account problem if the account changes after sign-in', async () => {
      vi.spyOn(participantsRepository, 'findById').mockResolvedValue(participant({ is_suspended: true }));
      const { status, body } = await get();
      expect(status).toBe(200);
      expect(body.eligibilityReason).toBe('participant_unavailable');
      expect(JSON.stringify(body)).not.toMatch(/suspend|deactivat|moderat/i);
    });

    it('treats an account that vanished after sign-in as unavailable, not as a server error', async () => {
      vi.spyOn(participantsRepository, 'findById').mockResolvedValue(null);
      const { status, body } = await get();
      expect(status).toBe(200);
      expect(body.eligibilityReason).toBe('participant_unavailable');
    });
  });

  describe('unauthorized access and invalid input', () => {
    it('refuses a visitor (401) and runs no query', async () => {
      const response = await request(app).get(URL);
      expect(response.status).toBe(401);
      expect(teamRecommendationsRepository.listEligibleTeamVacanciesForParticipant).not.toHaveBeenCalled();
    });

    it('refuses a session without the email code (403 MFA_REQUIRED)', async () => {
      mockVerifyIdToken.mockResolvedValue({ uid: 'fb-me', role: 'PART', auth_time: AUTH_TIME } as unknown as DecodedIdToken);
      const response = await get();
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('MFA_REQUIRED');
    });

    it('refuses an ADMIN (403)', async () => {
      mockVerifyIdToken.mockResolvedValue({ uid: 'fb-admin', role: 'ADMIN', auth_time: AUTH_TIME, [MFA_CLAIM]: AUTH_TIME } as unknown as DecodedIdToken);
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(participant({ id: OWNER, firebase_uid: 'fb-admin', role: 'ADMIN' }));
      expect((await get()).status).toBe(403);
    });

    it('refuses another participant\'s id (403) and a malformed one (400)', async () => {
      expect((await request(app).get(`${URL}?participantId=${OWNER}`).set(AUTH)).status).toBe(403);
      expect((await request(app).get(`${URL}?participantId=nope`).set(AUTH)).status).toBe(400);
      expect(teamRecommendationsRepository.listEligibleTeamVacanciesForParticipant).not.toHaveBeenCalled();
    });

    it('serves the caller whatever other parameters are sent', async () => {
      const response = await request(app).get(`${URL}?eventId=${uuid(77)}&limit=3&unknown=1`).set(AUTH);
      expect(response.status).toBe(200);
      expect(teamRecommendationsRepository.listEligibleTeamVacanciesForParticipant).toHaveBeenCalledWith(ME);
    });
  });

  describe('boundary conditions', () => {
    it('handles a participant with the smallest valid profile: one skill, 0 hours', async () => {
      vi.spyOn(profileRepository, 'findSkillsByParticipantId').mockResolvedValue([{ id: uuid(1), participant_id: ME, skill_name: 'Node.js', created_at: T0 }]);
      vi.spyOn(availabilityRepository, 'findByParticipantId').mockResolvedValue({ participantId: ME, isLooking: true, desiredRole: null, commitmentHours: 0, goal: null, updatedAt: null });
      const { status, body } = await get();
      expect(status).toBe(200);
      for (const item of body.recommendations) {
        expect(item.matchPercent).toBeGreaterThanOrEqual(0);
        expect(item.matchPercent).toBeLessThanOrEqual(100);
      }
    });

    it('reports 0% for a team with nothing in common and 100% for a perfect one', async () => {
      query().mockResolvedValue({
        candidates: [
          slot({ n: 1, name: 'Nothing Shared', goal: 'Competitive', hours: 40, role: 'UI/UX', skills: ['Figma'] }),
          slot({ n: 2, name: 'Perfect', goal: 'Learning', hours: 12, role: 'Backend', skills: ['Node.js', 'PostgreSQL'] }),
        ],
        pendingRequestTeamIds: new Set(),
      });
      vi.spyOn(availabilityRepository, 'findByParticipantId').mockResolvedValue({ participantId: ME, isLooking: true, desiredRole: 'Backend', commitmentHours: 12, goal: 'Learning', updatedAt: null });
      const { body } = await get();
      const percents = Object.fromEntries(body.recommendations.map((r: { teamName: string; matchPercent: number }) => [r.teamName, r.matchPercent]));
      expect(percents['Perfect']).toBe(100);
      expect(percents['Nothing Shared']).toBe(10); // hours: 12 of 40 = 0.3 -> 10%
    });

    it('accepts a vacancy with the most skills allowed (10) and a team asking for the most hours (168)', async () => {
      const ten = Array.from({ length: 10 }, (_, i) => `Skill ${i + 1}`);
      query().mockResolvedValue({ candidates: [slot({ n: 1, name: 'Big', hours: 168, skills: ten })], pendingRequestTeamIds: new Set() });
      const { status, body } = await get();
      expect(status).toBe(200);
      expect(body.recommendations[0].missingSkills).toHaveLength(10);
      expect(body.recommendations[0].commitmentHours).toBe(168);
    });

    it('accepts a team that asks for 0 hours and a vacancy with no required skills', async () => {
      query().mockResolvedValue({ candidates: [slot({ n: 1, name: 'Easy', hours: 0, skills: [] })], pendingRequestTeamIds: new Set() });
      const { body } = await get();
      expect(body.recommendations[0]).toMatchObject({ matchedSkills: [], missingSkills: [], desiredSkills: [] });
    });

    it('keeps a very long team name and plain-text markup intact as text', async () => {
      const name = 'A'.repeat(120);
      query().mockResolvedValue({ candidates: [slot({ n: 1, name }), slot({ n: 2, name: '<script>alert(1)</script>' })], pendingRequestTeamIds: new Set() });
      const { body } = await get();
      expect(body.recommendations.map((r: { teamName: string }) => r.teamName)).toContain(name);
      expect(body.recommendations.map((r: { teamName: string }) => r.teamName)).toContain('<script>alert(1)</script>');
    });

    it('ranks a large pool correctly: 300 vacancies, numbered 1..300, never above 100%', async () => {
      const many = Array.from({ length: 300 }, (_, i) => slot({ n: i + 1, name: `Team ${String(i + 1).padStart(3, '0')}`, hours: 5 + (i % 40), skills: i % 3 === 0 ? ['Node.js'] : ['Go'] }));
      query().mockResolvedValue({ candidates: many, pendingRequestTeamIds: new Set() });
      const { status, body } = await get();
      expect(status).toBe(200);
      expect(body.recommendations).toHaveLength(300);
      expect(body.recommendations.map((r: { rank: number }) => r.rank)).toEqual(Array.from({ length: 300 }, (_, i) => i + 1));
      const percents: number[] = body.recommendations.map((r: { matchPercent: number }) => r.matchPercent);
      expect(percents).toEqual([...percents].sort((a, b) => b - a));
      expect(Math.max(...percents)).toBeLessThanOrEqual(100);
    });

    it('breaks equal scores by team name so equal teams never swap places', async () => {
      query().mockResolvedValue({
        candidates: [slot({ n: 2, name: 'Bravo' }), slot({ n: 3, name: 'alpha' }), slot({ n: 1, name: 'Charlie' })],
        pendingRequestTeamIds: new Set(),
      });
      const { body } = await get();
      expect(body.recommendations.map((r: { teamName: string }) => r.teamName)).toEqual(['alpha', 'Bravo', 'Charlie']);
    });
  });

  describe('failure handling', () => {
    it.each([
      ['the team query fails', () => query().mockRejectedValue(new Error('database is down'))],
      ['the profile lookup fails', () => vi.spyOn(profileRepository, 'findProfileByParticipantId').mockRejectedValue(new Error('profile store down'))],
      ['the skills lookup fails', () => vi.spyOn(profileRepository, 'findSkillsByParticipantId').mockRejectedValue(new Error('skills store down'))],
      ['the availability lookup fails', () => vi.spyOn(availabilityRepository, 'findByParticipantId').mockRejectedValue(new Error('availability down'))],
      ['the account lookup fails', () => vi.spyOn(participantsRepository, 'findById').mockRejectedValue(new Error('accounts down'))],
    ])('answers 500 without leaking details when %s, never an empty success', async (_label, arrange) => {
      arrange();
      const response = await get();
      expect(response.status).toBe(500);
      expect(response.body.recommendations).toBeUndefined();
      expect(JSON.stringify(response.body)).not.toMatch(/down|database|store/i);
    });

    it('recovers on the next request after a failure', async () => {
      query().mockRejectedValueOnce(new Error('blip'));
      expect((await get()).status).toBe(500);
      expect((await get()).status).toBe(200);
    });
  });
});
