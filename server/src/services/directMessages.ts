import {
  CHAT_MESSAGE_BODY_MAX_LENGTH,
  isChatMessageBodyTooLong,
  normalizeChatMessageBody,
} from '../db/chatModel.js';
import {
  canonicalParticipantPair,
  directMessageRepository,
  getPeerParticipantId,
  isDirectMessageParticipant,
  type DirectMessage,
  type DirectMessageThread,
  type IDirectMessageRepository,
} from '../db/directMessage.repository.js';
import {
  participantsRepository,
  type IParticipantRepository,
} from '../db/participants.repository.js';
import {
  profileRepository,
  type IProfileRepository,
} from '../db/profile.repository.js';
import {
  participantBlockRepository,
  type IParticipantBlockRepository,
} from '../db/participantBlock.repository.js';
import type { Participant } from '../db/types.js';
import { ChatServiceError } from './chat.js';
import {
  toDirectInboxItemView,
  toDirectMessageView,
  toDirectThreadView,
  toUtcIsoTimestamp,
  type DirectInboxItemView,
  type DirectMessageView,
  type DirectThreadView,
} from './directMessagePrivacy.js';
import {
  DM_DENIALS,
  hasBlockBetween,
  isEligibleDirectMessageParticipant,
} from './directMessageAccess.js';

export class DirectMessageServiceError extends ChatServiceError {
  constructor(status: number, code: string, message: string) {
    super(status, code, message);
    this.name = 'DirectMessageServiceError';
  }
}

/**
 * #435 — the service reports denials with the SAME codes and wording as the route guard
 * (`DM_DENIALS` in directMessageAccess.ts), so there is one set of codes whichever layer refuses.
 */
function denial(d: (typeof DM_DENIALS)[keyof typeof DM_DENIALS]): DirectMessageServiceError {
  return new DirectMessageServiceError(d.status, d.code, d.message);
}

export interface DmInboxResult {
  threads: DirectInboxItemView[];
  isEmpty: boolean;
}

export interface DmThreadDetailResult {
  thread: DirectInboxItemView;
  messages: DirectMessageView[];
  isEmpty: boolean;
}

export interface DirectMessageServiceDeps {
  dmRepo?: Partial<IDirectMessageRepository>;
  participantsRepo?: Pick<IParticipantRepository, 'findById'>;
  profileRepo?: Pick<IProfileRepository, 'findProfileByParticipantId'>;
  blockRepo?: Pick<IParticipantBlockRepository, 'findBlockState'>;
}

/** One answer for "does not exist" and "cannot be messaged", so accounts cannot be enumerated. */
const PEER_NOT_AVAILABLE = {
  status: 404,
  code: 'PEER_NOT_AVAILABLE',
  message: 'That participant is not available for direct messages.',
} as const;

/** Eligible = a verified, active PART account (single definition lives in directMessageAccess). */
export const isEligibleDirectMessagePeer = isEligibleDirectMessageParticipant;

/** Re-exported so callers keep one import for the DM payload shapes (defined in directMessagePrivacy). */
export { toDirectThreadView, toDirectMessageView, toUtcIsoTimestamp };
export type { DirectThreadView, DirectMessageView, DirectInboxItemView };

