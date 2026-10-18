import {
  availabilityRepository,
  type IAvailabilityRepository,
} from '../repositories/availability.repository.js';

export interface AvailabilityStatusDeps {
  availabilityRepo: Pick<
    IAvailabilityRepository,
    'clearLookingForTeamStatus' | 'findByParticipantId' | 'upsertByParticipantId'
  >;
}

const defaultDeps: AvailabilityStatusDeps = {
  availabilityRepo: availabilityRepository,
};

/**
 * Atomically deactivates a participant's Looking-for-Team status across all availability records
 * while preserving their desired role, commitment hours, and goal so they can manually re-enable it later.
 */
export async function deactivateParticipantAvailability(
  participantId: string,
  deps: AvailabilityStatusDeps = defaultDeps
): Promise<{ participantId: string; deactivated: boolean }> {
  const deactivated = await deps.availabilityRepo.clearLookingForTeamStatus(participantId);
  return { participantId, deactivated };
}

/**
 * Reusable coordinator for confirmed membership join actions (e.g. invitation acceptance or
 * application approval) that executes the join action and automatically deactivates the
 * joining participant's Looking-for-Team status.
 */
export async function confirmMembershipAndClearAvailability<TMembership>(
  participantId: string,
  confirmMembershipAction: () => Promise<TMembership>,
  deps: AvailabilityStatusDeps = defaultDeps
): Promise<{ membership: TMembership; availabilityDeactivated: boolean }> {
  const membership = await confirmMembershipAction();
  const { deactivated } = await deactivateParticipantAvailability(participantId, deps);
  return { membership, availabilityDeactivated: deactivated };
}
