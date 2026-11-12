import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireFirebaseAuth } from '../middleware/requireFirebaseAuth.js';
import { requireMfa } from '../middleware/requireMfa.js';
import { requireActiveAccount } from '../middleware/requireActiveAccount.js';
import { requireParticipantRole } from '../middleware/requireRole.js';
import { requireVerifiedParticipant } from '../middleware/requireVerifiedParticipant.js';
import { requireConfirmedTeamMember } from '../middleware/requireConfirmedTeamMember.js';
import { requireJsonObjectBody, validateTeamIdParams } from '../validators/team.validator.js';
import { validateSendMessageBody } from '../validators/chat.validator.js';
import {
  ChatServiceError,
  listTeamChannelMessages,
  openTeamChannel,
  sendTeamChannelMessage,
} from '../services/chat.js';
import { buildChatSuccessPayload } from '../services/chatPrivacy.js';
import { setTeamChannelMessageReaction } from '../services/chatReactions.js';
import { limitReactionMutations, requireReactionsEnabled } from '../middleware/richChatReactions.js';
import { validateReactionParams, type ReactionTarget } from '../validators/chatReaction.validator.js';
import { limitTypingSignals, requireTypingEnabled } from '../middleware/richChatTyping.js';
import { validateTypingSignalBody } from '../validators/chatTyping.validator.js';
import { openTypingStream } from '../services/typingStream.js';
import {
  assertTeamChannelWritable,
  authorizeTeamViewer,
  findTeamChannelOrThrow,
  signalTeamTyping,
} from '../services/chatTypingAccess.js';
import {
  attachmentAccessHandler,
  attachmentUploadHandler,
  precheckAttachmentRequest,
  readAttachmentBody,
  rejectAttachmentIdsWhenUnavailable,
  requireAttachmentsUsable,
  resolveAttachmentConversation,
  scheduleAttachmentMaintenance,
  validateAttachmentIdParam,
} from '../middleware/richChatAttachments.js';

/**
 * US-031 / #381 / FR-090 — private team channel, mounted at /api/teams/:teamId/chat.
 * Order matters: authentication -> UUID check -> confirmed-member gate -> body validation,
 * so a non-member is rejected (403) before anything about the channel is read or validated.
 */
export const teamChatRouter = Router({ mergeParams: true });

const participantAuthGuard = [
  requireFirebaseAuth,
  requireMfa,
  requireActiveAccount,
  requireParticipantRole,
  requireVerifiedParticipant,
];

const teamChatGuard = [...participantAuthGuard, validateTeamIdParams, requireConfirmedTeamMember];

function teamIdOf(req: Request): string {
  const raw = req.params.teamId;
  return (typeof raw === 'string' ? raw : raw[0]).trim();
}

function handleError(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof ChatServiceError) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }
  next(err);
}

/** GET /api/teams/:teamId/chat — opens the team's private channel. */
teamChatRouter.get(
  '/',
  ...teamChatGuard,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const channel = await openTeamChannel(teamIdOf(req));
      res.status(200).json(buildChatSuccessPayload({ status: 'ok', channel }));
    } catch (err) {
      handleError(err, res, next);
    }
  }
);

/** GET /api/teams/:teamId/chat/messages — oldest first; empty array when none. */
teamChatRouter.get(
  '/messages',
  ...teamChatGuard,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const messages = await listTeamChannelMessages(teamIdOf(req), req.participant!.id);
      res.status(200).json(buildChatSuccessPayload({ status: 'ok', messages }));
    } catch (err) {
      handleError(err, res, next);
    }
  }
);

/** POST /api/teams/:teamId/chat/messages — validation failures echo the draft (NR-017). */
teamChatRouter.post(
  '/messages',
  ...teamChatGuard,
  requireJsonObjectBody,
  validateSendMessageBody,
  rejectAttachmentIdsWhenUnavailable,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const message = await sendTeamChannelMessage({
        teamId: teamIdOf(req),
        authorId: req.participant!.id,
        body: req.body.body,
        attachmentIds: req.body.attachmentIds,
      });
      res.status(201).json(buildChatSuccessPayload({ status: 'ok', message }));
    } catch (err) {
      handleError(err, res, next);
    }
  }
);

