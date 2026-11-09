import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuditAdmin } from '../middleware/requireAuditAdmin.js';
import type { AuditQueryParams } from '../db/auditRecords.repository.js';
import { validateAuditQuery } from '../validators/auditRecords.validator.js';
import { AuditServiceError, queryAuditRecords } from '../services/auditRecords.js';

export const auditRecordsRouter = Router();

/**
 * US-028 / #258 / FR-080 — ADMIN-only, read-only audit access. Every route here
 * inherits the guard; a non-ADMIN never reaches validation or the database.
 */
auditRecordsRouter.use(...requireAuditAdmin);

/**
 * Append-only (AC 3): the audit trail has no write API. Any mutating method on any
 * path under this router is refused explicitly instead of falling through to a 404.
 */
auditRecordsRouter.use((req: Request, res: Response, next: NextFunction): void => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }
  res.setHeader('Allow', 'GET, HEAD, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  res.status(405).json({
    error: 'Administrative action records are append-only and read-only through this API.',
    code: 'AUDIT_RECORDS_READ_ONLY',
  });
});

/**
 * GET /api/admin/audit-records?actor&actionType&category&from&to&limit&cursor
 * Newest-first page of event / moderation / account action records. Filters are
 * AND-ed; no match is a normal 200 with an empty `records` array (AC 4).
 */
auditRecordsRouter.get(
  '/',
  validateAuditQuery,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const params = res.locals.auditQuery as AuditQueryParams;
      const result = await queryAuditRecords(req.participant!.id, params);
      res.status(200).json({
        status: 'ok',
        records: result.records,
        count: result.records.length,
        hasMore: result.hasMore,
        nextCursor: result.nextCursor,
        filters: {
          actor: params.actorId ?? null,
          actionType: params.actionType ?? null,
          category: params.category ?? null,
          from: params.from ?? null,
          to: params.to ?? null,
        },
      });
    } catch (err) {
      if (err instanceof AuditServiceError) {
        res.status(err.status).json({
          error: err.message,
          code: err.code,
          ...(err.fieldErrors ? { errors: err.fieldErrors, fieldErrors: err.fieldErrors } : {}),
        });
        return;
      }
      next(err);
    }
  }
);
