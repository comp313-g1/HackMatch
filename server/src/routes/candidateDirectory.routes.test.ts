import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import { teamsRepository } from '../db/teams.repository.js';
import * as candidateDirectoryService from '../services/candidateDirectory.js';
import { MFA_CLAIM } from '../utils/mfaClaim.js';
import type { Participant, Team } from '../db/types.js';

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

describe('GET /api/teams/:teamId/candidates (Candidate Directory Integration Tests - US-014-T7)', () => {
  const ownerParticipant: Participant = {
    id: '11111111-1111-4111-8111-111111111111',
    firebase_uid: 'fb-owner-1',
    email: 'owner@example.com',
    full_name: 'Owner Participant',
    role: 'PART',
    is_verified: true,
    is_suspended: false,
    created_at: '2026-10-18T00:00:00.000Z',
    updated_at: '2026-10-18T00:00:00.000Z',
  };

  const nonOwnerParticipant: Participant = {
    id: '22222222-2222-4222-8222-222222222222',
    firebase_uid: 'fb-non-owner',
    email: 'nonowner@example.com',
    full_name: 'Non-Owner Participant',
    role: 'PART',
    is_verified: true,
    is_suspended: false,
    created_at: '2026-10-18T00:00:00.000Z',
    updated_at: '2026-10-18T00:00:00.000Z',
  };

  const ownerDecodedToken = {
    uid: 'fb-owner-1',
    email: 'owner@example.com',
    role: 'PART',
    auth_time: AUTH_TIME,
    [MFA_CLAIM]: AUTH_TIME,
  } as unknown as DecodedIdToken;

  const nonOwnerDecodedToken = {
    uid: 'fb-non-owner',
    email: 'nonowner@example.com',
    role: 'PART',
    auth_time: AUTH_TIME,
    [MFA_CLAIM]: AUTH_TIME,
  } as unknown as DecodedIdToken;

  const sampleTeamId = '33333333-3333-4333-8333-333333333333';
  const sampleEventId = '44444444-4444-4444-8444-444444444444';

  const sampleTeam: Team = {
    id: sampleTeamId,
    event_id: sampleEventId,
    owner_participant_id: ownerParticipant.id,
    name: 'HackMatch Innovators',
    pitch: 'Building accessible software',
    goal: 'Project Completion',
    commitment_hours: 20.0,
    communication_link: 'https://discord.gg/test',
    recruitment_status: 'Open',
    locked_at: null,
    disbanded_at: null,
    created_at: '2026-10-18T10:00:00.000Z',
    updated_at: '2026-10-18T10:00:00.000Z',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 401 UNAUTHORIZED when no token is provided', async () => {
    const response = await request(app).get(`/api/teams/${sampleTeamId}/candidates`);
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('UNAUTHORIZED');
  });

  it('returns 403 FORBIDDEN_NOT_TEAM_OWNER when requester is not the team owner', async () => {
    mockVerifyIdToken.mockResolvedValue(nonOwnerDecodedToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(nonOwnerParticipant);
    vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(sampleTeam);

    const response = await request(app)
      .get(`/api/teams/${sampleTeamId}/candidates`)
      .set('Authorization', 'Bearer valid-non-owner-token');

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN_NOT_TEAM_OWNER');
  });

  it('returns 400 VALIDATION_ERROR when query parameters are invalid (minHours > maxHours, invalid mode)', async () => {
    mockVerifyIdToken.mockResolvedValue(ownerDecodedToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(ownerParticipant);
    vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(sampleTeam);

    const response = await request(app)
      .get(`/api/teams/${sampleTeamId}/candidates?minHours=50&maxHours=10&skillMatchMode=INVALID`)
      .set('Authorization', 'Bearer valid-owner-token');

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(response.body.errors).toEqual(
      expect.objectContaining({
        hours: 'Minimum commitment hours cannot exceed maximum commitment hours.',
        skillMatchMode: 'Skill match mode must be "AND" or "OR".',
      })
    );
  });

  it('returns 200 OK for active team owner with combined multi-parameter filters', async () => {
    mockVerifyIdToken.mockResolvedValue(ownerDecodedToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(ownerParticipant);
    vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(sampleTeam);

    const querySpy = vi
      .spyOn(candidateDirectoryService, 'queryCandidateDirectoryForTeamOwner')
      .mockResolvedValueOnce({
        teamId: sampleTeamId,
        eventId: sampleEventId,
        filters: {
          skills: ['React', 'TypeScript'],
          skillMatchMode: 'AND',
          role: 'Frontend',
          desiredRole: null,
          minHours: 10,
          maxHours: null,
          badge: 'Competitor',
          goal: null,
          search: null,
        },
        candidates: [
          {
            participantId: '88888888-8888-4888-8888-888888888888',
            displayName: 'Alice Coder',
            handle: 'alice_c',
            institution: 'Centennial College',
            primaryRole: 'Frontend',
            desiredRole: 'Frontend',
            commitmentHours: 20,
            goal: 'Project Completion',
            skills: ['React', 'TypeScript', 'Tailwind'],
            matchedSkills: ['React', 'TypeScript'],
            skillsSelfDeclared: true,
            portfolioLinks: [{ url: 'https://alice.dev', label: 'Portfolio', isSelfDeclared: true }],
            selfDeclaredNotice: 'Skills and portfolios are self-declared by participants.',
            hackathonCount: 2,
            experienceBadge: 'Competitor',
            experienceBadgeSelfReported: true,
            selfReportedNotice: 'Hackathon experience history is self-reported.',
            hackathonHistory: [],
            updatedAt: '2026-10-18T12:00:00.000Z',
          },
        ],
        totalEligible: 1,
        totalMatched: 1,
        empty: false,
        message: null,
        exclusions: {
          inactive: 0,
          unavailable: 0,
          confirmed: 2,
          owner: 1,
          totalExcluded: 3,
        },
      });

    const response = await request(app)
      .get(
        `/api/teams/${sampleTeamId}/candidates?skills=React,TypeScript&skillMatchMode=AND&role=Frontend&minHours=10&badge=Competitor`
      )
      .set('Authorization', 'Bearer valid-owner-token');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.teamId).toBe(sampleTeamId);
    expect(response.body.candidates).toHaveLength(1);
    expect(response.body.candidates[0].handle).toBe('alice_c');
    expect(response.body.candidates[0].matchedSkills).toEqual(['React', 'TypeScript']);
    expect(response.body.candidates[0].experienceBadge).toBe('Competitor');
    expect(response.body.exclusions.confirmed).toBe(2);

    expect(querySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        actorParticipantId: ownerParticipant.id,
        teamId: sampleTeamId,
        filters: expect.objectContaining({
          skills: ['React', 'TypeScript'],
          skillMatchMode: 'AND',
          role: 'Frontend',
          minHours: 10,
          badge: 'Competitor',
        }),
      }),
      undefined
    );
  });
});
