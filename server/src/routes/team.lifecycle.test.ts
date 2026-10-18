import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import { teamsRepository } from '../db/teams.repository.js';
import { TeamServiceError } from '../services/teamErrors.js';
import type { TeamLifecycleReason } from '../services/teamLifecycle.js';
import {
  ownerParticipant,
  otherParticipant,
  sampleTeamId,
  sampleVacancyId,
  sampleTeam,
  sampleParts,
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

describe('Team Lifecycle Lock Matrix & Member Removal (US-012 / Task 7 / #124)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockVerifyIdToken.mockResolvedValue(validOwnerDecodedToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(ownerParticipant);
    vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(sampleTeam);
    vi.spyOn(teamsRepository, 'getTeamViewParts').mockResolvedValue(sampleParts);
  });

  describe('Lifecycle Lock Matrix: Mutating Routes Blocked on Non-Mutable States', () => {
    const lifecycleReasons: Array<{ label: string; reason: TeamLifecycleReason }> = [
      { label: 'Locked team', reason: 'Locked' },
      { label: 'Disbanded team', reason: 'Disbanded' },
      { label: 'Archived event', reason: 'EventNotRecruiting' },
      { label: 'Disabled event', reason: 'EventNotRecruiting' },
      { label: 'Concluded/ended event', reason: 'EventNotRecruiting' },
    ];

    const mutatingRoutes: Array<{
      name: string;
      method: 'patch' | 'post' | 'delete';
      path: string;
      body?: Record<string, unknown>;
      setupMock: (reason: TeamLifecycleReason) => void;
    }> = [
      {
        name: 'PATCH /api/teams/:teamId (updateListing)',
        method: 'patch',
        path: `/api/teams/${sampleTeamId}`,
        body: { pitch: 'Updated recruitment pitch' },
        setupMock: (reason) => {
          vi.spyOn(teamsRepository, 'updateTeamListing').mockRejectedValue(
            new TeamServiceError('TEAM_NOT_MUTABLE', { reason })
          );
        },
      },
      {
        name: 'POST /api/teams/:teamId/vacancies (addVacancy)',
        method: 'post',
        path: `/api/teams/${sampleTeamId}/vacancies`,
        body: { role: 'Frontend', skills: ['React', 'TypeScript'] },
        setupMock: (reason) => {
          vi.spyOn(teamsRepository, 'addTeamVacancy').mockRejectedValue(
            new TeamServiceError('TEAM_NOT_MUTABLE', { reason })
          );
        },
      },
      {
        name: 'PATCH /api/teams/:teamId/vacancies/:vacancyId (updateVacancy)',
        method: 'patch',
        path: `/api/teams/${sampleTeamId}/vacancies/${sampleVacancyId}`,
        body: { role: 'Backend', skills: ['Node.js'] },
        setupMock: (reason) => {
          vi.spyOn(teamsRepository, 'updateTeamVacancy').mockRejectedValue(
            new TeamServiceError('TEAM_NOT_MUTABLE', { reason })
          );
        },
      },
      {
        name: 'DELETE /api/teams/:teamId/vacancies/:vacancyId (removeVacancy)',
        method: 'delete',
        path: `/api/teams/${sampleTeamId}/vacancies/${sampleVacancyId}`,
        setupMock: (reason) => {
          vi.spyOn(teamsRepository, 'removeTeamVacancy').mockRejectedValue(
            new TeamServiceError('TEAM_NOT_MUTABLE', { reason })
          );
        },
      },
      {
        name: 'POST /api/teams/:teamId/disband (disbandTeam)',
        method: 'post',
        path: `/api/teams/${sampleTeamId}/disband`,
        setupMock: (reason) => {
          vi.spyOn(teamsRepository, 'disbandTeam').mockRejectedValue(
            new TeamServiceError('TEAM_NOT_MUTABLE', { reason })
          );
        },
      },
      {
        name: 'POST /api/teams/:teamId/members/:participantId/remove (removeMember)',
        method: 'post',
        path: `/api/teams/${sampleTeamId}/members/${otherParticipant.id}/remove`,
        body: { reason: 'No longer able to participate in event' },
        setupMock: (reason) => {
          vi.spyOn(teamsRepository, 'removeTeamMember').mockRejectedValue(
            new TeamServiceError('TEAM_NOT_MUTABLE', { reason })
          );
        },
      },
    ];

    describe.each(mutatingRoutes)('$name', (routeConfig) => {
      describe.each(lifecycleReasons)('when team/event state is $label ($reason)', ({ reason }) => {
        it('rejects mutation with 409 TEAM_NOT_MUTABLE and structured details without stack/SQL leaks', async () => {
          routeConfig.setupMock(reason);

          const req = request(app)[routeConfig.method](routeConfig.path)
            .set('Authorization', validTokenHeader);

          const res = routeConfig.body ? await req.send(routeConfig.body) : await req;

          expect(res.status).toBe(409);
          expect(res.body.code).toBe('TEAM_NOT_MUTABLE');
          expect(res.body.error).toBe('Team recruitment is not open or event is concluded.');
          expect(res.body.details).toEqual({ reason });

          // Guarantee zero stack traces or raw database leaks
          expect(res.body.stack).toBeUndefined();
          const serialized = JSON.stringify(res.body);
          expect(serialized).not.toMatch(/SELECT|UPDATE|INSERT|DELETE|FROM\s+teams|FROM\s+events/i);
        });
      });
    });
  });

  describe('Read-only view retains access when lifecycle is not mutable', () => {
    it('returns 200 with lifecycle.mutable=false and reason="Locked" for Locked teams', async () => {
      vi.spyOn(teamsRepository, 'getTeamViewParts').mockResolvedValue({
        ...sampleParts,
        team: { ...sampleTeam, recruitment_status: 'Locked' },
        event: { max_team_size: 4, status: 'Published', end_date: '2099-01-01T00:00:00.000Z' },
      });

      const res = await request(app)
        .get(`/api/teams/${sampleTeamId}`)
        .set('Authorization', validTokenHeader);

      expect(res.status).toBe(200);
      expect(res.body.team.lifecycle).toEqual({
        mutable: false,
        reason: 'Locked',
      });
      expect(res.body.team.recruitmentStatus).toBe('Locked');
    });

    it('returns 200 with lifecycle.mutable=false and reason="Disbanded" for Disbanded teams', async () => {
      vi.spyOn(teamsRepository, 'getTeamViewParts').mockResolvedValue({
        ...sampleParts,
        team: { ...sampleTeam, recruitment_status: 'Disbanded' },
        event: { max_team_size: 4, status: 'Published', end_date: '2099-01-01T00:00:00.000Z' },
      });

      const res = await request(app)
        .get(`/api/teams/${sampleTeamId}`)
        .set('Authorization', validTokenHeader);

      expect(res.status).toBe(200);
      expect(res.body.team.lifecycle).toEqual({
        mutable: false,
        reason: 'Disbanded',
      });
      expect(res.body.team.recruitmentStatus).toBe('Disbanded');
    });

    it('returns 200 with lifecycle.mutable=false and reason="EventNotRecruiting" when event ended', async () => {
      vi.spyOn(teamsRepository, 'getTeamViewParts').mockResolvedValue({
        ...sampleParts,
        team: { ...sampleTeam, recruitment_status: 'Open' },
        event: { max_team_size: 4, status: 'Published', end_date: '2020-01-01T00:00:00.000Z' },
      });

      const res = await request(app)
        .get(`/api/teams/${sampleTeamId}`)
        .set('Authorization', validTokenHeader);

      expect(res.status).toBe(200);
      expect(res.body.team.lifecycle).toEqual({
        mutable: false,
        reason: 'EventNotRecruiting',
      });
    });
  });

  describe('POST /api/teams/:teamId/members/:participantId/remove', () => {
    it('successfully removes a confirmed team member and restores availability', async () => {
      const removeSpy = vi.spyOn(teamsRepository, 'removeTeamMember').mockResolvedValue({
        availabilityRestored: true,
      });

      const res = await request(app)
        .post(`/api/teams/${sampleTeamId}/members/${otherParticipant.id}/remove`)
        .set('Authorization', validTokenHeader)
        .send({ reason: 'Member requested to work solo' });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Team member removed.');
      expect(res.body.availabilityRestored).toBe(true);
      expect(res.body.team).toBeDefined();
      expect(res.body.team.id).toBe(sampleTeamId);
      expect(removeSpy).toHaveBeenCalledWith(
        ownerParticipant.id,
        sampleTeamId,
        otherParticipant.id,
        'Member requested to work solo'
      );
    });

    it('rejects owner self-removal with 409 CANNOT_REMOVE_OWNER', async () => {
      vi.spyOn(teamsRepository, 'removeTeamMember').mockRejectedValue(
        new TeamServiceError('CANNOT_REMOVE_OWNER')
      );

      const res = await request(app)
        .post(`/api/teams/${sampleTeamId}/members/${ownerParticipant.id}/remove`)
        .set('Authorization', validTokenHeader)
        .send({ reason: 'Owner trying to self-remove' });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CANNOT_REMOVE_OWNER');
      expect(res.body.error).toBe('Team owner cannot be removed. To step down, disband the team.');
    });

    it('returns 404 MEMBER_NOT_FOUND when target participant is not confirmed on team', async () => {
      vi.spyOn(teamsRepository, 'removeTeamMember').mockRejectedValue(
        new TeamServiceError('MEMBER_NOT_FOUND')
      );

      const res = await request(app)
        .post(`/api/teams/${sampleTeamId}/members/${otherParticipant.id}/remove`)
        .set('Authorization', validTokenHeader)
        .send({ reason: 'Inactive member' });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('MEMBER_NOT_FOUND');
      expect(res.body.error).toBe('Confirmed member not found on this team.');
    });

    it('rejects missing or empty removal reason with 400 VALIDATION_ERROR', async () => {
      const emptyRes = await request(app)
        .post(`/api/teams/${sampleTeamId}/members/${otherParticipant.id}/remove`)
        .set('Authorization', validTokenHeader)
        .send({ reason: '   ' });

      expect(emptyRes.status).toBe(400);
      expect(emptyRes.body.code).toBe('VALIDATION_ERROR');
      expect(emptyRes.body.errors.reason).toBe('Removal reason is required.');

      const missingRes = await request(app)
        .post(`/api/teams/${sampleTeamId}/members/${otherParticipant.id}/remove`)
        .set('Authorization', validTokenHeader)
        .send({});

      expect(missingRes.status).toBe(400);
      expect(missingRes.body.code).toBe('VALIDATION_ERROR');
      expect(missingRes.body.errors.reason).toBe('Removal reason is required.');
    });

    it('rejects removal reason exceeding 500 characters with 400 VALIDATION_ERROR', async () => {
      const longReason = 'x'.repeat(501);
      const res = await request(app)
        .post(`/api/teams/${sampleTeamId}/members/${otherParticipant.id}/remove`)
        .set('Authorization', validTokenHeader)
        .send({ reason: longReason });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors.reason).toBe('Removal reason cannot exceed 500 characters.');
    });

    it('rejects forbidden extra properties in body with 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .post(`/api/teams/${sampleTeamId}/members/${otherParticipant.id}/remove`)
        .set('Authorization', validTokenHeader)
        .send({ reason: 'Valid reason', forbiddenKey: 'attack' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.errors.forbiddenKey).toBe('This field cannot be set.');
    });

    it('rejects invalid teamId and participantId UUID formats with 400 VALIDATION_ERROR', async () => {
      const badTeamRes = await request(app)
        .post(`/api/teams/not-a-uuid/members/${otherParticipant.id}/remove`)
        .set('Authorization', validTokenHeader)
        .send({ reason: 'Valid reason' });

      expect(badTeamRes.status).toBe(400);
      expect(badTeamRes.body.errors.teamId).toBe('Invalid team ID format.');

      const badMemberRes = await request(app)
        .post(`/api/teams/${sampleTeamId}/members/invalid-member-id/remove`)
        .set('Authorization', validTokenHeader)
        .send({ reason: 'Valid reason' });

      expect(badMemberRes.status).toBe(400);
      expect(badMemberRes.body.errors.participantId).toBe('Invalid participant ID format.');
    });

    it('rejects non-owner actor with 403 FORBIDDEN_NOT_TEAM_OWNER and prevents repo invocation', async () => {
      mockVerifyIdToken.mockResolvedValue(validOtherDecodedToken);
      vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(otherParticipant);
      const removeSpy = vi.spyOn(teamsRepository, 'removeTeamMember');

      const res = await request(app)
        .post(`/api/teams/${sampleTeamId}/members/${otherParticipant.id}/remove`)
        .set('Authorization', otherTokenHeader)
        .send({ reason: 'Non-owner attempting removal' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_NOT_TEAM_OWNER');
      expect(removeSpy).not.toHaveBeenCalled();
    });
  });
});