/**
 * PUT    /api/teams/:teamId/chat/messages/:messageId/reactions/:reaction  (add)
 * DELETE /api/teams/:teamId/chat/messages/:messageId/reactions/:reaction  (remove)
 * US-035 / #405: confirmed members only, same 403 for non-members and missing teams;
 * a disbanded team's channel is read-only for reactions just as for messages.
 */
function teamReactionHandler(present: boolean) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const target = res.locals.reactionTarget as ReactionTarget;
      const result = await setTeamChannelMessageReaction({
        participant: req.participant!,
        teamId: teamIdOf(req),
        messageId: target.messageId,
        reaction: target.reaction,
        present,
      });
      res.status(200).json(buildChatSuccessPayload({ status: 'ok', ...result }));
    } catch (err) {
      handleError(err, res, next);
    }
  };
}

const teamReactionChain = [
  ...participantAuthGuard,
  requireReactionsEnabled,
  validateTeamIdParams,
  validateReactionParams,
  limitReactionMutations,
  requireConfirmedTeamMember,
];

teamChatRouter.put(
  '/messages/:messageId/reactions/:reaction',
  ...teamReactionChain,
  teamReactionHandler(true)
);

teamChatRouter.delete(
  '/messages/:messageId/reactions/:reaction',
  ...teamReactionChain,
  teamReactionHandler(false)
);

/**
 * POST /api/teams/:teamId/chat/typing   body: { "typing": true | false }
 * US-035 / #407: confirmed members of a live team only; a disbanded team is read-only.
 */
teamChatRouter.post(
  '/typing',
  ...participantAuthGuard,
  requireTypingEnabled,
  validateTeamIdParams,
  validateTypingSignalBody,
  limitTypingSignals,
  requireConfirmedTeamMember,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      await signalTeamTyping(req.participant!, teamIdOf(req), req.body.typing);
      res.status(200).json({ status: 'ok' });
    } catch (err) {
      handleError(err, res, next);
    }
  }
);

/** GET /api/teams/:teamId/chat/typing/stream — SSE typing events for this team's channel. */
teamChatRouter.get(
  '/typing/stream',
  ...participantAuthGuard,
  requireTypingEnabled,
  validateTeamIdParams,
  requireConfirmedTeamMember,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const access = await authorizeTeamViewer(req.participant!, teamIdOf(req));
      openTypingStream(req, res, { participantId: req.participant!.id, ...access });
    } catch (err) {
      handleError(err, res, next);
    }
  }
);

/**
 * POST /api/teams/:teamId/chat/attachments
 * US-035 / #409: confirmed members of a live team only; a disbanded team is read-only.
 */
teamChatRouter.post(
  '/attachments',
  ...participantAuthGuard,
  requireAttachmentsUsable,
  validateTeamIdParams,
  requireConfirmedTeamMember,
  resolveAttachmentConversation(async (req) => ({
    scope: 'channel',
    conversationId: (await assertTeamChannelWritable(teamIdOf(req))).id,
  })),
  precheckAttachmentRequest,
  readAttachmentBody,
  scheduleAttachmentMaintenance,
  attachmentUploadHandler(buildChatSuccessPayload)
);

/** GET /api/teams/:teamId/chat/attachments/:attachmentId/access — read access (history stays readable). */
teamChatRouter.get(
  '/attachments/:attachmentId/access',
  ...participantAuthGuard,
  requireAttachmentsUsable,
  validateTeamIdParams,
  requireConfirmedTeamMember,
  validateAttachmentIdParam,
  attachmentAccessHandler(
    async (req) => ({ scope: 'channel', conversationId: (await findTeamChannelOrThrow(teamIdOf(req))).id }),
    buildChatSuccessPayload
  )
);
