/** Client shapes for US-026 / #241 moderation queue and case view. */

export type ModerationTargetType = 'team' | 'profile' | 'url';
export type ModerationCaseStatus = 'Open' | 'Dismissed' | 'Resolved';

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

export interface ModerationCaseDetail {
  case: ModerationCaseView;
  target: SanitizedModerationTarget;
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
  body?: string;
  _form?: string;
  [key: string]: string | undefined;
}

export type ModerationListState = 'loading' | 'success' | 'error';
export type ModerationDetailState = 'idle' | 'loading' | 'success' | 'error';
export type ModerationAccessState = 'loading' | 'granted' | 'denied' | 'error';