function getDeps(deps: DirectMessageServiceDeps = {}) {
  return {
    dmRepo: {
      findThreadById:
        deps.dmRepo?.findThreadById ??
        directMessageRepository.findThreadById.bind(directMessageRepository),
      findThreadByPair:
        deps.dmRepo?.findThreadByPair ??
        directMessageRepository.findThreadByPair.bind(directMessageRepository),
      findOrCreateThread:
        deps.dmRepo?.findOrCreateThread ??
        directMessageRepository.findOrCreateThread.bind(directMessageRepository),
      listThreadsForParticipant:
        deps.dmRepo?.listThreadsForParticipant ??
        directMessageRepository.listThreadsForParticipant.bind(
          directMessageRepository
        ),
      listMessagesByThread:
        deps.dmRepo?.listMessagesByThread ??
        directMessageRepository.listMessagesByThread.bind(
          directMessageRepository
        ),
      findLatestMessagesForThreads:
        deps.dmRepo?.findLatestMessagesForThreads ??
        directMessageRepository.findLatestMessagesForThreads.bind(
          directMessageRepository
        ),
      createMessage:
        deps.dmRepo?.createMessage ??
        directMessageRepository.createMessage.bind(directMessageRepository),
      isParticipantPairBlocked:
        deps.dmRepo?.isParticipantPairBlocked ??
        directMessageRepository.isParticipantPairBlocked.bind(
          directMessageRepository
        ),
    },
    participantsRepo: deps.participantsRepo ?? participantsRepository,
    profileRepo: deps.profileRepo ?? profileRepository,
    blockRepo: deps.blockRepo ?? participantBlockRepository,
  };
}

async function resolveParticipantHandles(
  participantIds: string[],
  profileRepo: Pick<IProfileRepository, 'findProfileByParticipantId'>
): Promise<Map<string, string | null>> {
  const uniqueIds = [...new Set(participantIds.filter(Boolean))];
  const entries = await Promise.all(
    uniqueIds.map(async (id) => {
      const profile = await profileRepo.findProfileByParticipantId(id);
      return [id, profile?.handle ?? null] as const;
    })
  );
  return new Map(entries);
}

/**
 * Translates database-level DM lifecycle / restriction triggers into explicit 403 responses.
 */
export function mapDirectMessageWriteError(
  err: unknown
): DirectMessageServiceError | null {
  const text = String((err as { message?: unknown } | null)?.message ?? '');
  // A database trigger cannot tell us WHO set a block, so every peer-side refusal (block, suspension,
  // unverified) gets the one neutral answer; nothing here reveals a block.
  if (
    text.includes('DM_PEER_BLOCKED') ||
    text.includes('PARTICIPANT_BLOCKED') ||
    text.includes('DM_PEER_SUSPENDED') ||
    text.includes('DM_PEER_UNVERIFIED')
  ) {
    return denial(DM_DENIALS.peerUnavailable);
  }
  if (text.includes('DM_ACCOUNT_SUSPENDED')) {
    return denial(DM_DENIALS.callerNotEligible);
  }
  if (
    text.includes('DM_NOT_A_PARTICIPANT') ||
    text.includes('DM_THREAD_ACCESS_DENIED')
  ) {
    return denial(DM_DENIALS.notParticipant);
  }
  return null;
}

async function findAuthorizedDmThreadOrThrow(
  threadId: string,
  participantId: string,
  dmRepo: Pick<IDirectMessageRepository, 'findThreadById'>
): Promise<DirectMessageThread> {
  const trimmedThreadId = threadId?.trim();
  const trimmedParticipantId = participantId?.trim();
  if (!trimmedThreadId || !trimmedParticipantId) {
    throw denial(DM_DENIALS.notParticipant);
  }

  const thread = await dmRepo.findThreadById(trimmedThreadId);
  // Fail closed: missing thread and third-party thread produce the exact same 403
  // so callers cannot probe whether an unrelated private thread exists.
  if (!thread || !isDirectMessageParticipant(thread, trimmedParticipantId)) {
    throw denial(DM_DENIALS.notParticipant);
  }

  return thread;
}

/**
 * Opens the one-to-one thread between the caller and `peerId`, or returns the existing one
 * (idempotent). The lookup key always contains the caller, so the response can only ever
 * describe a thread the caller is part of; threads between other people are unreachable and
 * their existence cannot be probed.
 */
