import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import { teamsRepository } from '../db/teams.repository.js';
import { TeamServiceError } from '../services/teamErrors.js';
import {
  ownerParticipant,
  otherParticipant,
  sampleTeamId,
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

const lockPath = `/api/teams/${sampleTeamId}/lock`;

const lockedTeamViewParts = {
  ...sampleParts,
  team: {
    ...sampleTeam,
    recruitment_status: 'Locked' as const,
    locked_at: '2026-10-20T15:30:00.000Z',
  },
  event: {
    min_team_size: 2,
    max_team_size: 4,
    status: 'Published' as const,
    end_date: '2099-01-01T00:00:00.000Z',
  },
  members: [
    ...sampleParts.members,
    {
      participant_id: otherParticipant.id,
      role: 'Member' as const,
      joined_at: '2026-10-19T10:00:00.000Z',
      handle: 'mate',
      full_name: 'Confirmed Mate',
    },
  ],
};

describe('POST /api/teams/:teamId/lock (US-022 / #208 / FR-066)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockVerifyIdToken.mockResolvedValue(validOwnerDecodedToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(ownerParticipant);
    vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(sampleTeam);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).post(lockPath);
    expect(res.status).toBe(401);
  });

  it('returns 403 when the caller is not the team owner', async () => {
    mockVerifyIdToken.mockResolvedValue(validOtherDecodedToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(otherParticipant);

    const res = await request(app).post(lockPath).set('Authorization', otherTokenHeader);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_NOT_TEAM_OWNER');
  });

  it('locks an eligible roster and returns lockedAt + TeamView (happy path)', async () => {
    vi.spyOn(teamsRepository, 'lockTeam').mockResolvedValue({
      teamId: sampleTeamId,
      lockedAt: '2026-10-20T15:30:00.000Z',
      memberCount: 2,
      minRequired: 2,
      maxAllowed: 4,
      canceledRequests: 3,
    });
    vi.spyOn(teamsRepository, 'getTeamViewParts').mockResolvedValue(lockedTeamViewParts);

    const res = await request(app).post(lockPath).set('Authorization', validTokenHeader);

    expect(res.status).toBe(200);
    expect(res.body.lockedAt).toBe('2026-10-20T15:30:00.000Z');
    expect(res.body.memberCount).toBe(2);
    expect(res.body.canceledRequests).toBe(3);
    expect(res.body.team.recruitmentStatus).toBe('Locked');
    expect(res.body.team.lockedAt).toBe('2026-10-20T15:30:00.000Z');
    expect(res.body.team.lifecycle).toEqual({ mutable: false, reason: 'Locked' });
    expect(res.body.message).toMatch(/roster locked/i);
    expect(teamsRepository.lockTeam).toHaveBeenCalledWith(ownerParticipant.id, sampleTeamId);
    expect(res.headers['cache-control']).toMatch(/no-store/i);
  });

  it('returns 409 BELOW_MIN_MEMBERS when the roster is underfilled (boundary / #212)', async () => {
    vi.spyOn(teamsRepository, 'lockTeam').mockRejectedValue(
      new TeamServiceError('BELOW_MIN_MEMBERS', {
        memberCount: 1,
        minRequired: 2,
        maxAllowed: 4,
      })
    );

    const res = await request(app).post(lockPath).set('Authorization', validTokenHeader);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('BELOW_MIN_MEMBERS');
    expect(res.body.error).toMatch(/not enough confirmed members/i);
    expect(res.body.details).toEqual({
      memberCount: 1,
      minRequired: 2,
      maxAllowed: 4,
    });
  });

  it('returns 409 ABOVE_MAX_MEMBERS when the roster exceeds the event maximum (#212)', async () => {
    vi.spyOn(teamsRepository, 'lockTeam').mockRejectedValue(
      new TeamServiceError('ABOVE_MAX_MEMBERS', {
        memberCount: 5,
        minRequired: 2,
        maxAllowed: 4,
      })
    );

    const res = await request(app).post(lockPath).set('Authorization', validTokenHeader);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ABOVE_MAX_MEMBERS');
    expect(res.body.error).toMatch(/too many confirmed members/i);
    expect(res.body.details).toEqual({
      memberCount: 5,
      minRequired: 2,
      maxAllowed: 4,
    });
  });

  it('returns 409 MEMBER_CONFIRMED_ELSEWHERE for FR-083 conflicts (#212)', async () => {
    vi.spyOn(teamsRepository, 'lockTeam').mockRejectedValue(
      new TeamServiceError('MEMBER_CONFIRMED_ELSEWHERE', { conflictCount: 1 })
    );

    const res = await request(app).post(lockPath).set('Authorization', validTokenHeader);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('MEMBER_CONFIRMED_ELSEWHERE');
  });

  it('returns 409 ALREADY_LOCKED when the team is already locked', async () => {
    vi.spyOn(teamsRepository, 'lockTeam').mockRejectedValue(
      new TeamServiceError('ALREADY_LOCKED', { lockedAt: '2026-10-19T12:00:00.000Z' })
    );

    const res = await request(app).post(lockPath).set('Authorization', validTokenHeader);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_LOCKED');
  });

  it('returns 409 TEAM_NOT_MUTABLE when the event is not recruiting', async () => {
    vi.spyOn(teamsRepository, 'lockTeam').mockRejectedValue(
      new TeamServiceError('TEAM_NOT_MUTABLE', { reason: 'EventNotRecruiting' })
    );

    const res = await request(app).post(lockPath).set('Authorization', validTokenHeader);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('TEAM_NOT_MUTABLE');
    expect(res.body.details).toEqual({ reason: 'EventNotRecruiting' });
  });

  it('returns 400 VALIDATION_ERROR for an invalid team id', async () => {
    const res = await request(app)
      .post('/api/teams/not-a-uuid/lock')
      .set('Authorization', validTokenHeader);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});
