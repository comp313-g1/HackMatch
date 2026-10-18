import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import { teamsRepository } from '../db/teams.repository.js';
import { MFA_CLAIM } from '../utils/mfaClaim.js';
import type { Participant, Team, TeamMembership, TeamVacancy } from '../db/types.js';

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

describe('Express Team Listing & Vacancy Endpoints (US-012 / #120)', () => {
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

  const validDecodedToken = {
    uid: 'fb-owner-1',
    email: 'owner@example.com',
    role: 'PART',
    auth_time: AUTH_TIME,
    [MFA_CLAIM]: AUTH_TIME,
  } as unknown as DecodedIdToken;

  const validTokenHeader = 'Bearer valid-mfa-token';

  const sampleTeamId = '33333333-3333-4333-8333-333333333333';
  const sampleEventId = '44444444-4444-4444-8444-444444444444';
  const sampleVacancyId = '55555555-5555-4555-8555-555555555555';

  const sampleTeam: Team = {
    id: sampleTeamId,
    event_id: sampleEventId,
    owner_participant_id: ownerParticipant.id,
    name: 'HackMatch Innovators',
    pitch: 'Building accessible pair-programming platforms',
    goal: 'Project Completion',
    commitment_hours: 20.0,
    communication_link: 'https://discord.gg/hackmatch',
    recruitment_status: 'Open',
    disbanded_at: null,
    created_at: '2026-10-18T10:00:00.000Z',
    updated_at: '2026-10-18T10:00:00.000Z',
  };

  const sampleMembership: TeamMembership = {
    id: '66666666-6666-4666-8666-666666666666',
    team_id: sampleTeamId,
    event_id: sampleEventId,
    participant_id: ownerParticipant.id,
    role: 'Owner',
    status: 'Confirmed',
    removal_reason: null,
    joined_at: '2026-10-18T10:00:00.000Z',
    ended_at: null,
    created_at: '2026-10-18T10:00:00.000Z',
    updated_at: '2026-10-18T10:00:00.000Z',
  };

  const sampleVacancy: TeamVacancy = {
    id: sampleVacancyId,
    team_id: sampleTeamId,
    role: 'Frontend',
    skills: ['React', 'TypeScript'],
    status: 'Open',
    removed_at: null,
    created_at: '2026-10-18T10:05:00.000Z',
    updated_at: '2026-10-18T10:05:00.000Z',
  };

  const sampleParts = {
    team: sampleTeam,
    event: { max_team_size: 4 },
    members: [
      {
        participant_id: ownerParticipant.id,
        role: 'Owner' as const,
        joined_at: '2026-10-18T10:00:00.000Z',
        handle: 'owner_lead',
        full_name: 'Owner Participant',
      },
    ],
    vacancies: [sampleVacancy],
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    mockVerifyIdToken.mockResolvedValue(validDecodedToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(ownerParticipant);
  });

  describe('POST /api/teams (Team Creation)', () => {
    it('returns 201 with allow-listed TeamView and passes authenticated actor id regardless of body payload', async () => {
      const createSpy = vi.spyOn(teamsRepository, 'createTeamWithOwner').mockResolvedValue({
        team: sampleTeam,
        membership: sampleMembership,
      });
      vi.spyOn(teamsRepository, 'getTeamViewParts').mockResolvedValue(sampleParts);

      const response = await request(app)
        .post('/api/teams')
        .set('Authorization', validTokenHeader)
        .send({
          eventId: sampleEventId,
          name: 'HackMatch Innovators',
          pitch: 'Building accessible pair-programming platforms',
          goal: 'Project Completion',
          commitmentHours: 20,
          communicationLink: 'https://discord.gg/hackmatch',
        });

      expect(response.status).toBe(201);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerParticipantId: ownerParticipant.id, // Strictly uses authenticated actor ID
          eventId: sampleEventId,
          name: 'HackMatch Innovators',
        })
      );

      // Verify safe projection: no sensitive DB columns leaked
      expect(response.body.team.id).toBe(sampleTeamId);
      expect(response.body.team.limits.remainingCapacity).toBe(2);
      expect(response.body.team.owner_participant_id).toBeUndefined();
      expect(response.body.team.members[0].email).toBeUndefined();
      expect(response.body.team.members[0].firebase_uid).toBeUndefined();
    });

    it('rejects with 400 VALIDATION_ERROR and does not call repo when unknown key like ownerParticipantId is provided', async () => {
      const createSpy = vi.spyOn(teamsRepository, 'createTeamWithOwner');

      const response = await request(app)
        .post('/api/teams')
        .set('Authorization', validTokenHeader)
        .send({
          eventId: sampleEventId,
          name: 'HackMatch Innovators',
          pitch: 'Building accessible pair-programming platforms',
          goal: 'Project Completion',
          commitmentHours: 20,
          communicationLink: 'https://discord.gg/hackmatch',
          ownerParticipantId: 'attacker-injected-id',
        });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.errors.ownerParticipantId).toBe('This field cannot be set.');
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('rejects with 400 VALIDATION_ERROR and does not call repo when fields violate boundaries', async () => {
      const createSpy = vi.spyOn(teamsRepository, 'createTeamWithOwner');

      const response = await request(app)
        .post('/api/teams')
        .set('Authorization', validTokenHeader)
        .send({
          eventId: sampleEventId,
          name: 'HackMatch Innovators',
          pitch: 'a'.repeat(501),
          goal: 'InvalidGoal',
          commitmentHours: 168.1,
          communicationLink: 'http://insecure.com',
        });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.errors.pitch).toBeDefined();
      expect(response.body.errors.goal).toBeDefined();
      expect(response.body.errors.commitmentHours).toBeDefined();
      expect(response.body.errors.communicationLink).toBeDefined();
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('rejects with 400 VALIDATION_ERROR when request body is not a JSON object', async () => {
      const response = await request(app)
        .post('/api/teams')
        .set('Authorization', validTokenHeader)
        .send(['invalid', 'array', 'body']);

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('Authentication & Authorization Pipeline', () => {
    it('rejects with 401 UNAUTHORIZED when Authorization header is missing', async () => {
      const response = await request(app)
        .post('/api/teams')
        .send({ eventId: sampleEventId, name: 'Team' });

      expect(response.status).toBe(401);
      expect(response.body.code).toBe('UNAUTHORIZED');
    });

    it('rejects with 403 MFA_REQUIRED when token has no MFA claim', async () => {
      mockVerifyIdToken.mockResolvedValue({
        uid: 'fb-owner-1',
        email: 'owner@example.com',
        role: 'PART',
        auth_time: AUTH_TIME,
      });

      const response = await request(app)
        .post('/api/teams')
        .set('Authorization', validTokenHeader)
        .send({ eventId: sampleEventId, name: 'Team' });

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('MFA_REQUIRED');
    });

    it('rejects with 403 FORBIDDEN_ROLE when actor role is ADMIN', async () => {
      mockVerifyIdToken.mockResolvedValue({
        ...validDecodedToken,
        role: 'ADMIN',
      });
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue({
        ...ownerParticipant,
        role: 'ADMIN',
      });

      const response = await request(app)
        .post('/api/teams')
        .set('Authorization', validTokenHeader)
        .send({ eventId: sampleEventId, name: 'Team' });

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('FORBIDDEN_ROLE');
    });

    it('rejects with 403 EMAIL_NOT_VERIFIED when account is not verified', async () => {
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue({
        ...ownerParticipant,
        is_verified: false,
      });

      const response = await request(app)
        .post('/api/teams')
        .set('Authorization', validTokenHeader)
        .send({ eventId: sampleEventId, name: 'Team' });

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('EMAIL_NOT_VERIFIED');
    });

    it('rejects with 403 ACCOUNT_SUSPENDED when participant is suspended', async () => {
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue({
        ...ownerParticipant,
        is_suspended: true,
      });

      const response = await request(app)
        .post('/api/teams')
        .set('Authorization', validTokenHeader)
        .send({ eventId: sampleEventId, name: 'Team' });

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('ACCOUNT_SUSPENDED');
    });
  });

  describe('GET /api/teams/mine', () => {
    it('returns 400 VALIDATION_ERROR when eventId query param is malformed', async () => {
      const response = await request(app)
        .get('/api/teams/mine?eventId=not-a-uuid')
        .set('Authorization', validTokenHeader);

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('returns { team: null } when participant has no confirmed team in the event', async () => {
      vi.spyOn(teamsRepository, 'findConfirmedTeamIdForParticipant').mockResolvedValue(null);

      const response = await request(app)
        .get(`/api/teams/mine?eventId=${sampleEventId}`)
        .set('Authorization', validTokenHeader);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ team: null });
    });

    it('returns { team: TeamView } when participant has a confirmed team', async () => {
      vi.spyOn(teamsRepository, 'findConfirmedTeamIdForParticipant').mockResolvedValue(sampleTeamId);
      vi.spyOn(teamsRepository, 'getTeamViewParts').mockResolvedValue(sampleParts);

      const response = await request(app)
        .get(`/api/teams/mine?eventId=${sampleEventId}`)
        .set('Authorization', validTokenHeader);

      expect(response.status).toBe(200);
      expect(response.body.team.id).toBe(sampleTeamId);
    });
  });

  describe('GET /api/teams/:teamId', () => {
    it('returns 400 VALIDATION_ERROR and does not query repo when teamId is not a UUID', async () => {
      const spy = vi.spyOn(teamsRepository, 'findTeamById');

      const response = await request(app)
        .get('/api/teams/invalid-uuid-format')
        .set('Authorization', validTokenHeader);

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(spy).not.toHaveBeenCalled();
    });

    it('returns 403 FORBIDDEN_NOT_TEAM_OWNER when actor is not the team owner', async () => {
      vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue({
        ...sampleTeam,
        owner_participant_id: otherParticipant.id,
      });

      const response = await request(app)
        .get(`/api/teams/${sampleTeamId}`)
        .set('Authorization', validTokenHeader);

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('FORBIDDEN_NOT_TEAM_OWNER');
    });

    it('returns 200 with TeamView for verified owner', async () => {
      vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(sampleTeam);
      vi.spyOn(teamsRepository, 'getTeamViewParts').mockResolvedValue(sampleParts);

      const response = await request(app)
        .get(`/api/teams/${sampleTeamId}`)
        .set('Authorization', validTokenHeader);

      expect(response.status).toBe(200);
      expect(response.body.team.id).toBe(sampleTeamId);
    });
  });

  describe('PATCH /api/teams/:teamId (Update Listing)', () => {
    it('updates listing and returns refreshed TeamView', async () => {
      const updateSpy = vi.spyOn(teamsRepository, 'updateTeamListing').mockResolvedValue(sampleTeam);
      vi.spyOn(teamsRepository, 'getTeamViewParts').mockResolvedValue(sampleParts);

      const response = await request(app)
        .patch(`/api/teams/${sampleTeamId}`)
        .set('Authorization', validTokenHeader)
        .send({ pitch: 'Refined pitch for the team' });

      expect(response.status).toBe(200);
      expect(updateSpy).toHaveBeenCalledWith(ownerParticipant.id, sampleTeamId, {
        pitch: 'Refined pitch for the team',
      });
      expect(response.body.team.id).toBe(sampleTeamId);
    });

    it('rejects with 400 VALIDATION_ERROR and does not call repo when no recognized fields are provided ({})', async () => {
      const updateSpy = vi.spyOn(teamsRepository, 'updateTeamListing');

      const response = await request(app)
        .patch(`/api/teams/${sampleTeamId}`)
        .set('Authorization', validTokenHeader)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.errors._form).toBe('No changes provided.');
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('rejects with 400 VALIDATION_ERROR and does not call repo when forbidden keys are provided', async () => {
      const updateSpy = vi.spyOn(teamsRepository, 'updateTeamListing');

      const response = await request(app)
        .patch(`/api/teams/${sampleTeamId}`)
        .set('Authorization', validTokenHeader)
        .send({ eventId: sampleEventId });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.errors.eventId).toBe('This field cannot be set.');
      expect(updateSpy).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/teams/:teamId/vacancies (Add Vacancy)', () => {
    it('adds vacancy and returns refreshed TeamView', async () => {
      const addSpy = vi.spyOn(teamsRepository, 'addTeamVacancy').mockResolvedValue(sampleVacancy);
      vi.spyOn(teamsRepository, 'getTeamViewParts').mockResolvedValue(sampleParts);

      const response = await request(app)
        .post(`/api/teams/${sampleTeamId}/vacancies`)
        .set('Authorization', validTokenHeader)
        .send({ role: 'Frontend', skills: ['React', 'TypeScript'] });

      expect(response.status).toBe(200);
      expect(addSpy).toHaveBeenCalledWith(
        ownerParticipant.id,
        sampleTeamId,
        'Frontend',
        ['React', 'TypeScript']
      );
      expect(response.body.team.id).toBe(sampleTeamId);
    });

    it('rejects with 400 VALIDATION_ERROR and does not call repo when role is invalid or skills > 10', async () => {
      const addSpy = vi.spyOn(teamsRepository, 'addTeamVacancy');

      const response = await request(app)
        .post(`/api/teams/${sampleTeamId}/vacancies`)
        .set('Authorization', validTokenHeader)
        .send({ role: 'Designer', skills: Array.from({ length: 11 }, (_, i) => `Skill${i}`) });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.errors.role).toBeDefined();
      expect(response.body.errors.skills).toBeDefined();
      expect(addSpy).not.toHaveBeenCalled();
    });

    it('maps CAPACITY_EXCEEDED database error to 409 with structured error, errors.vacancies, and limits', async () => {
      vi.spyOn(teamsRepository, 'addTeamVacancy').mockRejectedValue({
        message: 'CAPACITY_EXCEEDED',
        code: 'P0001',
        detail: JSON.stringify({ max: 4, confirmed: 3, open: 1 }),
      });

      const response = await request(app)
        .post(`/api/teams/${sampleTeamId}/vacancies`)
        .set('Authorization', validTokenHeader)
        .send({ role: 'Backend', skills: [] });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('CAPACITY_EXCEEDED');
      expect(response.body.error).toBe(
        'This team can have at most 4 members including open slots. 3 confirmed + 1 open = 4.'
      );
      expect(response.body.errors).toEqual({
        vacancies:
          'This team can have at most 4 members including open slots. 3 confirmed + 1 open = 4.',
      });
      expect(response.body.limits).toEqual({
        maxTeamSize: 4,
        confirmedMembers: 3,
        openSlots: 1,
      });
    });
  });

  describe('PATCH /api/teams/:teamId/vacancies/:vacancyId (Update Vacancy)', () => {
    it('updates vacancy and returns refreshed TeamView', async () => {
      const updateSpy = vi.spyOn(teamsRepository, 'updateTeamVacancy').mockResolvedValue(sampleVacancy);
      vi.spyOn(teamsRepository, 'getTeamViewParts').mockResolvedValue(sampleParts);

      const response = await request(app)
        .patch(`/api/teams/${sampleTeamId}/vacancies/${sampleVacancyId}`)
        .set('Authorization', validTokenHeader)
        .send({ role: 'Frontend', skills: ['React', 'Next.js'] });

      expect(response.status).toBe(200);
      expect(updateSpy).toHaveBeenCalledWith(
        ownerParticipant.id,
        sampleTeamId,
        sampleVacancyId,
        'Frontend',
        ['React', 'Next.js']
      );
      expect(response.body.team.id).toBe(sampleTeamId);
    });

    it('rejects with 400 VALIDATION_ERROR and does not call repo when unknown keys are provided', async () => {
      const updateSpy = vi.spyOn(teamsRepository, 'updateTeamVacancy');

      const response = await request(app)
        .patch(`/api/teams/${sampleTeamId}/vacancies/${sampleVacancyId}`)
        .set('Authorization', validTokenHeader)
        .send({ role: 'Frontend', ownerParticipantId: 'hacked' });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.errors.ownerParticipantId).toBe('This field cannot be set.');
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('returns 404 when vacancy is not found or not open', async () => {
      vi.spyOn(teamsRepository, 'updateTeamVacancy').mockRejectedValue({
        message: 'VACANCY_NOT_FOUND',
        code: 'P0001',
      });

      const response = await request(app)
        .patch(`/api/teams/${sampleTeamId}/vacancies/${sampleVacancyId}`)
        .set('Authorization', validTokenHeader)
        .send({ role: 'Frontend', skills: [] });

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('VACANCY_NOT_FOUND');
    });
  });
});
