import { firebaseAuth } from '../config/firebase.js';
import { getSupabaseClient } from '../db/client.js';
import { accountDeletionRepository } from '../db/accountDeletion.repository.js';
import { moderationRepository } from '../db/moderation.repository.js';
import { participantsRepository } from '../db/participants.repository.js';
import type { AccountDeletionRequest } from '../db/types.js';
import {
  AccountManagementError,
  getAdminAccountDetail,
  type AdminAccountDetail,
} from './accountManagement.js';
import { applySuspensionCascade } from './accountSuspensionCascade.js';
import { pseudonymizeHistoricalMemberships } from './membershipPseudonymization.js';

export const DELETION_TARGET_NOTICE =
  'Proposed 30-day live-PII processing target under R-06 / NR-023; not an automatic legal-compliance claim.';

export interface DeleteAccountInput {
  actorParticipantId: string;
  actorRole: 'PART' | 'ADMIN';
  accountId: string;
  reason: string;
  /** Must be true — ADMIN confirms ownership verification before recording the request. */
  ownershipVerified: boolean;
}

export type DeleteAccountOutcome =
  | 'deletion_completed'
  | 'deletion_blocked_needs_disband'
  | 'deletion_already_completed';

export interface SafeDeletionRequestView {
  id: string;
  participantId: string;
  status: AccountDeletionRequest['status'];
  ownershipVerified: boolean;
  ownershipVerifiedAt: string | null;
  blockedReason: string | null;
  targetCompletionAt: string;
  completedAt: string | null;
  reason: string;
  createdAt: string;
  targetNotice: string;
}

export interface DeleteAccountResult {
  outcome: DeleteAccountOutcome;
  request: SafeDeletionRequestView;
  account: AdminAccountDetail['account'];
  livePiiErased: boolean;
  firebaseUserDeleted: boolean;
  sessionsRevoked: boolean;
  /** True when locked (and historical) membership snapshots were pseudonymized; roster rows kept. */
  lockedMembershipsPseudonymized: boolean;
  lockedMembershipsPseudonymizedCount: number;
  membershipIdsPreserved: string[];
  unlockedOwnedTeamIds: string[];
  actionRecordId: string | null;
}

function toSafeDeletionRequestView(row: AccountDeletionRequest): SafeDeletionRequestView {
  return {
    id: row.id,
    participantId: row.participant_id,
    status: row.status,
    ownershipVerified: row.ownership_verified,
    ownershipVerifiedAt: row.ownership_verified_at,
    blockedReason: row.blocked_reason,
    targetCompletionAt: row.target_completion_at,
    completedAt: row.completed_at,
    reason: row.reason,
    createdAt: row.created_at,
    targetNotice: DELETION_TARGET_NOTICE,
  };
}

async function listOwnedUnlockedTeams(
  participantId: string
): Promise<Array<{ id: string; name: string }>> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('teams')
    .select('id, name')
    .eq('owner_participant_id', participantId)
    .is('locked_at', null)
    .is('disbanded_at', null);

  if (error) throw error;
  return (data || []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
  }));
}

/**
 * Erase live identifying fields while keeping the participant row (locked roster FKs).
 * Call after {@link pseudonymizeHistoricalMemberships} so roster snapshots are labeled first.
 */
export async function eraseLiveAccountPii(participantId: string): Promise<{
  profileCleared: boolean;
  providerIdentitiesRemoved: number;
  mfaChallengesRemoved: number;
}> {
  const client = getSupabaseClient();
  const tombstoneEmail = `deleted+${participantId.replace(/-/g, '').slice(0, 12)}@deleted.invalid`;
  const tombstoneUid = `deleted:${participantId}`;

  const { error: participantErr } = await client
    .from('participants')
    .update({
      email: tombstoneEmail,
      full_name: 'Deleted User',
      firebase_uid: tombstoneUid,
      is_verified: false,
      is_suspended: true,
      suspended_at: new Date().toISOString(),
      suspension_reason: 'Account deletion processed',
      is_deactivated: true,
      deactivated_at: new Date().toISOString(),
      deactivation_reason: 'Ownership-verified deletion completed',
    })
    .eq('id', participantId);
  if (participantErr) throw participantErr;

  const { data: profileRows, error: profileErr } = await client
    .from('participant_profiles')
    .update({
      handle: null,
      institution: null,
      shared_contact_handle: null,
      primary_role: null,
      moderation_status: 'Hidden',
      updated_at: new Date().toISOString(),
    })
    .eq('participant_id', participantId)
    .select('participant_id');
  if (profileErr) throw profileErr;

  const { error: skillsErr } = await client
    .from('participant_skills')
    .delete()
    .eq('participant_id', participantId);
  if (skillsErr) throw skillsErr;

  const { error: portfoliosErr } = await client
    .from('participant_portfolios')
    .delete()
    .eq('participant_id', participantId);
  if (portfoliosErr) throw portfoliosErr;

  const { data: providers, error: providersErr } = await client
    .from('provider_identities')
    .delete()
    .eq('participant_id', participantId)
    .select('id');
  if (providersErr) throw providersErr;

  const { data: mfaRows, error: mfaErr } = await client
    .from('mfa_challenges')
    .delete()
    .eq('participant_id', participantId)
    .select('id');
  if (mfaErr) throw mfaErr;

  return {
    profileCleared: Boolean(profileRows && profileRows.length > 0),
    providerIdentitiesRemoved: providers?.length ?? 0,
    mfaChallengesRemoved: mfaRows?.length ?? 0,
  };
}

