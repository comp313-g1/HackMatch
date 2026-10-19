import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import { teamsRepository, type OpenTeamRecord } from '../db/teams.repository.js';
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

describe('GET /api/teams Open Teams Browse & Visitor Privacy (US-013 / Task 4)', () => {
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

  const otherParticipant: Participant = {
    id: '22222222-2222-4222-8222-222222222222',
    firebase_uid: 'fb-other-2',
    email: 'other@example.com',
    full_name: 'Other Participant',
    role: 'PART',
    is_verified: true,
    is_suspended: false,
    created_at: '2026-10-18T00:00:00.000Z',
    updated_at: '2026-10-18T00:00:00.000Z',
  };

  const validTokenHeader = 'Bearer valid-mfa-token';

  const validDecodedToken = {
    uid: 'fb-owner-1',
    email: 'owner@example.com',
    role: 'PART',
    auth_time: AUTH_TIME,
    [MFA_CLAIM]: AUTH_TIME,
  } as unknown as DecodedIdToken;

  const sampleRecord: OpenTeamRecord = {
    team: {
      id: '33333333-3333-4333-8333-333333333333',
      event_id: '44444444-4444-4444-8444-444444444444',
      owner_participant_id: ownerParticipant.id,
      name: 'HackMatch Innovators',
      pitch: 'Building accessible pair-programming platforms with AI',
      goal: 'Project Completion',
      commitment_hours: 20.0,
      communication_link: 'https://discord.gg/hackmatch-secret-link',
      recruitment_status: 'Open',
      disbanded_at: null,
      created_at: '2026-10-18T10:00:00.000Z',
      updated_at: '2026-10-18T10:00:00.000Z',
    },
    event: {
      status: 'Published',
      end_date: '2026-10-30T12:00:00.000Z',
    },
    openVacancies: [
      {
        id: '55555555-5555-4555-8555-555555555555',
        role: 'Frontend',
        skills: ['React', 'TypeScript'],
      },
    ],
    members: [
      {
        participant_id: ownerParticipant.id,
        role: 'Owner',
        full_name: 'Owner Participant',
        handle: 'owner_dev',
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyIdToken.mockResolvedValue(validDecodedToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(ownerParticipant);
    vi.spyOn(teamsRepository, 'findOpenTeamRecords').mockResolvedValue([sampleRecord]);
  });

  describe('Visitor Requests (Unauthenticated)', () => {
    it('returns 200 with visitor projection and no-store when Authorization header is absent', async () => {
      const res = await request(app).get('/api/teams');

      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toContain('no-store');
      expect(teamsRepository.findOpenTeamRecords).toHaveBeenCalledWith({ withMemberIdentities: false });

      expect(res.body).toEqual({
        viewer: 'VISITOR',
        total: 1,
        teams: [
          {
            displayLabel: 'Recruiting team',
            goal: 'Project Completion',
            commitmentHours: 20.0,
            confirmedMembers: 1,
            openSlots: 1,
            vacancies: [
              {
                role: 'Frontend',
                skills: ['React', 'TypeScript'],
              },
            ],
          },
        ],
      });

      const bodyText = JSON.stringify(res.body);
      expect(bodyText).not.toContain('HackMatch Innovators');
      expect(bodyText).not.toContain('Building accessible pair-programming platforms');
      expect(bodyText).not.toContain('https://discord.gg/hackmatch-secret-link');
      expect(bodyText).not.toContain('33333333-3333-4333-8333-333333333333');
      expect(bodyText).not.toContain('owner_dev');
      expect(bodyText).not.toContain('Owner Participant');
      expect(bodyText).not.toContain('55555555-5555-4555-8555-555555555555');
    });

    it('treats empty Bearer header as visitor request without failing auth', async () => {
      const res = await request(app).get('/api/teams').set('Authorization', 'Bearer ');

      expect(res.status).toBe(200);
      expect(res.body.viewer).toBe('VISITOR');
      expect(teamsRepository.findOpenTeamRecords).toHaveBeenCalledWith({ withMemberIdentities: false });
    });
  });

  describe('Participant Requests (Authenticated)', () => {
    it('returns 200 with PART card projection and marks isViewerMember: true when user is a member', async () => {
      const res = await request(app)
        .get('/api/teams')
        .set('Authorization', validTokenHeader);

      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toContain('no-store');
      expect(teamsRepository.findOpenTeamRecords).toHaveBeenCalledWith({ withMemberIdentities: true });

      expect(res.body.viewer).toBe('PART');
      expect(res.body.total).toBe(1);
      expect(res.body.teams).toHaveLength(1);

      const team = res.body.teams[0];
      expect(team.id).toBe('33333333-3333-4333-8333-333333333333');
      expect(team.name).toBe('HackMatch Innovators');
      expect(team.pitch).toBe('Building accessible pair-programming platforms with AI');
      expect(team.goal).toBe('Project Completion');
      expect(team.commitmentHours).toBe(20.0);
      expect(team.confirmedMembers).toBe(1);
      expect(team.openSlots).toBe(1);
      expect(team.isViewerMember).toBe(true);
      expect(team.members).toEqual([
        { displayName: 'owner_dev', role: 'Owner' },
      ]);
      expect(team.vacancies).toEqual([
        {
          id: '55555555-5555-4555-8555-555555555555',
          role: 'Frontend',
          skills: ['React', 'TypeScript'],
        },
      ]);

      const bodyText = JSON.stringify(res.body);
      expect(bodyText).not.toContain('discord.gg');
      expect(bodyText).not.toContain('communicationLink');
      expect(bodyText).not.toContain('communication_link');
    });

    it('marks isViewerMember: false when the participant is not on the team', async () => {
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(otherParticipant);

      const res = await request(app)
        .get('/api/teams')
        .set('Authorization', validTokenHeader);

      expect(res.status).toBe(200);
      expect(res.body.viewer).toBe('PART');
      expect(res.body.teams[0].isViewerMember).toBe(false);
    });
  });

  describe('Authentication Failure Strictness (No Downgrade)', () => {
    it('returns 401 INVALID_TOKEN and does NOT downgrade when token verification fails', async () => {
      const authErr = new Error('Firebase ID token has invalid signature');
      Object.assign(authErr, { code: 'auth/invalid-id-token' });
      mockVerifyIdToken.mockRejectedValue(authErr);

      const res = await request(app)
        .get('/api/teams')
        .set('Authorization', 'Bearer invalid-token');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_TOKEN');
      expect(teamsRepository.findOpenTeamRecords).not.toHaveBeenCalled();
    });

    it('returns 403 MFA_REQUIRED when decoded token lacks MFA claim', async () => {
      mockVerifyIdToken.mockResolvedValue({
        uid: 'fb-owner-1',
        email: 'owner@example.com',
        role: 'PART',
        auth_time: AUTH_TIME,
      });

      const res = await request(app)
        .get('/api/teams')
        .set('Authorization', validTokenHeader);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('MFA_REQUIRED');
      expect(teamsRepository.findOpenTeamRecords).not.toHaveBeenCalled();
    });

    it('returns 403 EMAIL_NOT_VERIFIED when participant is not verified', async () => {
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue({
        ...ownerParticipant,
        is_verified: false,
      });

      const res = await request(app)
        .get('/api/teams')
        .set('Authorization', validTokenHeader);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
      expect(teamsRepository.findOpenTeamRecords).not.toHaveBeenCalled();
    });

    it('returns 403 ACCOUNT_SUSPENDED when participant is suspended', async () => {
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue({
        ...ownerParticipant,
        is_suspended: true,
      });

      const res = await request(app)
        .get('/api/teams')
        .set('Authorization', validTokenHeader);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('ACCOUNT_SUSPENDED');
      expect(teamsRepository.findOpenTeamRecords).not.toHaveBeenCalled();
    });
  });

  describe('Query Validation & Error Responses', () => {
    it('returns 400 VALIDATION_ERROR when minSlots is below 1', async () => {
      const res = await request(app).get('/api/teams?minSlots=0');

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors.minSlots).toBeDefined();
      expect(res.headers['cache-control']).toContain('no-store');
      expect(teamsRepository.findOpenTeamRecords).not.toHaveBeenCalled();
    });

    it('returns 400 VALIDATION_ERROR when role is invalid', async () => {
      const res = await request(app).get('/api/teams?role=Wizard');

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors.role).toBeDefined();
      expect(teamsRepository.findOpenTeamRecords).not.toHaveBeenCalled();
    });

    it('returns 400 VALIDATION_ERROR when skills exceeds 5 tags', async () => {
      const res = await request(app).get('/api/teams?skills=a,b,c,d,e,f');

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors.skills).toBeDefined();
      expect(teamsRepository.findOpenTeamRecords).not.toHaveBeenCalled();
    });

    it('passes valid query filters through to filtering logic', async () => {
      const res = await request(app).get('/api/teams?role=Backend');

      expect(res.status).toBe(200);
      expect(res.body.viewer).toBe('VISITOR');
      expect(res.body.total).toBe(0);
      expect(res.body.teams).toHaveLength(0);
      expect(teamsRepository.findOpenTeamRecords).toHaveBeenCalled();
    });
  });

  describe('Repository Error Handling', () => {
    it('returns 500 Internal Server Error without leaking raw error message or stack trace', async () => {
      vi.spyOn(teamsRepository, 'findOpenTeamRecords').mockRejectedValue(
        new Error('PostgreSQL connection dropped')
      );

      const res = await request(app).get('/api/teams');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Internal Server Error');
      expect(JSON.stringify(res.body)).not.toContain('PostgreSQL connection dropped');
    });
  });

  describe('Route Regression Guard', () => {
    it('ensures GET /api/teams/mine routes to getMyTeamHandler and rejects unauthenticated request', async () => {
      const res = await request(app).get('/api/teams/mine');

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });
  });
});
