import { directMessageRepository, type DirectMessageThread } from '../db/directMessage.repository.js';
import { participantBlockRepository } from '../db/participantBlock.repository.js';
import { participantsRepository } from '../db/participants.repository.js';
import type { Participant } from '../db/types.js';
import { ChatServiceError } from './chat.js';

/**
 * US-032 / #388 / FR-091 — who may read or write a direct-message thread.
 *
 * READ  : only the two participants of the thread, and only while the caller is a verified
 *         active PART (the route chain also enforces this; it is rechecked here on purpose).
 * WRITE : additionally the OTHER participant must still be a verified active PART, and neither
 *         participant may have blocked the other.
 *
 * Denials never reveal more than the caller already knows:
 *  - a thread that does not exist and a thread between other people give the SAME 403;
 *  - "the peer blocked you", "the peer is suspended" and "the peer is unverified" give the SAME
 *    403, so a blocked person cannot tell a block from a suspension;
 *  - only the person who set a block is told about it.
 */

/** Verified, active PART account (not suspended, not deactivated). */
export function isEligibleDirectMessageParticipant(
  participant: Participant | null | undefined
): participant is Participant {
  return (
    !!participant &&
    participant.role === 'PART' &&
    participant.is_verified === true &&
    !participant.is_suspended &&
    !participant.is_deactivated
  );
}

export const DM_DENIALS = {
  notParticipant: {
    status: 403,
    code: 'FORBIDDEN_NOT_THREAD_PARTICIPANT',
    message: 'You do not have access to this conversation.',
  },
  callerNotEligible: {
    status: 403,
    code: 'DM_ACCOUNT_NOT_ELIGIBLE',
    message: 'Your account cannot use direct messages. Verify your email and make sure the account is active.',
  },
  peerUnavailable: {
    status: 403,
    code: 'DM_PEER_UNAVAILABLE',
    message: 'You cannot send messages in this conversation.',
  },
  blockedByYou: {
    status: 403,
    code: 'DM_BLOCKED_BY_YOU',
    message: 'You have blocked this participant. Unblock them to send messages.',
  },
} as const;

type Denial = (typeof DM_DENIALS)[keyof typeof DM_DENIALS];

function deny(d: Denial): ChatServiceError {
  return new ChatServiceError(d.status, d.code, d.message);
}

export interface AuthorizedDirectThread {
  thread: DirectMessageThread;
  /** The other participant's id (lower-case). */
  peerId: string;
}

/**
 * Confirms the caller is one of the two participants of `threadId` and returns the thread.
 * Same 403 for "no such thread" and "not your thread".
 */
export async function authorizeDirectThreadAccess(input: {
  caller: Participant;
  threadId: string;
}): Promise<AuthorizedDirectThread> {
  if (!isEligibleDirectMessageParticipant(input.caller)) throw deny(DM_DENIALS.callerNotEligible);

  const callerId = input.caller.id.toLowerCase();
  const thread = await directMessageRepository.findThreadById(input.threadId.trim().toLowerCase());
  const low = thread?.participant_low_id.toLowerCase();
  const high = thread?.participant_high_id.toLowerCase();
  if (!thread || (callerId !== low && callerId !== high)) throw deny(DM_DENIALS.notParticipant);

  return { thread, peerId: callerId === low ? high! : low! };
}

/** Throws unless the caller may SEND in this (already authorized) thread right now. */
export async function assertCanSendInDirectThread(input: {
  caller: Participant;
  access: AuthorizedDirectThread;
}): Promise<void> {
  if (!isEligibleDirectMessageParticipant(input.caller)) throw deny(DM_DENIALS.callerNotEligible);

  const callerId = input.caller.id.toLowerCase();
  const peer = await participantsRepository.findById(input.access.peerId);
  if (!isEligibleDirectMessageParticipant(peer)) throw deny(DM_DENIALS.peerUnavailable);

  const blocks = await participantBlockRepository.findBlockState(callerId, input.access.peerId);
  if (blocks.blockedByMe) throw deny(DM_DENIALS.blockedByYou);
  if (blocks.blockedByThem) throw deny(DM_DENIALS.peerUnavailable);
}

/** True when either participant has blocked the other (used when OPENING a thread). */
export async function hasBlockBetween(a: string, b: string): Promise<boolean> {
  const state = await participantBlockRepository.findBlockState(a.toLowerCase(), b.toLowerCase());
  return state.blockedByMe || state.blockedByThem;
}
