import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireFirebaseAuth } from '../middleware/requireFirebaseAuth.js';
import { requireMfa } from '../middleware/requireMfa.js';
import { requireActiveAccount } from '../middleware/requireActiveAccount.js';
import { requireParticipantRole } from '../middleware/requireRole.js';
import { requireVerifiedParticipant } from '../middleware/requireVerifiedParticipant.js';
import {
  requireEmptyBody,
  validateNotificationIdParam,
  validateNotificationListQuery,
  type NotificationListQuery,
} from '../validators/notifications.validator.js';
import {
  NotificationServiceError,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../services/notifications.js';

export const notificationsRouter = Router();

/**
 * US-021 / #199 / FR-063, FR-065 — verified active PART only, strictly scoped
 * to the authenticated participant (the id always comes from the session,
 * never from the request). Visitors → 401; unverified/suspended → 403.
 */
const notificationsAuthGuard = [
  requireFirebaseAuth,
  requireMfa,
  requireActiveAccount,
  requireParticipantRole,
  requireVerifiedParticipant,
];

function handleNotificationError(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof NotificationServiceError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }
  next(err);
}

/**
 * GET /api/notifications?limit&cursor&unread&category
 * Newest-first feed plus the unread badge count (empty array when none).
 */
notificationsRouter.get(
  '/',
  ...notificationsAuthGuard,
  validateNotificationListQuery,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const query = res.locals.notificationQuery as NotificationListQuery;
      const result = await listNotifications({
        participantId: req.participant!.id,
        ...query,
      });
      res.status(200).json({ status: 'ok', ...result });
    } catch (err) {
      handleNotificationError(err, res, next);
    }
  }
);

/**
 * POST /api/notifications/read-all
 * Marks every unread notification of the caller read. Idempotent.
 * Registered before '/:id/read' so the literal path is never parsed as an id.
 */
notificationsRouter.post(
  '/read-all',
  ...notificationsAuthGuard,
  requireEmptyBody,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const result = await markAllNotificationsRead(req.participant!.id);
      res.status(200).json({ status: 'ok', ...result });
    } catch (err) {
      handleNotificationError(err, res, next);
    }
  }
);

/**
 * PATCH /api/notifications/:id/read
 * Marks one of the caller's notifications read. Idempotent; another account's
 * id is indistinguishable from a missing one (404 NOTIFICATION_NOT_FOUND).
 */
notificationsRouter.patch(
  '/:id/read',
  ...notificationsAuthGuard,
  validateNotificationIdParam,
  requireEmptyBody,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const id = typeof req.params.id === 'string' ? req.params.id : req.params.id[0];
      const result = await markNotificationRead(req.participant!.id, id);
      res.status(200).json({ status: 'ok', ...result });
    } catch (err) {
      handleNotificationError(err, res, next);
    }
  }
);
