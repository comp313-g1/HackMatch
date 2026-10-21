import { getSupabaseClient } from '../db/client.js';
import { availabilityRepository } from '../repositories/availability.repository.js';

export const ACCOUNT_SUSPEND_CANCEL_REASON = 'ACCOUNT_SUSPENDED';

export interface SuspensionCascadeEffects {
  pendingIncomingRequestsCanceled: number;
  outgoingInvitationsCanceled: number;
  profileHidden: boolean;
  availabilityCleared: boolean;
  ownedTeamsPaused: number;
  membershipsPreserved: true;
}

/**
 * US-027 / #251 / AC 2 — after an account is marked suspended:
 * - cancel the user's pending invitations/applications
 * - cancel outgoing pending invitations from owned unlocked teams
 * - hide the profile from ordinary discovery
 * - clear Looking-for-Team availability
 * - pause owned Open recruitment listings (hide from discovery; do not delete memberships)
 */
export async function applySuspensionCascade(
  participantId: string
): Promise<SuspensionCascadeEffects> {
  const client = getSupabaseClient();
  const now = new Date().toISOString();

  // 1. Cancel pending requests addressed to / submitted by this participant.
  const { data: incomingCanceled, error: incomingErr } = await client
    .from('team_requests')
    .update({
      status: 'Canceled',
      cancel_reason: ACCOUNT_SUSPEND_CANCEL_REASON,
      resolved_at: now,
      updated_at: now,
    })
    .eq('participant_id', participantId)
    .eq('status', 'Pending')
    .select('id');
  if (incomingErr) throw incomingErr;

  // 2. Owned unlocked Open teams — pause recruitment by hiding from discovery.
  const { data: ownedOpenTeams, error: ownedErr } = await client
    .from('teams')
    .select('id')
    .eq('owner_participant_id', participantId)
    .eq('recruitment_status', 'Open')
    .is('locked_at', null);
  if (ownedErr) throw ownedErr;

  const ownedTeamIds = (ownedOpenTeams || []).map((t) => t.id as string);
  let ownedTeamsPaused = 0;
  let outgoingInvitationsCanceled = 0;

  if (ownedTeamIds.length > 0) {
    const { data: pausedTeams, error: pauseErr } = await client
      .from('teams')
      .update({
        moderation_status: 'Hidden',
        moderation_hidden_at: now,
        updated_at: now,
      })
      .in('id', ownedTeamIds)
      .select('id');
    if (pauseErr) throw pauseErr;
    ownedTeamsPaused = pausedTeams?.length ?? 0;

    const { data: outgoingCanceled, error: outgoingErr } = await client
      .from('team_requests')
      .update({
        status: 'Canceled',
        cancel_reason: ACCOUNT_SUSPEND_CANCEL_REASON,
        resolved_at: now,
        updated_at: now,
      })
      .in('team_id', ownedTeamIds)
      .eq('request_type', 'Invitation')
      .eq('status', 'Pending')
      .select('id');
    if (outgoingErr) throw outgoingErr;
    outgoingInvitationsCanceled = outgoingCanceled?.length ?? 0;
  }

  // 3. Hide participant profile from ordinary candidate discovery.
  const { data: hiddenProfile, error: profileErr } = await client
    .from('participant_profiles')
    .update({
      moderation_status: 'Hidden',
      updated_at: now,
    })
    .eq('participant_id', participantId)
    .select('participant_id');
  if (profileErr) throw profileErr;

  // 4. Clear Looking-for-Team availability.
  const availabilityCleared =
    await availabilityRepository.clearLookingForTeamStatus(participantId);

  return {
    pendingIncomingRequestsCanceled: incomingCanceled?.length ?? 0,
    outgoingInvitationsCanceled,
    profileHidden: Boolean(hiddenProfile && hiddenProfile.length > 0),
    availabilityCleared,
    ownedTeamsPaused,
    membershipsPreserved: true,
  };
}
