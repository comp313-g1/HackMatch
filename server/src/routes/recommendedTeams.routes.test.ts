import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import { profileRepository } from '../db/profile.repository.js';
import { teamsRepository } from '../db/teams.repository.js';
import { availabilityRepository } from '../repositories/availability.repository.js';
import type { OpenTeamRecord } from '../db/teams.repository.js';
import type { Participant, ParticipantProfile, ParticipantSkill, Team } from '../db/types.js';
import {
  otherParticipant,
  ownerParticipant,
  sampleVacancyId,
  validOtherDecodedToken,
  validOwnerDecodedToken,
  validTokenHeader,
  otherTokenHeader,
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

const recPath = '/api/scoring/teams/recommendations';
const otherTeamId = '99999999-9999-4999-8999-999999999999';

const actorProfile: ParticipantProfile = {
  participant_id: ownerParticipant.id,
  handle: 'owner_lead',
  primary_role: 'Frontend',
  institution: null,
  shared_contact_handle: null,
  created_at: '2026-10-18T00:00:00.000Z',
  updated_at: '2026-10-18T00:00:00.000Z',
};

const actorSkills: ParticipantSkill[] = [
  {
    id: 'skill-1',
    participant_id: ownerParticipant.id,
    skill_name: 'React',
    created_at: '2026-10-18T00:00:00.000Z',
  },
  {
    id: 'skill-2',
    participant_id: ownerParticipant.id,
    skill_name: 'TypeScript',
    created_at: '2026-10-18T00:00:00.000Z',
  },
];

function recruitingTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: otherTeamId,
    event_id: '55555555-5555-4555-8555-555555555555',
    owner_participant_id: otherParticipant.id,
    name: 'Recruiting Team',
    pitch: 'Looking for a frontend partner.',
    goal: 'Project Completion',
    commitment_hours: 20,
    communication_link: null,
    recruitment_status: 'Open',
    locked_at: null,
    disbanded_at: null,
    created_at: '2026-11-01T00:00:00.000Z',
    updated_at: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

function openRecord(overrides: Partial<Team> = {}): OpenTeamRecord {
  const team = recruitingTeam(overrides);
  return {
    team,
    event: { status: 'Published', end_date: '2099-01-01T00:00:00.000Z' },
    openVacancies: [{ id: sampleVacancyId, role: 'Frontend', skills: ['React', 'TypeScript'] }],
    members: [],
  };
}

describe('GET /api/scoring/teams/recommendations (US-016)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockVerifyIdToken.mockResolvedValue(validOwnerDecodedToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(ownerParticipant);
    vi.spyOn(participantsRepository, 'findById').mockResolvedValue(ownerParticipant);
    vi.spyOn(profileRepository, 'findProfileByParticipantId').mockResolvedValue(actorProfile);
    vi.spyOn(profileRepository, 'findSkillsByParticipantId').mockResolvedValue(actorSkills);
    vi.spyOn(availabilityRepository, 'findByParticipantId').mockResolvedValue({
      participantId: ownerParticipant.id,
      isLooking: true,
      desiredRole: 'Frontend',
      commitmentHours: 20,
      goal: 'Project Completion',
      updatedAt: '2026-10-18T00:00:00.000Z',
    });
    vi.spyOn(teamsRepository, 'findOpenTeamRecords').mockResolvedValue([openRecord()]);
    vi.spyOn(teamsRepository, 'findConfirmedTeamIdsForParticipant').mockResolvedValue([]);
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).get(recPath);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('rejects unverified participants with 403', async () => {
    const unverified: Participant = { ...ownerParticipant, is_verified: false };
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(unverified);

    const res = await request(app).get(recPath).set('Authorization', validTokenHeader);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('returns ranked recommendations with no-store caching (happy path)', async () => {
    const res = await request(app).get(recPath).set('Authorization', validTokenHeader);

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.status).toBe('ok');
    expect(res.body.empty).toBe(false);
    expect(res.body.teams).toHaveLength(1);
    expect(res.body.teams[0]).toMatchObject({
      teamId: otherTeamId,
      teamName: 'Recruiting Team',
      vacancyId: sampleVacancyId,
      role: 'Frontend',
      teamGoal: 'Project Completion',
      commitmentHours: 20,
      rank: 1,
    });
    expect(res.body.teams[0].displayScore).toEqual(expect.any(String));
    expect(JSON.stringify(res.body)).not.toContain('internalId');
  });

  it('derives the actor from the token and ignores any userId query parameter (#158)', async () => {
    const res = await request(app)
      .get(`${recPath}?userId=${otherParticipant.id}&participantId=${otherParticipant.id}`)
      .set('Authorization', validTokenHeader);

    expect(res.status).toBe(200);
    // The actor's own profile drove the score; the supplied userId never reached the service.
    expect(participantsRepository.findById).toHaveBeenCalledWith(ownerParticipant.id);
    expect(participantsRepository.findById).not.toHaveBeenCalledWith(otherParticipant.id);
  });

  it('returns the empty state when no team is recruiting', async () => {
    vi.spyOn(teamsRepository, 'findOpenTeamRecords').mockResolvedValue([]);

    const res = await request(app).get(recPath).set('Authorization', validTokenHeader);

    expect(res.status).toBe(200);
    expect(res.body.empty).toBe(true);
    expect(res.body.teams).toEqual([]);
    expect(res.body.message).toEqual(expect.any(String));
  });

  it('maps service errors to their status and code instead of 500', async () => {
    vi.spyOn(participantsRepository, 'findById').mockResolvedValue(null);

    const res = await request(app).get(recPath).set('Authorization', validTokenHeader);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PARTICIPANT_NOT_ELIGIBLE');
    expect(res.body.details).toMatchObject({ reason: 'PARTICIPANT_NOT_FOUND' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('hands unexpected errors to the central handler instead of leaking details', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(profileRepository, 'findSkillsByParticipantId').mockImplementation(async () => {
      throw new Error('profile store unavailable');
    });

    const res = await request(app).get(recPath).set('Authorization', validTokenHeader);

    // Unknown failures are not disguised as an empty or degraded result: they reach the
    // central handler, which answers 500 without a service-specific code.
    expect(res.status).toBe(500);
    expect(res.body.code).toBeUndefined();
  });

  it('keeps the ranking scoped to the requesting participant', async () => {
    mockVerifyIdToken.mockResolvedValue(validOtherDecodedToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(otherParticipant);
    vi.spyOn(participantsRepository, 'findById').mockResolvedValue(otherParticipant);

    const res = await request(app).get(recPath).set('Authorization', otherTokenHeader);

    expect(res.status).toBe(200);
    expect(participantsRepository.findById).toHaveBeenCalledWith(otherParticipant.id);
  });
});
