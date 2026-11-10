import type { Request, Response, NextFunction } from 'express';
import { teamsRepository } from '../db/teams.repository.js';

/**
 * US-031 / #381 / FR-090 — only ACTIVE CONFIRMED members of `:teamId` may use its private channel.
 *
 * Must run after the participant auth chain (needs `req.participant`) and `validateTeamIdParams`.
 *
 * Non-members, former members (Removed/Released), and a team that does not exist all get the
 * SAME 403 body, so the response never reveals whether a team or its channel exists and never
 * carries message content. Visitors never reach this point (401 from the auth chain) and an
 * ADMIN is rejected by `requireParticipantRole`; an admin has no membership, so no bypass exists.
 */
export async function requireConfirmedTeamMember(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const teamId = typeof req.params.teamId === 'string' ? req.params.teamId.trim() : '';
    const participantId = req.participant?.id;

    if (!participantId || !teamId) {
      res.status(403).json({
        error: 'Only confirmed team members can use this team channel.',
        code: 'FORBIDDEN_NOT_TEAM_MEMBER',
      });
      return;
    }

    const teamIds = await teamsRepository.findConfirmedTeamIdsForParticipant(participantId);
    if (!teamIds.includes(teamId)) {
      res.status(403).json({
        error: 'Only confirmed team members can use this team channel.',
        code: 'FORBIDDEN_NOT_TEAM_MEMBER',
      });
      return;
    }

    next();
  } catch (err) {
    next(err);
  }
}