async function processLiveDeletion(params: {
  request: AccountDeletionRequest;
  target: { id: string; firebase_uid: string };
  actorParticipantId: string;
  reason: string;
  unlockedOwnedTeamIds: string[];
}): Promise<DeleteAccountResult> {
  const { request, target, actorParticipantId, reason, unlockedOwnedTeamIds } = params;
  const firebaseUid = target.firebase_uid;

  const processing = await accountDeletionRepository.update(request.id, {
    status: 'Processing',
    ownership_verified: true,
    ownership_verified_at: request.ownership_verified_at ?? new Date().toISOString(),
    ownership_verified_by: request.ownership_verified_by ?? actorParticipantId,
    blocked_reason: null,
    safe_state_summary: {
      ...(request.safe_state_summary || {}),
      credentialsIncluded: false,
      otpsIncluded: false,
      privateNotesIncluded: false,
      livePiiErased: false,
      lockedMembershipsPseudonymized: false,
      targetNotice: DELETION_TARGET_NOTICE,
    },
  });

  let sessionsRevoked = false;
  let firebaseUserDeleted = false;
  try {
    if (firebaseUid && !firebaseUid.startsWith('deleted:')) {
      await firebaseAuth.revokeRefreshTokens(firebaseUid);
      sessionsRevoked = true;
    }
  } catch (err: unknown) {
    throw new AccountManagementError(
      502,
      'FIREBASE_REVOKE_FAILED',
      'Deletion request is recorded, but Firebase session revocation failed. Retry deletion.',
      {
        accountId: target.id,
        requestId: processing.id,
        firebaseError: err instanceof Error ? err.message : 'unknown',
        sessionsRevoked,
      }
    );
  }

  await applySuspensionCascade(target.id);

  // #253 — pseudonymize historical membership snapshots; never delete locked roster rows.
  const membershipPseudo = await pseudonymizeHistoricalMemberships(target.id);
  const eraseStats = await eraseLiveAccountPii(target.id);

  try {
    if (firebaseUid && !firebaseUid.startsWith('deleted:')) {
      await firebaseAuth.deleteUser(firebaseUid);
      firebaseUserDeleted = true;
    }
  } catch (err: unknown) {
    throw new AccountManagementError(
      502,
      'FIREBASE_DELETE_FAILED',
      'Live PII was erased, but Firebase user deletion failed. Retry deletion.',
      {
        accountId: target.id,
        requestId: processing.id,
        firebaseError: err instanceof Error ? err.message : 'unknown',
        sessionsRevoked,
        firebaseUserDeleted,
        livePiiErased: true,
        lockedMembershipsPseudonymized: membershipPseudo.lockedMembershipsPseudonymized > 0,
      }
    );
  }

  const completedAt = new Date().toISOString();
  const lockedMembershipsPseudonymized =
    membershipPseudo.lockedMembershipsPseudonymized > 0 ||
    membershipPseudo.membershipIdsPreserved.length === 0;
  const safeSummary = {
    credentialsIncluded: false,
    otpsIncluded: false,
    privateNotesIncluded: false,
    livePiiErased: true,
    lockedMembershipsPseudonymized,
    lockedMembershipsPseudonymizedCount: membershipPseudo.lockedMembershipsPseudonymized,
    unlockedMembershipsPseudonymizedCount: membershipPseudo.unlockedMembershipsPseudonymized,
    membershipIdsPreserved: membershipPseudo.membershipIdsPreserved,
    lockedTeamIdsPreserved: membershipPseudo.lockedTeamIdsPreserved,
    membershipsDeleted: false as const,
    sessionsRevoked,
    firebaseUserDeleted,
    profileCleared: eraseStats.profileCleared,
    providerIdentitiesRemoved: eraseStats.providerIdentitiesRemoved,
    mfaChallengesRemoved: eraseStats.mfaChallengesRemoved,
    unlockedOwnedTeamIds,
    targetCompletionAt: processing.target_completion_at,
    targetNotice: DELETION_TARGET_NOTICE,
  };

  const completed = await accountDeletionRepository.update(processing.id, {
    status: 'Completed',
    completed_at: completedAt,
    blocked_reason: null,
    safe_state_summary: safeSummary,
  });

  const actionRecord = await moderationRepository.insertActionRecord({
    actor_id: actorParticipantId,
    target_type: 'account',
    target_id: target.id,
    action_type: 'account_delete',
    reason,
    outcome: 'deletion_completed',
    safe_state_summary: {
      requestId: completed.id,
      ...safeSummary,
    },
  });

  const detail = await getAdminAccountDetail(target.id);

  return {
    outcome: 'deletion_completed',
    request: toSafeDeletionRequestView(completed),
    account: detail.account,
    livePiiErased: true,
    firebaseUserDeleted,
    sessionsRevoked,
    lockedMembershipsPseudonymized,
    lockedMembershipsPseudonymizedCount: membershipPseudo.lockedMembershipsPseudonymized,
    membershipIdsPreserved: membershipPseudo.membershipIdsPreserved,
    unlockedOwnedTeamIds,
    actionRecordId: actionRecord.id,
  };
}