export async function openOrContinueDirectThread(
  input: {
    caller: Participant;
    peerId: string;
  },
  deps: DirectMessageServiceDeps = {}
): Promise<{ thread: DirectThreadView; created: boolean }> {
  const callerId = input.caller.id.toLowerCase();
  const peerId = input.peerId.trim().toLowerCase();
  const pair = canonicalParticipantPair(callerId, peerId);
  if (!pair) {
    throw new ChatServiceError(
      400,
      'CANNOT_MESSAGE_SELF',
      'You cannot start a direct message with yourself.'
    );
  }

  const { dmRepo, participantsRepo, profileRepo } = getDeps(deps);
  const peer = await participantsRepo.findById(peerId);
  // A block in either direction looks exactly like a missing or ineligible peer.
  if (!isEligibleDirectMessagePeer(peer) || (await hasBlockBetween(callerId, peerId))) {
    throw new ChatServiceError(
      PEER_NOT_AVAILABLE.status,
      PEER_NOT_AVAILABLE.code,
      PEER_NOT_AVAILABLE.message
    );
  }

  const { thread, created } = await dmRepo.findOrCreateThread(
    pair.low,
    pair.high
  );
  const profile = await profileRepo.findProfileByParticipantId(peer.id);
  return {
    thread: toDirectThreadView(thread, callerId, profile?.handle ?? null),
    created,
  };
}

/**
 * US-032 / #387: Lists the authenticated participant's DM inbox threads,
 * ordered by most recent activity first (UTC), with safe participant handles
 * and explicit empty state (`threads: [], isEmpty: true`).
 */
export async function listDmInbox(
  participantId: string,
  deps: DirectMessageServiceDeps = {}
): Promise<DmInboxResult> {
  const trimmedParticipantId = participantId?.trim();
  if (!trimmedParticipantId) {
    throw new DirectMessageServiceError(
      401,
      'UNAUTHORIZED',
      'Authentication required.'
    );
  }

  const { dmRepo, profileRepo } = getDeps(deps);
  const rawThreads =
    await dmRepo.listThreadsForParticipant(trimmedParticipantId);

  const authorizedThreads = rawThreads.filter((thread) =>
    isDirectMessageParticipant(thread, trimmedParticipantId)
  );

  if (authorizedThreads.length === 0) {
    return {
      threads: [],
      isEmpty: true,
    };
  }

  const latestMessages = await dmRepo.findLatestMessagesForThreads(
    authorizedThreads.map((t) => t.id)
  );

  const callerKey = trimmedParticipantId.toLowerCase();
  const peerIdOf = (t: DirectMessageThread): string =>
    getPeerParticipantId(t, trimmedParticipantId) ??
    (t.participant_low_id.toLowerCase() === callerKey ? t.participant_high_id : t.participant_low_id);
  // The caller's own handle is needed too: the latest message may have been written by them.
  const handles = await resolveParticipantHandles(
    [trimmedParticipantId, ...authorizedThreads.map(peerIdOf)],
    profileRepo
  );
  const handleOf = (id: string): string | null => handles.get(id) ?? handles.get(id.toLowerCase()) ?? null;

  const views = authorizedThreads.map((thread) => {
    const latest = latestMessages.get(thread.id) ?? null;
    return toDirectInboxItemView(
      thread,
      trimmedParticipantId,
      handleOf(peerIdOf(thread)),
      latest ? { message: latest, authorHandle: handleOf(latest.author_id) } : null
    );
  });

  views.sort((a, b) => {
    const timeA = Date.parse(a.lastMessageAt ?? a.updatedAt ?? a.createdAt);
    const timeB = Date.parse(b.lastMessageAt ?? b.updatedAt ?? b.createdAt);
    return timeB - timeA;
  });

  return {
    threads: views,
    isEmpty: false,
  };
}

/**
 * US-032 / #387: Opens a DM thread and returns its metadata and chronological messages (oldest-first),
 * with safe participant handles, UTC timestamps, and explicit empty state (`messages: [], isEmpty: true`).
 */
