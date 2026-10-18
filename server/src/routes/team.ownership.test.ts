import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import { teamsRepository } from '../db/teams.repository.js';
import {
  ownerParticipant,
  otherParticipant,
  adminParticipant,
  sampleTeamId,
  sampleTeamId2,
  sampleTeam,
  sampleTeamOther,
  sampleTeamEvent2,
  sampleVacancy,
  sampleParts,
  validOwnerDecodedToken,
  validOtherDecodedToken,
  validAdminDecodedToken,
  validTokenHeader,
  otherTokenHeader,
  adminTokenHeader,
  OWNER_ONLY_ROUTES,
  type OwnerOnlyRoute,
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

function executeRoute(
  route: OwnerOnlyRoute,
  teamId: string,
  tokenHeader: string,
  body?: Record<string, unknown>
) {
  const req = request(app)[route.method](route.path(teamId)).set('Authorization', tokenHeader);
  if (body) {
    return req.send(body);
  }
  if (route.validPayload && (route.method === 'post' || route.method === 'patch')) {
    return req.send(route.validPayload);
  }
  return req;
}

describe('Team Ownership & Access Control Matrix (US-012 / Task 5 / #122)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockVerifyIdToken.mockResolvedValue(validOwnerDecodedToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(ownerParticipant);
    vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(sampleTeam);
    vi.spyOn(teamsRepository, 'getTeamViewParts').mockResolvedValue(sampleParts);
    vi.spyOn(teamsRepository, 'updateTeamListing').mockResolvedValue(sampleTeam);
    vi.spyOn(teamsRepository, 'addTeamVacancy').mockResolvedValue(sampleVacancy);
    vi.spyOn(teamsRepository, 'updateTeamVacancy').mockResolvedValue(sampleVacancy);
    vi.spyOn(teamsRepository, 'removeTeamVacancy').mockResolvedValue({ canceledRequests: 0 });
    vi.spyOn(teamsRepository, 'disbandTeam').mockResolvedValue({ releasedMembers: 1, canceledRequests: 0 });
    vi.spyOn(teamsRepository, 'removeTeamMember').mockResolvedValue({ availabilityRestored: false });
  });


  describe('Table-driven OWNER_ONLY_ROUTES Matrix', () => {
    describe.each(OWNER_ONLY_ROUTES)('$name', (route) => {
      it('allows team owner to perform operation successfully', async () => {
        const response = await executeRoute(route, sampleTeamId, validTokenHeader);

        expect(response.status).toBe(route.expectedStatus);
        expect(response.headers['cache-control']).toBe('no-store');
      });

      it('rejects other verified participant with 403 FORBIDDEN_NOT_TEAM_OWNER', async () => {
        mockVerifyIdToken.mockResolvedValue(validOtherDecodedToken);
        vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(otherParticipant);

        const response = await executeRoute(route, sampleTeamId, otherTokenHeader);

        expect(response.status).toBe(403);
        expect(response.body.code).toBe('FORBIDDEN_NOT_TEAM_OWNER');
        expect(response.headers['cache-control']).toBe('no-store');
      });

      it('rejects with 404 TEAM_NOT_FOUND when team does not exist', async () => {
        vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(null);

        const response = await executeRoute(route, sampleTeamId, validTokenHeader);

        expect(response.status).toBe(404);
        expect(response.body.code).toBe('TEAM_NOT_FOUND');
        expect(response.headers['cache-control']).toBe('no-store');
      });

      it('rejects ADMIN user with 403 FORBIDDEN_ROLE (ADMIN gains no ownership, FR-082)', async () => {
        mockVerifyIdToken.mockResolvedValue(validAdminDecodedToken);
        vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(adminParticipant);

        const response = await executeRoute(route, sampleTeamId, adminTokenHeader);

        expect(response.status).toBe(403);
        expect(response.body.code).toBe('FORBIDDEN_ROLE');
        expect(response.headers['cache-control']).toBe('no-store');
      });

      it('rejects suspended owner with 403 ACCOUNT_SUSPENDED', async () => {
        vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue({
          ...ownerParticipant,
          is_suspended: true,
        });

        const response = await executeRoute(route, sampleTeamId, validTokenHeader);

        expect(response.status).toBe(403);
        expect(response.body.code).toBe('ACCOUNT_SUSPENDED');
      });

      it('rejects unverified owner with 403 EMAIL_NOT_VERIFIED', async () => {
        vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue({
          ...ownerParticipant,
          is_verified: false,
        });

        const response = await executeRoute(route, sampleTeamId, validTokenHeader);

        expect(response.status).toBe(403);
        expect(response.body.code).toBe('EMAIL_NOT_VERIFIED');
      });

      it('returns 500 without leaking internal error details when repository throws', async () => {
        const secretError = new Error('PG_INTERNAL_DB_CRASH_SECRET_MESSAGE');
        vi.spyOn(teamsRepository, 'findTeamById').mockRejectedValue(secretError);

        const response = await executeRoute(route, sampleTeamId, validTokenHeader);

        expect(response.status).toBe(500);
        expect(response.text).not.toContain('PG_INTERNAL_DB_CRASH_SECRET_MESSAGE');
      });
    });
  });

  describe('Forged Identifiers & Mutation Isolation ("denied actions change no data")', () => {
    it('denies forged payload identifiers on a foreign team and does NOT call repository mutation functions', async () => {
      const updateListingSpy = vi.spyOn(teamsRepository, 'updateTeamListing');
      const addVacancySpy = vi.spyOn(teamsRepository, 'addTeamVacancy');
      const updateVacancySpy = vi.spyOn(teamsRepository, 'updateTeamVacancy');
      const removeVacancySpy = vi.spyOn(teamsRepository, 'removeTeamVacancy');
      const disbandTeamSpy = vi.spyOn(teamsRepository, 'disbandTeam');
      const createTeamSpy = vi.spyOn(teamsRepository, 'createTeamWithOwner');

      vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(sampleTeamOther);

      // Attempt PATCH on foreign team with forged body
      const patchRes = await request(app)
        .patch(`/api/teams/${sampleTeamId2}`)
        .set('Authorization', validTokenHeader)
        .send({
          ownerParticipantId: ownerParticipant.id,
          participantId: ownerParticipant.id,
          eventId: sampleTeam.event_id,
          pitch: 'Forged takeover pitch',
        });

      expect([400, 403]).toContain(patchRes.status);
      expect(updateListingSpy).not.toHaveBeenCalled();
      expect(addVacancySpy).not.toHaveBeenCalled();
      expect(updateVacancySpy).not.toHaveBeenCalled();
      expect(removeVacancySpy).not.toHaveBeenCalled();
      expect(disbandTeamSpy).not.toHaveBeenCalled();
      expect(createTeamSpy).not.toHaveBeenCalled();
    });

    it('ensures owner of Team A cannot mutate Team B in the same event', async () => {
      const updateListingSpy = vi.spyOn(teamsRepository, 'updateTeamListing');

      // Actor is owner of Team A, but targets Team B (owned by otherParticipant in same event)
      vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(sampleTeamOther);

      const response = await request(app)
        .patch(`/api/teams/${sampleTeamId2}`)
        .set('Authorization', validTokenHeader)
        .send({ pitch: 'Malicious update across teams' });

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('FORBIDDEN_NOT_TEAM_OWNER');
      expect(updateListingSpy).not.toHaveBeenCalled();
    });

    it('ensures permissions are scoped per team: owner in event 1 gets no rights in event 2 team', async () => {
      const addVacancySpy = vi.spyOn(teamsRepository, 'addTeamVacancy');

      // Actor is owner of Team A (event 1), targets sampleTeamEvent2 (event 2, owned by otherParticipant)
      vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(sampleTeamEvent2);

      const response = await request(app)
        .post(`/api/teams/${sampleTeamEvent2.id}/vacancies`)
        .set('Authorization', validTokenHeader)
        .send({ role: 'Backend', skills: ['Node.js'] });

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('FORBIDDEN_NOT_TEAM_OWNER');
      expect(addVacancySpy).not.toHaveBeenCalled();
    });

    it('returns 404 VACANCY_NOT_FOUND when updating vacancy belonging to another team under own teamId', async () => {
      // Team ownership passes because actor owns sampleTeamId
      vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(sampleTeam);

      // But SQL/service scoping rejects foreign vacancy under this team
      vi.spyOn(teamsRepository, 'updateTeamVacancy').mockRejectedValue({
        message: 'VACANCY_NOT_FOUND',
        code: 'P0001',
      });

      const foreignVacancyId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
      const response = await request(app)
        .patch(`/api/teams/${sampleTeamId}/vacancies/${foreignVacancyId}`)
        .set('Authorization', validTokenHeader)
        .send({ role: 'Frontend', skills: ['TypeScript'] });

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('VACANCY_NOT_FOUND');
    });
  });
});
