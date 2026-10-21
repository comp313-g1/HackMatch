import { firebaseAuth } from '../config/firebase.js';
import { moderationRepository } from '../db/moderation.repository.js';
import { participantsRepository } from '../db/participants.repository.js';
import {
  AccountManagementError,
  getAdminAccountDetail,
  toSafeAdminAccountView,
  type AdminAccountDetail,
} from './accountManagement.js';

export interface SuspendAccountInput {
  actorParticipantId: string;
  actorRole: 'PART' | 'ADMIN';
  accountId: string;
  reason: string;
}

export interface SuspendAccountResult {
  account: AdminAccountDetail['account'];
  sessionsRevoked: boolean;
  firebaseSignInDisabled: boolean;
  alreadySuspended: boolean;
  outcome: 'account_suspended' | 'account_already_suspended';
  actionRecordId: string;
}

/**
 * ADMIN suspends an account (US-027 / #250 / AC 2):
 * 1. Persist suspension flags + reason in PostgreSQL (blocks renew via requireActiveAccount).
 * 2. Revoke Firebase refresh tokens (invalidate current sessions).
 * 3. Disable the Firebase user (blocks fresh sign-in at the IdP).
 * 4. Write a safe FR-079 action record (no credentials / OTPs).
 */
export async function suspendAccount(input: SuspendAccountInput): Promise<SuspendAccountResult> {
  if (input.actorRole !== 'ADMIN') {
    throw new AccountManagementError(
      403,
      'FORBIDDEN_ROLE',
      'You do not have permission to access this resource.'
    );
  }

  if (input.actorParticipantId === input.accountId) {
    throw new AccountManagementError(
      400,
      'SELF_SUSPEND_FORBIDDEN',
      'Administrators cannot suspend their own account.',
      { accountId: input.accountId }
    );
  }

  // Use participants repository so firebase_uid is available for token revocation.
  const target = await participantsRepository.findById(input.accountId);
  if (!target) {
    throw new AccountManagementError(404, 'ACCOUNT_NOT_FOUND', 'Account not found.', {
      accountId: input.accountId,
    });
  }

  const alreadySuspended = Boolean(target.is_suspended);
  const suspendedAt = alreadySuspended
    ? (target.suspended_at ?? new Date().toISOString())
    : new Date().toISOString();

  const updated = await participantsRepository.updateParticipant(target.id, {
    is_suspended: true,
    suspended_at: suspendedAt,
    suspended_by: input.actorParticipantId,
    suspension_reason: input.reason,
  });

  let sessionsRevoked = false;
  let firebaseSignInDisabled = false;

  try {
    if (updated.firebase_uid) {
      await firebaseAuth.revokeRefreshTokens(updated.firebase_uid);
      sessionsRevoked = true;
      await firebaseAuth.updateUser(updated.firebase_uid, { disabled: true });
      firebaseSignInDisabled = true;
    }
  } catch (err: unknown) {
    throw new AccountManagementError(
      502,
      'FIREBASE_REVOKE_FAILED',
      'Account was marked suspended, but Firebase session revocation failed. Retry suspension.',
      {
        accountId: updated.id,
        firebaseError: err instanceof Error ? err.message : 'unknown',
        sessionsRevoked,
        firebaseSignInDisabled,
      }
    );
  }

  const outcome = alreadySuspended ? 'account_already_suspended' : 'account_suspended';
  const safeStateSummary = {
    accountId: updated.id,
    state: 'Suspended',
    sessionsRevoked,
    firebaseSignInDisabled,
    alreadySuspended,
    credentialsIncluded: false,
    otpsIncluded: false,
    privateContactsIncluded: false,
  };

  const actionRecord = await moderationRepository.insertActionRecord({
    actor_id: input.actorParticipantId,
    target_type: 'account',
    target_id: updated.id,
    action_type: 'account_suspend',
    reason: input.reason,
    outcome,
    safe_state_summary: safeStateSummary,
  });

  // Re-fetch projected account card (handle + safe fields only).
  const detail = await getAdminAccountDetail(updated.id);

  return {
    account: detail.account,
    sessionsRevoked,
    firebaseSignInDisabled,
    alreadySuspended,
    outcome,
    actionRecordId: actionRecord.id,
  };
}

/** Pure helper for unit tests — maps a suspended participant without Firebase I/O. */
export function projectSuspendedAccountView(
  participant: Parameters<typeof toSafeAdminAccountView>[0]
) {
  return toSafeAdminAccountView(participant);
}