export async function getDmThread(
  input: {
    threadId: string;
    participantId: string;
  },
  deps: DirectMessageServiceDeps = {}
): Promise<DmThreadDetailResult> {
  const { dmRepo, profileRepo, blockRepo } = getDeps(deps);

  const thread = await findAuthorizedDmThreadOrThrow(
    input.threadId,
    input.participantId,
    dmRepo
  );

  const rawMessages = await dmRepo.listMessagesByThread(thread.id);
  const sortedMessages = [...rawMessages].sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  const peerId =
    getPeerParticipantId(thread, input.participantId) ??
    (thread.participant_low_id.toLowerCase() === input.participantId.toLowerCase()
      ? thread.participant_high_id
      : thread.participant_low_id);

  const idsToResolve = [
    peerId,
    input.participantId,
    ...sortedMessages.map((m) => m.author_id),
  ];
  const handles = await resolveParticipantHandles(idsToResolve, profileRepo);

  const callerId = input.participantId.trim();
  const messages = sortedMessages.map((message) =>
    toDirectMessageView(message, callerId, handles.get(message.author_id) ?? null)
  );

  const latestMessage =
    sortedMessages.length > 0
      ? sortedMessages[sortedMessages.length - 1]
      : null;

  // Only the viewer's OWN block is reported, so the screen can offer Unblock. A block set by the
  // other person is never exposed.
  const blocks = await blockRepo.findBlockState(callerId.toLowerCase(), peerId.toLowerCase());

  const threadView = toDirectInboxItemView(
    thread,
    callerId,
    handles.get(peerId) ?? null,
    latestMessage
      ? { message: latestMessage, authorHandle: handles.get(latestMessage.author_id) ?? null }
      : null,
    blocks.blockedByMe
  );

  return {
    thread: threadView,
    messages,
    isEmpty: messages.length === 0,
  };
}

export async function listDmThreadMessages(
  input: {
    threadId: string;
    participantId: string;
  },
  deps: DirectMessageServiceDeps = {}
): Promise<DmThreadDetailResult> {
  return getDmThread(input, deps);
}

/**
 * US-032 / #387: Sends a validated direct message in an existing thread.
 */
export async function sendDmMessage(
  input: {
    threadId: string;
    authorId: string;
    body: string;
  },
  deps: DirectMessageServiceDeps = {}
): Promise<DirectMessageView> {
  const normalizedBody = normalizeChatMessageBody(input.body);
  if (normalizedBody == null) {
    throw new DirectMessageServiceError(
      400,
      'VALIDATION_ERROR',
      'body is required.'
    );
  }
  if (isChatMessageBodyTooLong(input.body)) {
    throw new DirectMessageServiceError(
      400,
      'VALIDATION_ERROR',
      `body must be at most ${CHAT_MESSAGE_BODY_MAX_LENGTH} characters.`
    );
  }

  const { dmRepo, participantsRepo, profileRepo, blockRepo } = getDeps(deps);

  const thread = await findAuthorizedDmThreadOrThrow(
    input.threadId,
    input.authorId,
    dmRepo
  );

  const peerId = getPeerParticipantId(thread, input.authorId);
  if (!peerId) {
    throw denial(DM_DENIALS.notParticipant);
  }

  // Same rules and answers as the route guard (assertCanSendInDirectThread): an unavailable peer and
  // a peer who blocked you look identical; only the person who set a block is told about it.
  const peer = await participantsRepo.findById(peerId);
  if (!isEligibleDirectMessageParticipant(peer)) {
    throw denial(DM_DENIALS.peerUnavailable);
  }

  const blocks = await blockRepo.findBlockState(
    input.authorId.trim().toLowerCase(),
    peerId.toLowerCase()
  );
  if (blocks.blockedByMe) throw denial(DM_DENIALS.blockedByYou);
  if (blocks.blockedByThem) throw denial(DM_DENIALS.peerUnavailable);

  let createdMessage: DirectMessage;
  try {
    createdMessage = await dmRepo.createMessage({
      thread_id: thread.id,
      author_id: input.authorId.trim(),
      body: normalizedBody,
    });
  } catch (err) {
    throw mapDirectMessageWriteError(err) ?? err;
  }

  const authorProfile = await profileRepo.findProfileByParticipantId(
    input.authorId.trim()
  );
  return toDirectMessageView(createdMessage, input.authorId.trim(), authorProfile?.handle ?? null);
}
