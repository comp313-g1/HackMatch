import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import { requireConfirmedTeamMember } from './requireConfirmedTeamMember.js';
import { teamsRepository } from '../db/teams.repository.js';

const TEAM = '22222222-2222-4222-8222-222222222222';

function makeRes() {
  const res = {
    setHeader: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as unknown as Response & typeof res;
}

function makeReq(participantId: string | undefined, teamId: unknown = TEAM): Request {
  return {
    participant: participantId ? { id: participantId } : undefined,
    params: { teamId },
  } as unknown as Request;
}

describe('requireConfirmedTeamMember (US-031 / #381 / FR-090)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('passes a confirmed member and always sets no-store', async () => {
    vi.spyOn(teamsRepository, 'findConfirmedTeamIdsForParticipant').mockResolvedValue([TEAM]);
    const res = makeRes();
    const next = vi.fn();
    await requireConfirmedTeamMember(makeReq('p1'), res, next);
    expect(next).toHaveBeenCalledWith();
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.status).not.toHaveBeenCalled();
  });

  it('denies with 403 and no-store when there is no authenticated participant, without a lookup', async () => {
    const lookup = vi.spyOn(teamsRepository, 'findConfirmedTeamIdsForParticipant').mockResolvedValue([TEAM]);
    const res = makeRes();
    const next = vi.fn();
    await requireConfirmedTeamMember(makeReq(undefined), res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(lookup).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('denies with 403 when the team id is missing or not a string', async () => {
    const lookup = vi.spyOn(teamsRepository, 'findConfirmedTeamIdsForParticipant').mockResolvedValue([TEAM]);
    for (const bad of [null, ['x'], '', '   ']) {
      const res = makeRes();
      const next = vi.fn();
      await requireConfirmedTeamMember(makeReq('p1', bad), res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    }
    expect(lookup).not.toHaveBeenCalled();
  });

  it('denies a non-member with the content-free 403 body', async () => {
    vi.spyOn(teamsRepository, 'findConfirmedTeamIdsForParticipant').mockResolvedValue([]);
    const res = makeRes();
    const next = vi.fn();
    await requireConfirmedTeamMember(makeReq('p1'), res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Only confirmed team members can use this team channel.',
      code: 'FORBIDDEN_NOT_TEAM_MEMBER',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('forwards repository failures to the error handler instead of allowing access', async () => {
    const boom = new Error('db down');
    vi.spyOn(teamsRepository, 'findConfirmedTeamIdsForParticipant').mockRejectedValue(boom);
    const res = makeRes();
    const next = vi.fn();
    await requireConfirmedTeamMember(makeReq('p1'), res, next);
    expect(next).toHaveBeenCalledWith(boom);
    expect(res.status).not.toHaveBeenCalled();
  });
});
