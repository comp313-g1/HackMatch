import { participantsRepository } from '../db/participants.repository.js';
import type { PresenceStatus } from '../db/types.js';
import { DEFAULT_PRESENCE_STATUS } from '../validators/presence.validator.js';

/**
 * Safe presence payload for API responses (US-030 / #343 / FR-086).
 * Never includes email, credentials, OTPs, or firebase_uid.
 */
export interface PresenceView {
  presenceStatus: PresenceStatus;
  updatedAt: string;
}

export function toPresenceView(participant: {
  presence_status?: PresenceStatus | null;
  updated_at: string;
}): PresenceView {
  return {
    presenceStatus: participant.presence_status ?? DEFAULT_PRESENCE_STATUS,
    updatedAt: participant.updated_at,
  };
}

/** Persist FR-086 status for the authenticated verified PART. */
export async function updateMyPresence(
  participantId: string,
  presenceStatus: PresenceStatus
): Promise<PresenceView> {
  const updated = await participantsRepository.updatePresenceStatus(
    participantId,
    presenceStatus
  );
  return toPresenceView(updated);
}

/**
 * Peer-visible status: Invisible hides presence from other PART users.
 * Callers must already have denied Visitors (FR-086).
 */
export function peerVisiblePresenceStatus(
  presenceStatus: PresenceStatus | null | undefined
): PresenceStatus | null {
  const status = presenceStatus ?? DEFAULT_PRESENCE_STATUS;
  if (status === 'Invisible') return null;
  return status;
}
