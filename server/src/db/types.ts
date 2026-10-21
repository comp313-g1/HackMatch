export type ParticipantRole = 'PART' | 'ADMIN';

export interface Participant {
  id: string;
  firebase_uid: string;
  email: string;
  full_name: string;
  role: ParticipantRole;
  is_verified: boolean;
  /** Set by US-027 admin suspension; blocked at login/session renew by US-003. */
  is_suspended?: boolean;
  suspended_at?: string | null;
  suspended_by?: string | null;
  suspension_reason?: string | null;
  /** Soft deactivation (US-027 / #249); implies is_suspended. */
  is_deactivated?: boolean;
  deactivated_at?: string | null;
  deactivated_by?: string | null;
  deactivation_reason?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateParticipantDTO {
  firebase_uid: string;
  email: string;
  full_name: string;
  role?: ParticipantRole;
  is_verified?: boolean;
  is_suspended?: boolean;
}

export interface UpdateParticipantDTO {
  email?: string;
  full_name?: string;
  role?: ParticipantRole;
  is_verified?: boolean;
  is_suspended?: boolean;
  suspended_at?: string | null;
  suspended_by?: string | null;
  suspension_reason?: string | null;
  is_deactivated?: boolean;
  deactivated_at?: string | null;
  deactivated_by?: string | null;
  deactivation_reason?: string | null;
}

/** Ownership-verified deletion request lifecycle (US-027 / #249 / AC 3). */
export type AccountDeletionRequestStatus =
  | 'Pending'
  | 'BlockedNeedsDisband'
  | 'Processing'
  | 'Completed'
  | 'Canceled';

export interface AccountDeletionRequest {
  id: string;
  participant_id: string;
  requested_by: string;
  reason: string;
  status: AccountDeletionRequestStatus;
  ownership_verified: boolean;
  ownership_verified_at: string | null;
  ownership_verified_by: string | null;
  blocked_reason: string | null;
  target_completion_at: string;
  completed_at: string | null;
  safe_state_summary: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CreateAccountDeletionRequestDTO {
  participant_id: string;
  requested_by: string;
  reason: string;
  ownership_verified?: boolean;
  ownership_verified_at?: string | null;
  ownership_verified_by?: string | null;
  status?: AccountDeletionRequestStatus;
  blocked_reason?: string | null;
  safe_state_summary?: Record<string, unknown>;
}

export interface UpdateAccountDeletionRequestDTO {
  status?: AccountDeletionRequestStatus;
  ownership_verified?: boolean;
  ownership_verified_at?: string | null;
  ownership_verified_by?: string | null;
  blocked_reason?: string | null;
  completed_at?: string | null;
  safe_state_summary?: Record<string, unknown>;
}

export type OAuthProvider = 'google' | 'github' | 'google.com' | 'github.com';

export interface ProviderIdentity {
  id: string;
  participant_id: string;
  provider: OAuthProvider;
  provider_uid: string;
  email: string;
  provider_handle?: string | null;
  avatar_url?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateProviderIdentityDTO {
  participant_id: string;
  provider: OAuthProvider;
  provider_uid: string;
  email: string;
  provider_handle?: string | null;
  avatar_url?: string | null;
}

export interface MfaChallenge {
  id: string;
  participant_id: string;
  otp_hash: string;
  expires_at: string;
  consumed_at?: string | null;
  invalidated_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateMfaChallengeDTO {
  participant_id: string;
  otp_hash: string;
  expires_at: string;
}

export interface MfaAttempt {
  id: string;
  participant_id: string;
  challenge_id?: string | null;
  success: boolean;
  ip_address?: string | null;
  created_at: string;
}

export interface CreateMfaAttemptDTO {
  participant_id: string;
  challenge_id?: string | null;
  success: boolean;
  ip_address?: string | null;
}

export type ParticipantPrimaryRole = 'Frontend' | 'Backend' | 'Mobile' | 'AI/ML' | 'UI/UX' | 'Pitch';

export type ProfileModerationStatus = 'None' | 'Warned' | 'Hidden';

export interface ParticipantProfile {
  participant_id: string;
  handle: string | null;
  primary_role: ParticipantPrimaryRole | null;
  institution: string | null;
  shared_contact_handle: string | null;
  moderation_status?: ProfileModerationStatus;
  created_at: string;
  updated_at: string;
}

export interface CreateParticipantProfileDTO {
  participant_id: string;
  handle?: string | null;
  primary_role?: ParticipantPrimaryRole | null;
  institution?: string | null;
  shared_contact_handle?: string | null;
}

export interface UpdateParticipantProfileDTO {
  handle?: string | null;
  primary_role?: ParticipantPrimaryRole | null;
  institution?: string | null;
  shared_contact_handle?: string | null;
}

export interface ParticipantSkill {
  id: string;
  participant_id: string;
  skill_name: string;
  created_at: string;
}

export interface CreateParticipantSkillDTO {
  participant_id: string;
  skill_name: string;
}

export interface ParticipantPortfolio {
  id: string;
  participant_id: string;
  url: string;
  label: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateParticipantPortfolioDTO {
  participant_id: string;
  url: string;
  label?: string | null;
}

export type PendingEventSubmissionStatus = 'Pending' | 'Approved' | 'Rejected' | 'Merged';

export interface PendingEventSubmission {
  id: string;
  submitter_id: string;
  title: string;
  official_url: string;
  normalized_url: string;
  event_edition: string | null;
  start_date: string;
  end_date: string;
  format: string;
  location: string | null;
  min_team_size: number | null;
  max_team_size: number | null;
  status: PendingEventSubmissionStatus;
  admin_feedback: string | null;
  canonical_event_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreatePendingEventSubmissionDTO {
  submitter_id: string;
  title: string;
  official_url: string;
  normalized_url: string;
  event_edition?: string | null;
  start_date: string;
  end_date: string;
  format: string;
  location?: string | null;
  min_team_size?: number | null;
  max_team_size?: number | null;
}

export interface UpdatePendingEventSubmissionDTO {
  title?: string;
  official_url?: string;
  normalized_url?: string;
  event_edition?: string | null;
  start_date?: string;
  end_date?: string;
  format?: string;
  location?: string | null;
  min_team_size?: number | null;
  max_team_size?: number | null;
  status?: PendingEventSubmissionStatus;
  admin_feedback?: string | null;
  canonical_event_id?: string | null;
}

export interface EventActionRecord {
  id: string;
  actor_id: string;
  target_type: string;
  target_id: string;
  action_type: string;
  reason: string;
  outcome: string;
  safe_state_summary: Record<string, unknown>;
  created_at: string;
}

export interface CreateEventActionRecordDTO {
  actor_id: string;
  target_type: string;
  target_id: string;
  action_type: string;
  reason: string;
  outcome: string;
  safe_state_summary: Record<string, unknown>;
}

export type EventStatus = 'Published' | 'Archived' | 'Disabled';

export interface Event {
  id: string;
  title: string;
  official_url: string;
  normalized_url: string;
  event_edition: string | null;
  start_date: string;
  end_date: string;
  format: string;
  location: string | null;
  min_team_size: number | null;
  max_team_size: number | null;
  is_link_disabled: boolean;
  status: EventStatus;
  created_at: string;
  updated_at: string;
}

export interface CreateEventDTO {
  title: string;
  official_url: string;
  normalized_url: string;
  event_edition?: string | null;
  start_date: string;
  end_date: string;
  format: string;
  location?: string | null;
  min_team_size?: number | null;
  max_team_size?: number | null;
  is_link_disabled?: boolean;
  status?: EventStatus;
}

export interface UpdateEventDTO {
  title?: string;
  official_url?: string;
  normalized_url?: string;
  event_edition?: string | null;
  start_date?: string;
  end_date?: string;
  format?: string;
  location?: string | null;
  min_team_size?: number | null;
  max_team_size?: number | null;
  is_link_disabled?: boolean;
  status?: EventStatus;
}

export type TeamGoal = 'Learning' | 'Project Completion' | 'Competitive';
export type TeamRecruitmentStatus = 'Open' | 'Locked' | 'Disbanded';
export type TeamMembershipRole = 'Owner' | 'Member';
export type TeamMembershipStatus = 'Confirmed' | 'Removed' | 'Released';
export type TeamVacancyStatus = 'Open' | 'Filled' | 'Removed';
export type TeamRequestType = 'Invitation' | 'Application';
export type TeamRequestStatus =
  | 'Pending'
  | 'Accepted'
  | 'Declined'
  | 'Withdrawn'
  | 'Expired'
  | 'Canceled';

export type TeamModerationStatus = 'None' | 'Warned' | 'Hidden';

export interface Team {
  id: string;
  event_id: string;
  owner_participant_id: string;
  name: string;
  pitch: string;
  goal: TeamGoal;
  commitment_hours: number;
  communication_link: string | null;
  recruitment_status: TeamRecruitmentStatus;
  /** Server lock time when recruitment_status is Locked (US-022 / FR-066). */
  locked_at: string | null;
  disbanded_at: string | null;
  /** Set when ADMIN hides the listing from ordinary discovery (US-026 / FR-075). */
  moderation_hidden_at?: string | null;
  moderation_status?: TeamModerationStatus;
  /** Shown after a malicious communication link is disabled (FR-076). */
  link_removal_notice?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TeamMembership {
  id: string;
  team_id: string;
  event_id: string;
  participant_id: string;
  role: TeamMembershipRole;
  status: TeamMembershipStatus;
  removal_reason: string | null;
  joined_at: string;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TeamVacancy {
  id: string;
  team_id: string;
  role: ParticipantPrimaryRole;
  skills: string[];
  status: TeamVacancyStatus;
  removed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TeamRequest {
  id: string;
  team_id: string;
  event_id: string;
  vacancy_id: string | null;
  participant_id: string;
  request_type: TeamRequestType;
  status: TeamRequestStatus;
  cancel_reason: string | null;
  resolved_at: string | null;
  /** Set for Invitation rows (48h TTL). Null for Application rows. */
  expires_at: string | null;
  /** Optional applicant pitch for Application rows (max 250). Null for Invitation rows. */
  message: string | null;
  created_at: string;
  updated_at: string;
}

export interface ParticipantNotification {
  id: string;
  participant_id: string;
  team_id: string | null;
  event_id: string | null;
  type: string;
  message: string;
  created_at: string;
  read_at: string | null;
}

export interface EventAvailability {
  participant_id: string;
  event_id: string;
  is_looking: boolean;
  desired_role?: ParticipantPrimaryRole | null;
  commitment_hours?: number | string | null;
  goal?: TeamGoal | null;
  created_at: string;
  updated_at: string;
}

/** US-026 / FR-075 moderation queue target kinds. */
export type ModerationTargetType = 'team' | 'profile' | 'url';

export type ModerationCaseStatus = 'Open' | 'Dismissed' | 'Resolved';

export type ModerationDecisionAction =
  | 'dismiss'
  | 'redact'
  | 'warn'
  | 'hide'
  | 'disable_url';

export interface ModerationCase {
  id: string;
  target_type: ModerationTargetType;
  target_id: string;
  reason: string;
  status: ModerationCaseStatus;
  created_by: string;
  report_count: number;
  flagged_url: string | null;
  last_action_type?: ModerationDecisionAction | null;
  resolved_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateModerationCaseDTO {
  target_type: ModerationTargetType;
  target_id: string;
  reason: string;
  created_by: string;
  flagged_url?: string | null;
  report_count?: number;
}

