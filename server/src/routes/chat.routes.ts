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
  validateMarkConversationReadBody,
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
import { getParticipantChatUnreadSummary } from '../services/chatUnread.js';
import { markChatConversationRead } from '../services/chatRead.js';
import { getRichChatCapabilities } from '../services/chatCapabilities.js';
import { setPublicChannelMessageReaction } from '../services/chatReactions.js';
import { limitReactionMutations, requireReactionsEnabled } from '../middleware/richChatReactions.js';
import { validateReactionParams, type ReactionTarget } from '../validators/chatReaction.validator.js';
import { limitTypingSignals, requireTypingEnabled } from '../middleware/richChatTyping.js';
import { validateTypingSignalBody } from '../validators/chatTyping.validator.js';
import { openTypingStream } from '../services/typingStream.js';
import { authorizePublicChannelViewer, signalPublicChannelTyping } from '../services/chatTypingAccess.js';

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
 * GET /api/chat/capabilities
 * US-035 / #405: which rich-chat features the server currently offers. The
 * server stays authoritative; each rich-chat route checks its own flag.
 */
chatRouter.get(
  '/capabilities',
  ...chatAuthGuard,
  (_req: Request, res: Response): void => {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(
      buildChatSuccessPayload({ status: 'ok', capabilities: getRichChatCapabilities() })
    );
  }
);

/**
 * GET /api/chat/unread-counts
 * Counts only for public/team channels and DM threads the caller may currently read.
 */
chatRouter.get(
  '/unread-counts',
  ...chatAuthGuard,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const summary = await getParticipantChatUnreadSummary(req.participant!);
      res.status(200).json(
        buildChatSuccessPayload({
          status: 'ok',
          ...summary,
        })
      );
    } catch (err) {
      handleChatError(err, res, next);
    }
  }
);

/**
 * POST /api/chat/read
 * Atomically advances one authorized channel/team/DM cursor to a concrete
 * message position. Repeated or older positions are safe no-ops.
 */
chatRouter.post(
  '/read',
  ...chatAuthGuard,
  requireJsonObjectBody,
  validateMarkConversationReadBody,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const result = await markChatConversationRead(req.participant!, req.body);
      res.status(200).json(
        buildChatSuccessPayload({
          status: 'ok',
          ...result,
        })
      );
    } catch (err) {
      handleChatError(err, res, next);
    }
  }
);

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
      const messages = await listChannelMessages(channelId, req.participant!.id);
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

/**
 * PUT    /api/chat/channels/:channelId/messages/:messageId/reactions/:reaction  (add)
 * DELETE /api/chat/channels/:channelId/messages/:messageId/reactions/:reaction  (remove)
 * US-035 / #405: idempotent; both answer 200 with the caller's final state and the
 * message's aggregate. Same channel answers as the message routes (a private team
 * channel is "not found" here).
 */
function publicReactionHandler(present: boolean) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const target = res.locals.reactionTarget as ReactionTarget;
      const result = await setPublicChannelMessageReaction({
        participant: req.participant!,
        channelId: String(req.params.channelId),
        messageId: target.messageId,
        reaction: target.reaction,
        present,
      });
      res.status(200).json(buildChatSuccessPayload({ status: 'ok', ...result }));
    } catch (err) {
      handleChatError(err, res, next);
    }
  };
}

const publicReactionChain = [
  ...chatAuthGuard,
  requireReactionsEnabled,
  validateChatChannelIdParam,
  validateReactionParams,
  limitReactionMutations,
];

chatRouter.put(
  '/channels/:channelId/messages/:messageId/reactions/:reaction',
  ...publicReactionChain,
  publicReactionHandler(true)
);

chatRouter.delete(
  '/channels/:channelId/messages/:messageId/reactions/:reaction',
  ...publicReactionChain,
  publicReactionHandler(false)
);

/**
 * POST /api/chat/channels/:channelId/typing   body: { "typing": true | false }
 * US-035 / #407: the caller is typing (or stopped) in this public forum. Ephemeral;
 * nothing is stored. Always 200 { status: 'ok' } once accepted, including when the
 * caller is Invisible (nothing is published then).
 */
chatRouter.post(
  '/channels/:channelId/typing',
  ...chatAuthGuard,
  requireTypingEnabled,
  validateChatChannelIdParam,
  validateTypingSignalBody,
  limitTypingSignals,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      await signalPublicChannelTyping(req.participant!, String(req.params.channelId), req.body.typing);
      res.status(200).json({ status: 'ok' });
    } catch (err) {
      handleChatError(err, res, next);
    }
  }
);

/**
 * GET /api/chat/channels/:channelId/typing/stream
 * US-035 / #407: SSE stream of typing events for this one public forum.
 */
chatRouter.get(
  '/channels/:channelId/typing/stream',
  ...chatAuthGuard,
  requireTypingEnabled,
  validateChatChannelIdParam,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const access = await authorizePublicChannelViewer(req.participant!, String(req.params.channelId));
      openTypingStream(req, res, { participantId: req.participant!.id, ...access });
    } catch (err) {
      handleChatError(err, res, next);
    }
  }
);
