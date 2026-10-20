import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import { teamsRepository } from '../db/teams.repository.js';
import { availabilityRepository } from '../repositories/availability.repository.js';
import * as availabilityService from '../services/availability.service.js';
import { EMPTY_RECOMMENDATIONS_MESSAGE } from '../services/recommendations.js';
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

const recPath = `/api/teams/${sampleTeamId}/vacancies/${sampleVacancyId}/recommendations`;

describe('GET /api/teams/:teamId/vacancies/:vacancyId/recommendations (US-015)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockVerifyIdToken.mockResolvedValue(validOwnerDecodedToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(ownerParticipant);
    vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(sampleTeam);
    vi.spyOn(teamsRepository, 'getTeamViewParts').mockResolvedValue({
      ...sampleParts,
      event: {
        max_team_size: 4,
        status: 'Published',
        end_date: '2099-01-01T00:00:00.000Z',
      },
      vacancies: [
        {
          ...sampleVacancy,
          skills: ['React', 'TypeScript', 'CSS', 'Testing'],
        },
      ],
    });
    vi.spyOn(teamsRepository, 'listConfirmedParticipantIdsForTeam').mockResolvedValue([
      ownerParticipant.id,
    ]);
    vi.spyOn(teamsRepository, 'listConfirmedParticipantIdsForEvent').mockResolvedValue([
      ownerParticipant.id,
    ]);
  });

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

  it('rejects invalid vacancy UUID with 400 field errors', async () => {
    const res = await request(app)
      .get(`/api/teams/${sampleTeamId}/vacancies/not-a-uuid/recommendations`)
      .set('Authorization', validTokenHeader);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.errors.vacancyId).toBeTruthy();
  });

  it('returns ranked recommendations for the owner (happy path)', async () => {
    vi.spyOn(availabilityService, 'listAvailableCandidates').mockResolvedValue([
      {
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
      },
    ]);
    vi.spyOn(participantsRepository, 'findById').mockResolvedValue(otherParticipant);
    vi.spyOn(availabilityRepository, 'findByParticipantId').mockResolvedValue({
      participantId: otherParticipant.id,
      isLooking: true,
      desiredRole: 'Frontend',
      commitmentHours: 10,
      goal: 'Project Completion',
      updatedAt: '2026-10-18T00:00:00.000Z',
    });

    const res = await request(app).get(recPath).set('Authorization', validTokenHeader);

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.status).toBe('ok');
    expect(res.body.candidates[0].displayScore).toBe('70.0');
    expect(res.body.candidates[0].contributions.skill).toMatch(/Matched 2 of 4/);
    expect(res.body.candidates[0].explanation.items).toHaveLength(3);
    expect(JSON.stringify(res.body)).not.toMatch(/"internalId"/i);
    expect(res.body.empty).toBe(false);
    expect(res.body.exclusions).toEqual({
      inactive: 0,
      unavailable: 0,
      confirmed: 0,
      owner: 0,
      totalExcluded: 0,
    });
  });

  it('returns empty success payload when no eligible candidates remain', async () => {
    vi.spyOn(availabilityService, 'listAvailableCandidates').mockResolvedValue([]);

    const res = await request(app).get(recPath).set('Authorization', validTokenHeader);

    expect(res.status).toBe(200);
    expect(res.body.empty).toBe(true);
    expect(res.body.candidates).toEqual([]);
    expect(res.body.message).toBe(EMPTY_RECOMMENDATIONS_MESSAGE);
    expect(res.body.message).toMatch(/Looking for Team/);
  });

  it('excludes confirmed event participants from ranked results', async () => {
    vi.spyOn(availabilityService, 'listAvailableCandidates').mockResolvedValue([
      {
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
      },
    ]);
    vi.spyOn(teamsRepository, 'listConfirmedParticipantIdsForTeam').mockResolvedValue([
      ownerParticipant.id,
      otherParticipant.id,
    ]);
    vi.spyOn(teamsRepository, 'listConfirmedParticipantIdsForEvent').mockResolvedValue([
      ownerParticipant.id,
      otherParticipant.id,
    ]);
    vi.spyOn(participantsRepository, 'findById').mockResolvedValue(otherParticipant);
    vi.spyOn(availabilityRepository, 'findByParticipantId').mockResolvedValue({
      participantId: otherParticipant.id,
      isLooking: true,
      desiredRole: 'Frontend',
      commitmentHours: 10,
      goal: 'Project Completion',
      updatedAt: null,
    });

    const res = await request(app).get(recPath).set('Authorization', validTokenHeader);

    expect(res.status).toBe(200);
    expect(res.body.empty).toBe(true);
    expect(res.body.exclusions.confirmed).toBe(1);
    expect(res.body.candidates).toEqual([]);
  });

  it('returns 409 when vacancy is not open', async () => {
    vi.spyOn(teamsRepository, 'getTeamViewParts').mockResolvedValue({
      ...sampleParts,
      event: {
        max_team_size: 4,
        status: 'Published',
        end_date: '2099-01-01T00:00:00.000Z',
      },
      vacancies: [{ ...sampleVacancy, status: 'Filled' }],
    });

    const res = await request(app).get(recPath).set('Authorization', validTokenHeader);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SLOT_NOT_OPEN_FOR_RECOMMENDATIONS');
  });

  it('supports GET /api/teams/:teamId/slots/:slotId/recommendations alias and returns recommendations', async () => {
    vi.spyOn(availabilityService, 'listAvailableCandidates').mockResolvedValue([
      {
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
      },
    ]);
    vi.spyOn(participantsRepository, 'findById').mockResolvedValue(otherParticipant);
    vi.spyOn(availabilityRepository, 'findByParticipantId').mockResolvedValue({
      participantId: otherParticipant.id,
      isLooking: true,
      desiredRole: 'Frontend',
      commitmentHours: 10,
      goal: 'Project Completion',
      updatedAt: '2026-10-18T00:00:00.000Z',
    });

    const res = await request(app)
      .get(`/api/teams/${sampleTeamId}/slots/${sampleVacancyId}/recommendations`)
      .set('Authorization', validTokenHeader);

    expect(res.status).toBe(200);
    expect(res.body.slotId).toBe(sampleVacancyId);
    expect(res.body.candidates).toHaveLength(1);
  });

  it('rejects invalid slot UUID with 400 field errors', async () => {
    const res = await request(app)
      .get(`/api/teams/${sampleTeamId}/slots/invalid-uuid/recommendations`)
      .set('Authorization', validTokenHeader);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.errors.slotId).toBeTruthy();
  });
});
