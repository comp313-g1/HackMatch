import type { Request, Response, NextFunction } from 'express';
import {
  exportLockedTeamManifest,
  verifyLockedTeamManifestChecksum,
} from '../services/teamManifest.js';
import {
  buildManifestExportArtifact,
  type ManifestExportFormat,
} from '../services/teamManifestExport.js';
import { toTeamServiceError } from '../services/teamErrors.js';

function handleManifestControllerError(err: unknown, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store');
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

/**
 * Handles GET /api/teams/:teamId/manifest
 * Returns JSON manifest, printable HTML verification card, or PDF download (US-024 / FR-071).
 */
export async function getTeamManifestHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actorId = req.participant!.id;
    const teamId = String(req.params.teamId);
    const format = (res.locals.manifestFormat as ManifestExportFormat) || 'json';

    const payload = await exportLockedTeamManifest(actorId, teamId);

    if (format === 'html') {
      const artifact = buildManifestExportArtifact(payload, 'html');
      res.setHeader('Content-Type', artifact.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${artifact.filename}"`);
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).send(artifact.content);
      return;
    }

    if (format === 'pdf') {
      const artifact = buildManifestExportArtifact(payload, 'pdf');
      res.setHeader('Content-Type', artifact.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${artifact.filename}"`);
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).send(Buffer.from(artifact.content as Uint8Array));
      return;
    }

    // Default: application/json
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(payload);
  } catch (err: unknown) {
    handleManifestControllerError(err, res, next);
  }
}

/**
 * Handles POST /api/teams/:teamId/manifest/verify
 * Compares candidate checksum against the stored server snapshot (US-024 / FR-072).
 */
export async function verifyTeamManifestChecksumHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actorId = req.participant!.id;
    const teamId = String(req.params.teamId);
    const checksum = req.body?.checksum as string;

    const result = await verifyLockedTeamManifestChecksum(actorId, teamId, checksum);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(result);
  } catch (err: unknown) {
    handleManifestControllerError(err, res, next);
  }
}
