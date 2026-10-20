import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { requireTeamOwner } from './requireTeamOwner.js';
import { teamsRepository } from '../db/teams.repository.js';
import type { Participant, Team } from '../db/types.js';

describe('requireTeamOwner middleware unit tests (US-012 / #122)', () => {
  const sampleTeamId = '11111111-1111-4111-8111-111111111111';
  const ownerId = '22222222-2222-4222-8222-222222222222';
  const nonOwnerId = '33333333-3333-4333-8333-333333333333';

  const sampleOwnerParticipant: Participant = {
    id: ownerId,
    firebase_uid: 'fb-owner',
    email: 'owner@example.com',
    full_name: 'Owner Participant',
    role: 'PART',
    is_verified: true,
    is_suspended: false,
    created_at: '2026-10-18T00:00:00.000Z',
    updated_at: '2026-10-18T00:00:00.000Z',
  };

  const sampleTeam: Team = {
    id: sampleTeamId,
    event_id: '44444444-4444-4444-8444-444444444444',
    owner_participant_id: ownerId,
    name: 'HackMatch Team',
    pitch: 'Team pitch',
    goal: 'Project Completion',
    commitment_hours: 20,
    communication_link: null,
    recruitment_status: 'Open',
    locked_at: null,
    disbanded_at: null,
    created_at: '2026-10-18T00:00:00.000Z',
    updated_at: '2026-10-18T00:00:00.000Z',
  };

  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let statusSpy: ReturnType<typeof vi.fn>;
  let jsonSpy: ReturnType<typeof vi.fn>;
  let setHeaderSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    statusSpy = vi.fn().mockReturnThis();
    jsonSpy = vi.fn().mockReturnThis();
    setHeaderSpy = vi.fn().mockReturnThis();

    mockReq = {
      params: { teamId: sampleTeamId },
      participant: sampleOwnerParticipant,
    };

    mockRes = {
      setHeader: setHeaderSpy,
      status: statusSpy as unknown as Response['status'],
      json: jsonSpy as unknown as Response['json'],
    };

    mockNext = vi.fn() as unknown as NextFunction;
  });

  it('rejects with 401 UNAUTHORIZED when req.participant is not set', async () => {
    mockReq.participant = undefined;

    await requireTeamOwner(mockReq as Request, mockRes as Response, mockNext);

    expect(setHeaderSpy).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(statusSpy).toHaveBeenCalledWith(401);
    expect(jsonSpy).toHaveBeenCalledWith({
      error: 'Authentication required. Missing or malformed Authorization header.',
      code: 'UNAUTHORIZED',
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('rejects with 404 TEAM_NOT_FOUND when team does not exist', async () => {
    vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(null);

    await requireTeamOwner(mockReq as Request, mockRes as Response, mockNext);

    expect(setHeaderSpy).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(statusSpy).toHaveBeenCalledWith(404);
    expect(jsonSpy).toHaveBeenCalledWith({
      error: 'Team not found.',
      code: 'TEAM_NOT_FOUND',
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('rejects with 403 FORBIDDEN_NOT_TEAM_OWNER when participant is not the team owner', async () => {
    vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue({
      ...sampleTeam,
      owner_participant_id: nonOwnerId,
    });

    await requireTeamOwner(mockReq as Request, mockRes as Response, mockNext);

    expect(setHeaderSpy).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(statusSpy).toHaveBeenCalledWith(403);
    expect(jsonSpy).toHaveBeenCalledWith({
      error: 'You are not the owner of this team.',
      code: 'FORBIDDEN_NOT_TEAM_OWNER',
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('calls next() without arguments when participant is the verified team owner', async () => {
    vi.spyOn(teamsRepository, 'findTeamById').mockResolvedValue(sampleTeam);

    await requireTeamOwner(mockReq as Request, mockRes as Response, mockNext);

    expect(setHeaderSpy).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(statusSpy).not.toHaveBeenCalled();
    expect(jsonSpy).not.toHaveBeenCalled();
    expect(mockNext).toHaveBeenCalledWith();
  });

  it('passes error to next(err) when repository throws', async () => {
    const dbError = new Error('Database connection failed');
    vi.spyOn(teamsRepository, 'findTeamById').mockRejectedValue(dbError);

    await requireTeamOwner(mockReq as Request, mockRes as Response, mockNext);

    expect(setHeaderSpy).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(mockNext).toHaveBeenCalledWith(dbError);
  });
});

