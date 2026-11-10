import type { ChatChannelType } from './chatModel.js';
import type { NotificationCategory } from './notificationModel.js';

export type ParticipantRole = 'PART' | 'ADMIN';

/** US-030 / #343 / FR-086 chat presence statuses. */
export type PresenceStatus = 'Online' | 'Idle' | 'Do Not Disturb' | 'Invisible';

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
  /** US-030 / #343 / FR-086 — default Invisible until the participant sets a status. */
  presence_status?: PresenceStatus;
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
  presence_status?: PresenceStatus;
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

export type ExperienceBadge = 'Beginner' | 'Competitor' | 'Veteran';

export interface ParticipantHackathonHistory {
  id: string;
  participant_id: string;
  event_name: string;
  event_date: string; // ISO YYYY-MM-DD
  team_role: ParticipantPrimaryRole;
  project_title: string;
  project_url: string;
  created_at: string;
  updated_at: string;
}

export interface CreateHackathonHistoryDTO {
  event_name: string;
  event_date: string;
  team_role: ParticipantPrimaryRole;
  project_title: string;
  project_url: string;
}

export type UpdateHackathonHistoryDTO = CreateHackathonHistoryDTO;

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
  /** US-027 / #253 — roster label; becomes a non-identifying pseudonym after deletion. */
  identity_display_name?: string | null;
  identity_handle?: string | null;
  identity_email?: string | null;
  identity_pseudonymized_at?: string | null;
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
  /** Deep-link target for invitation/application alerts (US-021). */
  request_id: string | null;
  /** Deep-link target for event verification alerts (US-021). */
  submission_id: string | null;
  type: string;
  /** Derived from `type` by the database (US-021). */
  category: NotificationCategory;
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

/** US-025 / US-026 / FR-073 / FR-075 moderation queue and report target kinds. */
export type ModerationTargetType = 'team' | 'profile' | 'event' | 'url';

export type ModerationReportTargetType = 'team' | 'profile' | 'event' | 'url';

export type ModerationReportCategory =
  | 'Harassment'
  | 'Spam'
  | 'Phishing Link'
  | 'Fake Account';

export interface ModerationReportRecord {
  id: string;
  reporter_id: string;
  target_type: ModerationReportTargetType;
  target_id: string;
  category: ModerationReportCategory;
  explanation: string | null;
  flagged_url: string | null;
  case_id: string | null;
  created_at: string;
}

export interface CreateModerationReportDTO {
  reporter_id: string;
  target_type: ModerationReportTargetType;
  target_id: string;
  category: ModerationReportCategory;
  explanation?: string | null;
  flagged_url?: string | null;
  case_id?: string | null;
}

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

/** US-030 / #342 chat forum/channel (FR-087); US-031 / #378 adds the private team channel linkage. */
export interface ChatChannel {
  id: string;
  title: string;
  description: string;
  created_by: string;
  /** 'public' for US-030 forums; 'team' for a private channel tied to one team. */
  channel_type: ChatChannelType;
  /** The linked team for a private channel; null for public channels. */
  team_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateChatChannelDTO {
  title: string;
  description: string;
  created_by: string;
  channel_type?: ChatChannelType;
  team_id?: string | null;
}

/** US-031 / #378 / T2 idempotent team channel provisioning DTO. */
export interface ProvisionTeamChannelDTO {
  team_id: string;
  title: string;
  description: string;
  created_by: string;
}

/** US-030 / #342 chat text message (FR-088). */
export interface ChatMessage {
  id: string;
  channel_id: string;
  author_id: string;
  body: string;
  created_at: string;
}

export interface CreateChatMessageDTO {
  channel_id: string;
  author_id: string;
  body: string;
}

/** US-023 / #US-023-T1 locked team workspace models (FR-068, FR-069, FR-070). */
export interface TeamWorkspaceRecord {
  team_id: string;
  created_at: string;
  updated_at: string;
}

export interface TeamWorkspaceLink {
  id: string;
  team_id: string;
  label: string;
  url: string;
  display_order: number;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpsertWorkspaceLinkInput {
  label: string;
  url: string;
  display_order?: number;
}

export interface TeamWorkspaceNote {
  team_id: string;
  content: string;
  version: number;
  updated_by: string | null;
  author_display_name: string | null;
  author_pseudonymized_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TeamWorkspaceNoteRevision {
  id: string;
  team_id: string;
  version: number;
  content: string;
  author_id: string | null;
  author_display_name: string;
  author_pseudonymized_at: string | null;
  created_at: string;
}

export interface SaveWorkspaceNoteInput {
  teamId: string;
  actorId: string;
  content: string;
  expectedVersion: number;
  authorDisplayName: string;
}

/** US-024 / #223 / FR-071 & FR-072 locked team manifest exports and snapshots. */
export type ManifestExportFormat = 'json' | 'html' | 'pdf';

export interface CanonicalRosterPortfolioLink {
  label: string | null;
  url: string;
}

export interface CanonicalRosterMember {
  participantId: string;
  displayName: string;
  handle: string | null;
  teamRole: TeamMembershipRole;
  primaryRole: ParticipantPrimaryRole | null;
  institution: string | null;
  portfolioLinks: CanonicalRosterPortfolioLink[];
  joinedAt: string;
  isPseudonymized: boolean;
}

export interface CanonicalRosterSnapshot {
  schemaVersion: '1.0';
  teamId: string;
  teamName: string;
  eventId: string;
  eventTitle: string;
  lockedAt: string;
  memberCount: number;
  members: CanonicalRosterMember[];
}

export interface TeamRosterManifestRecord {
  team_id: string;
  event_id: string;
  schema_version: string;
  locked_at: string;
  member_count: number;
  snapshot_json: CanonicalRosterSnapshot;
  canonical_json: string;
  checksum: string;
  last_exported_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TeamRosterManifestSnapshotRow {
  id: string;
  team_id: string;
  schema_version: string;
  locked_at: string;
  member_count: number;
  snapshot_json: CanonicalRosterSnapshot;
  canonical_json: string;
  checksum: string;
  recorded_by: string | null;
  created_at: string;
}

export interface SaveManifestSnapshotInput {
  teamId: string;
  eventId: string;
  lockedAt: string;
  memberCount: number;
  snapshotJson: CanonicalRosterSnapshot;
  canonicalJson: string;
  checksum: string;
  actorId?: string | null;
}


