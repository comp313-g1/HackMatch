import { accountsRepository } from '../db/accounts.repository.js';
import { profileRepository } from '../db/profile.repository.js';
import type { Participant, ParticipantPrimaryRole, ParticipantRole } from '../db/types.js';
import type { AccountsListQuerySanitized } from '../validators/accounts.validator.js';

export type AccountManagementErrorCode =
  | 'ACCOUNT_NOT_FOUND'
  | 'FORBIDDEN_ROLE'
  | 'INVALID_TARGET'
  | 'SELF_SUSPEND_FORBIDDEN'
  | 'FIREBASE_REVOKE_FAILED';

export class AccountManagementError extends Error {
  readonly status: number;
  readonly code: AccountManagementErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    status: number,
    code: AccountManagementErrorCode,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AccountManagementError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export type AccountState = 'Active' | 'Suspended' | 'Deactivated';

/** List card — account identifier, role, state; no credentials / OTPs (US-027 AC 1). */
export interface AdminAccountListItem {
  accountId: string;
  email: string;
  fullName: string;
  role: ParticipantRole;
  state: AccountState;
  isVerified: boolean;
  suspendedAt: string | null;
  suspensionReason: string | null;
  deactivatedAt: string | null;
  deactivationReason: string | null;
  createdAt: string;
  handle: string | null;
}

export interface AdminAccountListingSummary {
  teamId: string;
  teamName: string;
  recruitmentStatus: string;
  lockedAt: string | null;
  membershipRole: 'Owner' | 'Member';
  isOwner: boolean;
}

export interface AdminAccountProfileSummary {
  handle: string | null;
  primaryRole: ParticipantPrimaryRole | null;
  institution: string | null;
  moderationStatus: string;
}

export interface AdminAccountDetail {
  account: AdminAccountListItem & {
    updatedAt: string;
  };
  profile: AdminAccountProfileSummary | null;
  relevantListings: AdminAccountListingSummary[];
  privacy: {
    credentialsIncluded: false;
    otpsIncluded: false;
    privateTeamNotesIncluded: false;
    privateContactsIncluded: false;
    notice: string;
  };
}

export const ACCOUNT_PRIVACY_NOTICE =
  'Credentials, OTPs, private contact handles, and private team notes are not available through account-management endpoints.';

function toAccountState(participant: Participant): AccountState {
  if (participant.is_deactivated) return 'Deactivated';
  if (participant.is_suspended) return 'Suspended';
  return 'Active';
}

/**
 * Projects a participant row for ADMIN list/detail.
 * Explicitly omits firebase_uid and any auth/OTP fields (US-027 / #248 / AC 1).
 */
export function toSafeAdminAccountView(
  participant: Participant,
  options?: { handle?: string | null }
): AdminAccountListItem {
  return {
    accountId: participant.id,
    email: participant.email,
    fullName: participant.full_name,
    role: participant.role,
    state: toAccountState(participant),
    isVerified: participant.is_verified,
    suspendedAt: participant.suspended_at ?? null,
    suspensionReason: participant.suspension_reason ?? null,
    deactivatedAt: participant.deactivated_at ?? null,
    deactivationReason: participant.deactivation_reason ?? null,
    createdAt: participant.created_at,
    handle: options?.handle ?? null,
  };
}

export async function listAdminAccounts(
  query: AccountsListQuerySanitized
): Promise<AdminAccountListItem[]> {
  const rows = await accountsRepository.listForAdmin({
    role: query.role,
    isSuspended:
      query.state === 'Suspended' || query.state === 'Deactivated'
        ? true
        : query.state === 'Active'
          ? false
          : undefined,
    isDeactivated:
      query.state === 'Deactivated'
        ? true
        : query.state === 'Active' || query.state === 'Suspended'
          ? false
          : undefined,
    q: query.q,
    limit: query.limit,
  });

  const items: AdminAccountListItem[] = [];
  for (const row of rows) {
    const profile = await profileRepository.findProfileByParticipantId(row.id);
    items.push(
      toSafeAdminAccountView(row, {
        handle: profile?.handle ?? null,
      })
    );
  }
  return items;
}

export async function getAdminAccountDetail(accountId: string): Promise<AdminAccountDetail> {
  const participant = await accountsRepository.findById(accountId);
  if (!participant) {
    throw new AccountManagementError(404, 'ACCOUNT_NOT_FOUND', 'Account not found.', {
      accountId,
    });
  }

  const profile = await profileRepository.findProfileByParticipantId(accountId);
  const listingRows = await accountsRepository.listRelevantListings(accountId);
  const base = toSafeAdminAccountView(participant, {
    handle: profile?.handle ?? null,
  });

  return {
    account: {
      ...base,
      updatedAt: participant.updated_at,
    },
    profile: profile
      ? {
          handle: profile.handle,
          primaryRole: profile.primary_role,
          institution: profile.institution,
          // Never include shared_contact_handle (private contact).
          moderationStatus: profile.moderation_status ?? 'None',
        }
      : null,
    relevantListings: listingRows.map((row) => ({
      teamId: row.team_id,
      teamName: row.team_name,
      recruitmentStatus: row.recruitment_status,
      lockedAt: row.locked_at,
      membershipRole: row.membership_role,
      isOwner: row.is_owner,
    })),
    privacy: {
      credentialsIncluded: false,
      otpsIncluded: false,
      privateTeamNotesIncluded: false,
      privateContactsIncluded: false,
      notice: ACCOUNT_PRIVACY_NOTICE,
    },
  };
}
