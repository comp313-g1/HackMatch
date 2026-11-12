import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireFirebaseAuth } from '../middleware/requireFirebaseAuth.js';
import { requireMfa } from '../middleware/requireMfa.js';
import { requireActiveAccount } from '../middleware/requireActiveAccount.js';
import { requireParticipantRole } from '../middleware/requireRole.js';
import { requireVerifiedParticipant } from '../middleware/requireVerifiedParticipant.js';
import {
  requireDirectThreadParticipant,
  requireDirectThreadSendAccess,
} from '../middleware/requireDirectThreadParticipant.js';
import { requireJsonObjectBody } from '../validators/team.validator.js';
import {
  validateBlockTargetParam,
  validateOpenThreadBody,
  validateSendMessageBody,
} from '../validators/directMessage.validator.js';
import { blockParticipant, unblockParticipant } from '../services/directMessageBlocks.js';
import { ChatServiceError } from '../services/chat.js';
import {
  DirectMessageServiceError,
  getDmThread,
  listDmInbox,
  listDmThreadMessages,
  openOrContinueDirectThread,
  sendDmMessage,
} from '../services/directMessages.js';
import { buildDirectMessageSuccessPayload } from '../services/directMessagePrivacy.js';
import { setDirectMessageReaction } from '../services/chatReactions.js';
import { limitReactionMutations, requireReactionsEnabled } from '../middleware/richChatReactions.js';
import { validateReactionParams, type ReactionTarget } from '../validators/chatReaction.validator.js';

export const directMessageRouter = Router();

/** US-032 / FR-091: verified active PART only. Visitors 401; unverified or suspended 403. */
const directMessageAuthGuard = [
  requireFirebaseAuth,
  requireMfa,
  requireActiveAccount,
  requireParticipantRole,
  requireVerifiedParticipant,
];

function threadIdOf(req: Request): string {
  const raw = req.params.threadId;
  return (Array.isArray(raw) ? raw[0] : raw).trim();
}

function handleDmError(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof DirectMessageServiceError || err instanceof ChatServiceError) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }
  next(err);
}

/**
 * GET /api/direct-messages/threads (and /api/direct-messages, /api/direct-messages/inbox)
 * US-032 / #387: Lists the caller's DM inbox threads ordered by most recent activity (UTC).
 */
async function handleListInbox(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const result = await listDmInbox(req.participant!.id);
    res.status(200).json(
      buildDirectMessageSuccessPayload({
        status: 'ok',
        threads: result.threads,
        isEmpty: result.isEmpty,
      })
    );
  } catch (err) {
    handleDmError(err, res, next);
  }
}

directMessageRouter.get('/', ...directMessageAuthGuard, handleListInbox);
directMessageRouter.get('/threads', ...directMessageAuthGuard, handleListInbox);
directMessageRouter.get('/inbox', ...directMessageAuthGuard, handleListInbox);

/**
 * POST /api/direct-messages/threads   body: { participantId }
 * Opens the one-to-one thread with that participant, or returns the existing one (idempotent):
 * 201 when created, 200 when it already existed. The caller is always the authenticated user.
 */
directMessageRouter.post(
  '/threads',
  ...directMessageAuthGuard,
  requireJsonObjectBody,
  validateOpenThreadBody,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const { thread, created } = await openOrContinueDirectThread({
        caller: req.participant!,
        peerId: req.body.participantId,
      });
      res.status(created ? 201 : 200).json(buildDirectMessageSuccessPayload({ status: 'ok', thread }));
    } catch (err) {
      handleDmError(err, res, next);
    }
  }
);

/**
 * GET /api/direct-messages/threads/:threadId
 * US-032 / #387: Opens a DM thread and returns its metadata, safe peer handle, and chronological messages.
 */
directMessageRouter.get(
  '/threads/:threadId',
  ...directMessageAuthGuard,
  requireDirectThreadParticipant,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const result = await getDmThread({
        threadId: threadIdOf(req),
        participantId: req.participant!.id,
      });
      res.status(200).json(
        buildDirectMessageSuccessPayload({
          status: 'ok',
          thread: result.thread,
          messages: result.messages,
          isEmpty: result.isEmpty,
        })
      );
    } catch (err) {
      handleDmError(err, res, next);
    }
  }
);

