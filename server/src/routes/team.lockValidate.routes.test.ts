import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { participantsRepository } from '../db/participants.repository.js';
import { teamsRepository } from '../db/teams.repository.js';
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

const lockValidatePath = `/api/teams/${sampleTeamId}/lock/validate`;

describe('GET /api/teams/:teamId/lock/validate (US-022 / #207 / FR-066)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockVerifyIdToken.mockResolvedValue(validOwnerDecodedToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(ownerParticipant);
    vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(sampleTeam);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).get(lockValidatePath);
    expect(res.status).toBe(401);
  });

  it('returns 403 when the caller is not the team owner', async () => {
    mockVerifyIdToken.mockResolvedValue(validOtherDecodedToken);
    vi.spyOn(participantsRepository, 'findByFirebaseUid').mockResolvedValue(otherParticipant);

    const res = await request(app).get(lockValidatePath).set('Authorization', otherTokenHeader);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_NOT_TEAM_OWNER');
  });

  it('returns 200 canLock=false with BELOW_MIN_MEMBERS when only the owner is confirmed', async () => {
    vi.spyOn(teamsRepository, 'getTeamViewParts').mockResolvedValue({
      ...sampleParts,
      event: {
        min_team_size: 2,
        max_team_size: 4,
        status: 'Published',
        end_date: '2099-01-01T00:00:00.000Z',
      },
    });
    vi.spyOn(teamsRepository, 'findConfirmedTeamIdForParticipant').mockResolvedValue(sampleTeamId);

    const res = await request(app).get(lockValidatePath).set('Authorization', validTokenHeader);

    expect(res.status).toBe(200);
    expect(res.body.validation.canLock).toBe(false);
    expect(res.body.validation.memberCount).toBe(1);
    expect(res.body.validation.minRequired).toBe(2);
    expect(res.body.validation.maxAllowed).toBe(4);
    expect(res.body.validation.reasons.map((r: { code: string }) => r.code)).toContain(
      'BELOW_MIN_MEMBERS'
    );
  });

  it('returns 200 canLock=true for an eligible open roster (happy path)', async () => {
    const memberId = otherParticipant.id;
    vi.spyOn(teamsRepository, 'getTeamViewParts').mockResolvedValue({
      ...sampleParts,
      event: {
        min_team_size: 2,
        max_team_size: 4,
        status: 'Published',
        end_date: '2099-01-01T00:00:00.000Z',
      },
      members: [
        ...sampleParts.members,
        {
          participant_id: memberId,
          role: 'Member' as const,
          joined_at: '2026-10-19T10:00:00.000Z',
          handle: 'mate',
          full_name: 'Confirmed Mate',
        },
      ],
    });
    vi.spyOn(teamsRepository, 'findConfirmedTeamIdForParticipant').mockResolvedValue(sampleTeamId);

    const res = await request(app).get(lockValidatePath).set('Authorization', validTokenHeader);

    expect(res.status).toBe(200);
    expect(res.body.validation.canLock).toBe(true);
    expect(res.body.validation.reasons).toEqual([]);
    expect(res.body.validation.memberCount).toBe(2);
    expect(res.body.validation.members).toHaveLength(2);
    expect(res.headers['cache-control']).toMatch(/no-store/i);
  });

  it('returns 200 canLock=false with ALREADY_LOCKED when recruitment is Locked', async () => {
    vi.spyOn(teamsRepository, 'getTeamViewParts').mockResolvedValue({
      ...sampleParts,
      team: {
        ...sampleTeam,
        recruitment_status: 'Locked',
        locked_at: '2026-10-19T15:00:00.000Z',
      },
      event: {
        min_team_size: 2,
        max_team_size: 4,
        status: 'Published',
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
    });
    vi.spyOn(teamsRepository, 'findConfirmedTeamIdForParticipant').mockResolvedValue(sampleTeamId);

    const res = await request(app).get(lockValidatePath).set('Authorization', validTokenHeader);

    expect(res.status).toBe(200);
    expect(res.body.validation.canLock).toBe(false);
    expect(res.body.validation.lockedAt).toBe('2026-10-19T15:00:00.000Z');
    expect(res.body.validation.reasons.map((r: { code: string }) => r.code)).toContain(
      'ALREADY_LOCKED'
    );
  });

  it('does not mutate team state (read-only validate)', async () => {
    vi.spyOn(teamsRepository, 'getTeamViewParts').mockResolvedValue({
      ...sampleParts,
      event: {
        min_team_size: 2,
        max_team_size: 4,
        status: 'Published',
        end_date: '2099-01-01T00:00:00.000Z',
      },
    });
    vi.spyOn(teamsRepository, 'findConfirmedTeamIdForParticipant').mockResolvedValue(sampleTeamId);
    // There is no lock/update RPC on this path — ensure no accidental write spies are needed.
    const updateSpy = vi.spyOn(teamsRepository, 'updateTeamListing');

    await request(app).get(lockValidatePath).set('Authorization', validTokenHeader);

    expect(updateSpy).not.toHaveBeenCalled();
  });
});
