/** Client shapes for US-027 / #248–#251 ADMIN account enforcement. */

export type AccountState = 'Active' | 'Suspended' | 'Deactivated';
export type AccountRole = 'PART' | 'ADMIN';

export type AccountsAccessState = 'loading' | 'granted' | 'denied' | 'error';
export type AccountsListState = 'loading' | 'success' | 'error';
export type AccountsDetailState = 'idle' | 'loading' | 'success' | 'error';

export interface AccountsFieldErrors {
  reason?: string;
  q?: string;
  state?: string;
  role?: string;
  _form?: string;
  [key: string]: string | undefined;
}

export interface AdminAccountListItem {
  accountId: string;
  email: string;
  fullName: string;
  role: AccountRole;
  state: AccountState;
  isVerified: boolean;
  suspendedAt: string | null;
  suspensionReason: string | null;
  deactivatedAt: string | null;
  deactivationReason: string | null;
  createdAt: string;
  handle: string | null;
  updatedAt?: string;
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
  primaryRole: string | null;
  institution: string | null;
  moderationStatus: string;
}

export interface AdminAccountDetail {
  account: AdminAccountListItem;
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

export interface SuspensionCascadeEffects {
  pendingIncomingRequestsCanceled: number;
  outgoingInvitationsCanceled: number;
  profileHidden: boolean;
  availabilityCleared: boolean;
  ownedTeamsPaused: number;
  membershipsPreserved: true;
}

export interface SuspendAccountResult {
  account: AdminAccountListItem;
  sessionsRevoked: boolean;
  firebaseSignInDisabled: boolean;
  alreadySuspended: boolean;
  outcome: 'account_suspended' | 'account_already_suspended';
  actionRecordId: string;
  effects: SuspensionCascadeEffects;
}

export interface AccountsListQuery {
  q?: string;
  state?: AccountState;
  role?: AccountRole;
  limit?: number;
}
