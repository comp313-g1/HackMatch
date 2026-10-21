/** Client shapes for US-026 / #241 moderation queue and case view. */

export type ModerationTargetType = 'team' | 'profile' | 'url';
export type ModerationCaseStatus = 'Open' | 'Dismissed' | 'Resolved';
export type ModerationDecisionAction =
  | 'dismiss'
  | 'redact'
  | 'warn'
  | 'hide'
  | 'disable_url';

export interface ModerationCaseView {
  id: string;
  targetType: ModerationTargetType;
  targetId: string;
  reason: string;
  status: ModerationCaseStatus;
  reportCount: number;
  flaggedUrl: string | null;
  createdAt: string;
  createdBy: string;
  lastActionType?: string | null;
  resolvedAt?: string | null;
}

export interface SanitizedTeamTarget {
  type: 'team';
  team: {
    id: string;
    name: string;
    pitch: string;
    goal: string;
    commitmentHours: number;
    communicationLink: string | null;
    recruitmentStatus: string;
    eventId: string;
    ownerHandle: string | null;
    ownerDisplayName: string | null;
    moderationStatus?: string;
    linkRemovalNotice?: string | null;
  };
}

export interface SanitizedProfileTarget {
  type: 'profile';
  profile: {
    participantId: string;
    handle: string | null;
    primaryRole: string | null;
    institution: string | null;
    displayName: string | null;
    skills: string[];
    portfolios: Array<{ url: string; label: string | null }>;
  };
}

export interface SanitizedUrlTarget {
  type: 'url';
  url: {
    flaggedUrl: string;
    owningTargetType: 'team' | 'profile';
    owningTargetId: string;
    owner:
      | SanitizedTeamTarget['team']
      | SanitizedProfileTarget['profile']
      | null;
  };
}

export type SanitizedModerationTarget =
  | SanitizedTeamTarget
  | SanitizedProfileTarget
  | SanitizedUrlTarget;

/** Privacy boundary returned with case detail (US-026 / #245 / AC 4). */
export interface ModerationPrivacyFlags {
  credentialsIncluded: false;
  privateContactsIncluded: false;
  privateWorkspaceAccessGranted: false;
  notice: string;
}

export interface ModerationCaseDetail {
  case: ModerationCaseView;
  target: SanitizedModerationTarget;
  /** Present on current API responses; optional for older fixtures. */
  privacy?: ModerationPrivacyFlags;
}

export interface CreateModerationCaseInput {
  targetType: ModerationTargetType;
  targetId: string;
  reason: string;
  flaggedUrl?: string | null;
}

export interface ModerationFieldErrors {
  targetType?: string;
  targetId?: string;
  reason?: string;
  flaggedUrl?: string;
  action?: string;
  body?: string;
  _form?: string;
  [key: string]: string | undefined;
}

export interface DecideModerationCaseInput {
  action: ModerationDecisionAction;
  reason: string;
}

export interface DecideModerationCaseResult {
  case: ModerationCaseView;
  action: ModerationDecisionAction;
  outcome: string;
  safeStateSummary: Record<string, unknown>;
}

/** Safe FR-079 action record shown in the ADMIN UI (#243). */
export interface ModerationActionRecordView {
  id: string;
  actionType: string;
  reason: string;
  outcome: string;
  createdAt: string;
  targetType: string;
  targetId: string;
  safeStateSummary: Record<string, unknown>;
}

export type ModerationListState = 'loading' | 'success' | 'error';
export type ModerationDetailState = 'idle' | 'loading' | 'success' | 'error';
export type ModerationAccessState = 'loading' | 'granted' | 'denied' | 'error';
export type ModerationRecordsState = 'idle' | 'loading' | 'success' | 'error';
