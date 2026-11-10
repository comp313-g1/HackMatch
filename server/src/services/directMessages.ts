import { participantsRepository } from '../db/participants.repository.js';
import { profileRepository } from '../db/profile.repository.js';
import {
  canonicalParticipantPair,
  directMessageRepository,
  type DirectMessageThread,
} from '../db/directMessage.repository.js';
import type { Participant } from '../db/types.js';
import { ChatServiceError } from './chat.js';
import { scrubPrivateChatFields } from './chatPrivacy.js';

/**
 * Safe thread payload (US-032 / #386 / FR-091, FR-089 bar). The other participant appears by id
 * and handle only: never email, name, credentials, or firebase_uid.
 */
export interface DirectThreadView {
  id: string;
  peer: { id: string; handle: string | null };
  createdAt: string;
  updatedAt: string;
}

/** One answer for "does not exist" and "cannot be messaged", so accounts cannot be enumerated. */
const PEER_NOT_AVAILABLE = {
  status: 404,
  code: 'PEER_NOT_AVAILABLE',
  message: 'That participant is not available for direct messages.',
} as const;

/** Eligible = a verified, active PART account. */
export function isEligibleDirectMessagePeer(participant: Participant | null): participant is Participant {
  return (
    !!participant &&
    participant.role === 'PART' &&
    participant.is_verified === true &&
    !participant.is_suspended &&
    !participant.is_deactivated
  );
}

export function toDirectThreadView(
  thread: DirectMessageThread,
  callerId: string,
  peerHandle: string | null
): DirectThreadView {
  const peerId =
    thread.participant_low_id === callerId ? thread.participant_high_id : thread.participant_low_id;
  return scrubPrivateChatFields({
    id: thread.id,
    peer: { id: peerId, handle: peerHandle },
    createdAt: thread.created_at,
    updatedAt: thread.updated_at,
  });
}

/**
 * Opens the one-to-one thread between the caller and `peerId`, or returns the existing one
 * (idempotent). The lookup key always contains the caller, so the response can only ever
 * describe a thread the caller is part of; threads between other people are unreachable and
 * their existence cannot be probed.
 */
export async function openOrContinueDirectThread(input: {
  caller: Participant;
  peerId: string;
}): Promise<{ thread: DirectThreadView; created: boolean }> {
  const callerId = input.caller.id.toLowerCase();
  const peerId = input.peerId.trim().toLowerCase();
  const pair = canonicalParticipantPair(callerId, peerId);
  if (!pair) {
    throw new ChatServiceError(400, 'CANNOT_MESSAGE_SELF', 'You cannot start a direct message with yourself.');
  }

  const peer = await participantsRepository.findById(peerId);
  if (!isEligibleDirectMessagePeer(peer)) {
    throw new ChatServiceError(PEER_NOT_AVAILABLE.status, PEER_NOT_AVAILABLE.code, PEER_NOT_AVAILABLE.message);
  }

  const { thread, created } = await directMessageRepository.findOrCreateThread(pair.low, pair.high);
  const profile = await profileRepository.findProfileByParticipantId(peer.id);
  return { thread: toDirectThreadView(thread, callerId, profile?.handle ?? null), created };
}
