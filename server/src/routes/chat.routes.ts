import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireFirebaseAuth } from '../middleware/requireFirebaseAuth.js';
import { requireMfa } from '../middleware/requireMfa.js';
import { requireActiveAccount } from '../middleware/requireActiveAccount.js';
import { requireParticipantRole } from '../middleware/requireRole.js';
import { requireVerifiedParticipant } from '../middleware/requireVerifiedParticipant.js';
import { requireJsonObjectBody } from '../validators/team.validator.js';
import {
  validateChatChannelIdParam,
  validateCreateChannelBody,
  validateSendMessageBody,
} from '../validators/chat.validator.js';
import {
  ChatServiceError,
  createChannel,
  listChannelMessages,
  listChannels,
  sendChannelMessage,
} from '../services/chat.js';
import { buildChatSuccessPayload } from '../services/chatPrivacy.js';

export const chatRouter = Router();

/**
 * US-030 / #344–#345 / FR-087–FR-089 — verified active PART only.
 * Visitors → 401; unverified → 403; suspended → 403.
 * Responses scrub credentials, OTPs, and emails (FR-089).
 */
const chatAuthGuard = [
  requireFirebaseAuth,
  requireMfa,
  requireActiveAccount,
  requireParticipantRole,
  requireVerifiedParticipant,
];

function handleChatError(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof ChatServiceError) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(err.status).json({
      error: err.message,
      code: err.code,
    });
    return;
  }
  next(err);
}

/**
 * GET /api/chat/channels
 * Lists forums/channels newest-first (empty array when none).
 */
chatRouter.get(
  '/channels',
  ...chatAuthGuard,
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const channels = await listChannels();
      res.status(200).json(buildChatSuccessPayload({ status: 'ok', channels }));
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/chat/channels
 * Creates a forum/channel with required title + description.
 */
chatRouter.post(
  '/channels',
  ...chatAuthGuard,
  requireJsonObjectBody,
  validateCreateChannelBody,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const channel = await createChannel({
        title: req.body.title,
        description: req.body.description,
        createdBy: req.participant!.id,
      });
      res.status(201).json(buildChatSuccessPayload({ status: 'ok', channel }));
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/chat/channels/:channelId/messages
 * Lists text messages for a channel (author handle, UTC time, content).
 */
chatRouter.get(
  '/channels/:channelId/messages',
  ...chatAuthGuard,
  validateChatChannelIdParam,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const channelId = typeof req.params.channelId === 'string' ? req.params.channelId : req.params.channelId[0];
      const messages = await listChannelMessages(channelId);
      res.status(200).json(buildChatSuccessPayload({ status: 'ok', messages }));
    } catch (err) {
      handleChatError(err, res, next);
    }
  }
);

/**
 * POST /api/chat/channels/:channelId/messages
 * Sends a text message; validation failures echo submitted draft (NR-017).
 */
chatRouter.post(
  '/channels/:channelId/messages',
  ...chatAuthGuard,
  validateChatChannelIdParam,
  requireJsonObjectBody,
  validateSendMessageBody,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const channelId = typeof req.params.channelId === 'string' ? req.params.channelId : req.params.channelId[0];
      const message = await sendChannelMessage({
        channelId,
        authorId: req.participant!.id,
        body: req.body.body,
      });
      res.status(201).json(buildChatSuccessPayload({ status: 'ok', message }));
    } catch (err) {
      handleChatError(err, res, next);
    }
  }
);
