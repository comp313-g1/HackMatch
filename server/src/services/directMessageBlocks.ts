import { participantBlockRepository } from '../db/participantBlock.repository.js';
import { participantsRepository } from '../db/participants.repository.js';
import type { Participant } from '../db/types.js';
import { ChatServiceError } from './chat.js';

/**
 * #433 / US-032 / FR-091 — block and unblock another participant for direct messages.
 *
 * A block set here is enforced in both directions by the existing send rules: the blocker is told
 * "You have blocked this participant", while the blocked person only sees the neutral "cannot send
 * messages in this conversation" and cannot tell a block from a suspension.
 *
 * The answer never says more than the caller already knows:
 *  - blocking a missing participant (or an ADMIN) gives the same 404 as opening a conversation;
 *  - unblocking always succeeds, whether or not a block or such a participant exists.
 */

/** What the caller's own action left in place. Named so it is never mistaken for the peer's block. */
export interface BlockActionResult {
  youBlockedPeer: boolean;
}

export async function blockParticipant(input: {
  caller: Participant;
  targetId: string;
}): Promise<BlockActionResult> {
  const callerId = input.caller.id.toLowerCase();
  const targetId = input.targetId.trim().toLowerCase();

  if (callerId === targetId) {
    throw new ChatServiceError(400, 'CANNOT_BLOCK_SELF', 'You cannot block yourself.');
  }

  const target = await participantsRepository.findById(targetId);
  if (!target || target.role !== 'PART') {
    throw new ChatServiceError(404, 'PEER_NOT_AVAILABLE', 'That participant is not available.');
  }

  await participantBlockRepository.addBlock(callerId, targetId);
  return { youBlockedPeer: true };
}

export async function unblockParticipant(input: {
  caller: Participant;
  targetId: string;
}): Promise<BlockActionResult> {
  await participantBlockRepository.removeBlock(
    input.caller.id.toLowerCase(),
    input.targetId.trim().toLowerCase()
  );
  return { youBlockedPeer: false };
}
