import type { Request, Response, NextFunction } from 'express';
import { teamsRepository } from '../db/teams.repository.js';

/**
 * Express middleware enforcing contextual team ownership (US-012 / Task 5 / #122).
 *
 * Verifies that the authenticated participant (from `req.participant`) matches
 * the `owner_participant_id` of the team specified by the `:teamId` route parameter.
 *
 * Must run after:
 * 1. `participantAuth` (which populates `req.participant` and validates session)
 * 2. `validateTeamIdParams` (which ensures `:teamId` is a syntactically valid UUID)
 *
 * SQL and service-layer owner checks remain as the race-safe backstop.
 */
export async function requireTeamOwner(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');

  const participantId = req.participant?.id;
  if (!participantId) {
    res.status(401).json({
      error: 'Authentication required. Missing or malformed Authorization header.',
      code: 'UNAUTHORIZED',
    });
    return;
  }

  const rawTeamId = req.params.teamId;
  const teamId = typeof rawTeamId === 'string' ? rawTeamId : Array.isArray(rawTeamId) ? rawTeamId[0] : '';
  if (!teamId) {
    res.status(404).json({
      error: 'Team not found.',
      code: 'TEAM_NOT_FOUND',
    });
    return;
  }

  try {
    const team = await teamsRepository.findTeamById(teamId);
    if (!team) {
      res.status(404).json({
        error: 'Team not found.',
        code: 'TEAM_NOT_FOUND',
      });
      return;
    }

    if (team.owner_participant_id !== participantId) {
      res.status(403).json({
        error: 'You are not the owner of this team.',
        code: 'FORBIDDEN_NOT_TEAM_OWNER',
      });
      return;
    }

    next();
  } catch (err: unknown) {
    next(err);
  }
}