/**
 * GET /api/direct-messages/threads/:threadId/messages
 * US-032 / #387: Chronological messages in a DM thread (oldest-first in UTC; empty array when none).
 */
directMessageRouter.get(
  '/threads/:threadId/messages',
  ...directMessageAuthGuard,
  requireDirectThreadParticipant,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const result = await listDmThreadMessages({
        threadId: threadIdOf(req),
        participantId: req.participant!.id,
      });
      res.status(200).json(
        buildDirectMessageSuccessPayload({
          status: 'ok',
          thread: result.thread,
          messages: result.messages,
          isEmpty: result.isEmpty,
        })
      );
    } catch (err) {
      handleDmError(err, res, next);
    }
  }
);

/**
 * POST /api/direct-messages/threads/:threadId/messages
 * US-032 / #387: Sends a validated text message in a DM thread. Echoes submitted draft on 400.
 */
directMessageRouter.post(
  '/threads/:threadId/messages',
  ...directMessageAuthGuard,
  requireDirectThreadSendAccess,
  requireJsonObjectBody,
  validateSendMessageBody,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const message = await sendDmMessage({
        threadId: threadIdOf(req),
        authorId: req.participant!.id,
        body: req.body.body,
      });
      res.status(201).json(buildDirectMessageSuccessPayload({ status: 'ok', message }));
    } catch (err) {
      handleDmError(err, res, next);
    }
  }
);

/**
 * PUT /api/direct-messages/blocks/:participantId
 * #433: the caller blocks that participant. Neither of you can send messages to the other until
 * the block is removed. Idempotent: blocking someone already blocked returns the same answer.
 */
directMessageRouter.put(
  '/blocks/:participantId',
  ...directMessageAuthGuard,
  validateBlockTargetParam,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const result = await blockParticipant({
        caller: req.participant!,
        targetId: String(req.params.participantId),
      });
      res.status(200).json(buildDirectMessageSuccessPayload({ status: 'ok', ...result }));
    } catch (err) {
      handleDmError(err, res, next);
    }
  }
);

/**
 * DELETE /api/direct-messages/blocks/:participantId
 * #433: removes the caller's block on that participant. Idempotent, and gives the same answer
 * whether or not a block (or such a participant) exists, so nothing can be probed.
 */
directMessageRouter.delete(
  '/blocks/:participantId',
  ...directMessageAuthGuard,
  validateBlockTargetParam,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const result = await unblockParticipant({
        caller: req.participant!,
        targetId: String(req.params.participantId),
      });
      res.status(200).json(buildDirectMessageSuccessPayload({ status: 'ok', ...result }));
    } catch (err) {
      handleDmError(err, res, next);
    }
  }
);

/**
 * PUT    /api/direct-messages/threads/:threadId/messages/:messageId/reactions/:reaction  (add)
 * DELETE /api/direct-messages/threads/:threadId/messages/:messageId/reactions/:reaction  (remove)
 * US-035 / #405: reacting needs SEND access (thread participant, eligible peer, no block
 * either way), with the same denial codes as sending a message.
 */
function dmReactionHandler(present: boolean) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const target = res.locals.reactionTarget as ReactionTarget;
      const result = await setDirectMessageReaction({
        participant: req.participant!,
        threadId: threadIdOf(req),
        messageId: target.messageId,
        reaction: target.reaction,
        present,
      });
      res.status(200).json(buildDirectMessageSuccessPayload({ status: 'ok', ...result }));
    } catch (err) {
      handleDmError(err, res, next);
    }
  };
}

const dmReactionChain = [
  ...directMessageAuthGuard,
  requireReactionsEnabled,
  validateReactionParams,
  limitReactionMutations,
  requireDirectThreadSendAccess,
];

directMessageRouter.put(
  '/threads/:threadId/messages/:messageId/reactions/:reaction',
  ...dmReactionChain,
  dmReactionHandler(true)
);

directMessageRouter.delete(
  '/threads/:threadId/messages/:messageId/reactions/:reaction',
  ...dmReactionChain,
  dmReactionHandler(false)
);
