/**
 * US-023: Private coordination workspace controllers.
 */

import type { Request, Response, NextFunction } from 'express';
import {
  getPrivateTeamWorkspace,
  updateWorkspaceExternalLinks,
} from '../services/teamWorkspace.js';
import { toTeamServiceError } from '../services/teamErrors.js';
import type { UpsertWorkspaceLinkInput } from '../db/types.js';

export async function getTeamWorkspaceHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const actorId = req.participant?.id;
    const rawTeamId = req.params.teamId;
    const teamId = Array.isArray(rawTeamId) ? rawTeamId[0] : rawTeamId;

    if (!actorId) {
      res.status(401).json({
        error: 'Authentication required.',
        code: 'UNAUTHORIZED',
      });
      return;
    }

    if (!teamId) {
      res.status(400).json({
        error: 'Team ID is required.',
        code: 'VALIDATION_ERROR',
      });
      return;
    }

    const workspace = await getPrivateTeamWorkspace(actorId, teamId);
    res.status(200).json(workspace);
  } catch (err) {
    const serviceErr = toTeamServiceError(err);
    if (serviceErr) {
      res.status(serviceErr.status).json({
        error: serviceErr.message,
        code: serviceErr.code,
        ...(serviceErr.details ? { details: serviceErr.details } : {}),
      });
      return;
    }
    next(err);
  }
}

export async function updateTeamWorkspaceLinksHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const actorId = req.participant?.id;
    const rawTeamId = req.params.teamId;
    const teamId = Array.isArray(rawTeamId) ? rawTeamId[0] : rawTeamId;

    if (!actorId) {
      res.status(401).json({
        error: 'Authentication required.',
        code: 'UNAUTHORIZED',
      });
      return;
    }

    if (!teamId) {
      res.status(400).json({
        error: 'Team ID is required.',
        code: 'VALIDATION_ERROR',
      });
      return;
    }

    const validatedLinks = (
      req as Request & { validatedWorkspaceLinks?: UpsertWorkspaceLinkInput[] }
    ).validatedWorkspaceLinks;
    const links =
      validatedLinks ??
      (req.body as { links: UpsertWorkspaceLinkInput[] }).links;

    const result = await updateWorkspaceExternalLinks({
      actorId,
      teamId,
      links,
    });

    res.status(200).json(result);
  } catch (err) {
    const serviceErr = toTeamServiceError(err);
    if (serviceErr) {
      res.status(serviceErr.status).json({
        error: serviceErr.message,
        code: serviceErr.code,
        ...(serviceErr.details ? { details: serviceErr.details } : {}),
      });
      return;
    }
    next(err);
  }
}