/**
 * US-027 / #252 / AC 3 / FR-078 — ownership-verified deletion with 30-day target workflow.
 *
 * - Requires ADMIN + explicit ownershipVerified confirmation + reason.
 * - Unlocked team owners must disband first (BlockedNeedsDisband).
 * - When clear: record request (target_completion_at = created + 30 days), erase live PII,
 *   revoke/delete Firebase user, deactivate account. Locked-membership pseudonymization is #253.
 */
export async function requestAccountDeletion(
  input: DeleteAccountInput
): Promise<DeleteAccountResult> {
  if (input.actorRole !== 'ADMIN') {
    throw new AccountManagementError(
      403,
      'FORBIDDEN_ROLE',
      'You do not have permission to access this resource.'
    );
  }

  if (!input.ownershipVerified) {
    throw new AccountManagementError(
      400,
      'OWNERSHIP_NOT_VERIFIED',
      'Ownership verification is required before recording an account deletion request.',
      { ownershipVerified: input.ownershipVerified }
    );
  }

  if (input.actorParticipantId === input.accountId) {
    throw new AccountManagementError(
      400,
      'SELF_DELETE_FORBIDDEN',
      'Administrators cannot delete their own account.',
      { accountId: input.accountId }
    );
  }

  const target = await participantsRepository.findById(input.accountId);
  if (!target) {
    throw new AccountManagementError(404, 'ACCOUNT_NOT_FOUND', 'Account not found.', {
      accountId: input.accountId,
    });
  }

  if (target.role === 'ADMIN') {
    throw new AccountManagementError(
      400,
      'INVALID_TARGET',
      'Administrator accounts cannot be deleted through this workflow.',
      { accountId: input.accountId }
    );
  }

  const open = await accountDeletionRepository.findOpenByParticipantId(target.id);
  const unlockedTeams = await listOwnedUnlockedTeams(target.id);
  const unlockedOwnedTeamIds = unlockedTeams.map((t) => t.id);
  const now = new Date().toISOString();

  if (target.is_deactivated && !open) {
    const prior = (
      await accountDeletionRepository.listNewestFirst({ status: 'Completed', limit: 20 })
    ).find((row) => row.participant_id === target.id);

    if (prior) {
      const detail = await getAdminAccountDetail(target.id);
      const priorCount = Number(
        (prior.safe_state_summary as { lockedMembershipsPseudonymizedCount?: number } | undefined)
          ?.lockedMembershipsPseudonymizedCount ?? 0
      );
      return {
        outcome: 'deletion_already_completed',
        request: toSafeDeletionRequestView(prior),
        account: detail.account,
        livePiiErased: true,
        firebaseUserDeleted: true,
        sessionsRevoked: true,
        lockedMembershipsPseudonymized: Boolean(
          (prior.safe_state_summary as { lockedMembershipsPseudonymized?: boolean } | undefined)
            ?.lockedMembershipsPseudonymized
        ),
        lockedMembershipsPseudonymizedCount: priorCount,
        membershipIdsPreserved: Array.isArray(
          (prior.safe_state_summary as { membershipIdsPreserved?: string[] } | undefined)
            ?.membershipIdsPreserved
        )
          ? ((prior.safe_state_summary as { membershipIdsPreserved: string[] }).membershipIdsPreserved)
          : [],
        unlockedOwnedTeamIds,
        actionRecordId: null,
      };
    }
  }

  if (unlockedOwnedTeamIds.length > 0) {
    const blockedReason = `Owner must disband ${unlockedOwnedTeamIds.length} unlocked team(s) before deletion can proceed: ${unlockedTeams
      .map((t) => t.name)
      .join(', ')}.`;

    let blockedRequest: AccountDeletionRequest;
    if (open) {
      blockedRequest = await accountDeletionRepository.update(open.id, {
        status: 'BlockedNeedsDisband',
        ownership_verified: true,
        ownership_verified_at: open.ownership_verified_at ?? now,
        ownership_verified_by: open.ownership_verified_by ?? input.actorParticipantId,
        blocked_reason: blockedReason,
        safe_state_summary: {
          credentialsIncluded: false,
          otpsIncluded: false,
          privateNotesIncluded: false,
          unlockedOwnedTeamIds,
          targetNotice: DELETION_TARGET_NOTICE,
        },
      });
    } else {
      blockedRequest = await accountDeletionRepository.create({
        participant_id: target.id,
        requested_by: input.actorParticipantId,
        reason: input.reason,
        ownership_verified: true,
        ownership_verified_at: now,
        ownership_verified_by: input.actorParticipantId,
        status: 'BlockedNeedsDisband',
        blocked_reason: blockedReason,
        safe_state_summary: {
          credentialsIncluded: false,
          otpsIncluded: false,
          privateNotesIncluded: false,
          unlockedOwnedTeamIds,
          targetNotice: DELETION_TARGET_NOTICE,
        },
      });
    }

    const actionRecord = await moderationRepository.insertActionRecord({
      actor_id: input.actorParticipantId,
      target_type: 'account',
      target_id: target.id,
      action_type: 'account_delete',
      reason: input.reason,
      outcome: 'deletion_blocked_needs_disband',
      safe_state_summary: {
        requestId: blockedRequest.id,
        unlockedOwnedTeamIds,
        targetCompletionAt: blockedRequest.target_completion_at,
        targetNotice: DELETION_TARGET_NOTICE,
        credentialsIncluded: false,
        otpsIncluded: false,
      },
    });

    const detail = await getAdminAccountDetail(target.id);

    // Surface as a structured 409 so the UI can keep the draft and show the block reason.
    throw new AccountManagementError(
      409,
      'UNLOCKED_OWNER_MUST_DISBAND',
      blockedReason,
      {
        outcome: 'deletion_blocked_needs_disband',
        request: toSafeDeletionRequestView(blockedRequest),
        account: detail.account,
        unlockedOwnedTeamIds,
        actionRecordId: actionRecord.id,
        livePiiErased: false,
        lockedMembershipsPseudonymized: false,
      }
    );
  }

  let requestRow: AccountDeletionRequest;
  if (open) {
    // Resume Pending / BlockedNeedsDisband / Processing after disband or partial failure.
    requestRow = await accountDeletionRepository.update(open.id, {
      status: open.status === 'Processing' ? 'Processing' : 'Pending',
      ownership_verified: true,
      ownership_verified_at: open.ownership_verified_at ?? now,
      ownership_verified_by: open.ownership_verified_by ?? input.actorParticipantId,
      blocked_reason: null,
      safe_state_summary: {
        credentialsIncluded: false,
        otpsIncluded: false,
        privateNotesIncluded: false,
        unlockedOwnedTeamIds: [],
        targetNotice: DELETION_TARGET_NOTICE,
      },
    });
  } else {
    requestRow = await accountDeletionRepository.create({
      participant_id: target.id,
      requested_by: input.actorParticipantId,
      reason: input.reason,
      ownership_verified: true,
      ownership_verified_at: now,
      ownership_verified_by: input.actorParticipantId,
      status: 'Pending',
      safe_state_summary: {
        credentialsIncluded: false,
        otpsIncluded: false,
        privateNotesIncluded: false,
        unlockedOwnedTeamIds: [],
        targetNotice: DELETION_TARGET_NOTICE,
      },
    });
  }

  // Prefer the original Firebase UID when the row was already tombstoned after a partial run.
  const firebaseUidForDelete = target.firebase_uid.startsWith('deleted:')
    ? ''
    : target.firebase_uid;

  return processLiveDeletion({
    request: requestRow,
    target: { id: target.id, firebase_uid: firebaseUidForDelete || target.firebase_uid },
    actorParticipantId: input.actorParticipantId,
    reason: input.reason,
    unlockedOwnedTeamIds: [],
  });
}
