export type ParticipantRole = 'PART' | 'ADMIN';

export interface Participant {
  id: string;
  firebase_uid: string;
  email: string;
  full_name: string;
  role: ParticipantRole;
  is_verified: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateParticipantDTO {
  firebase_uid: string;
  email: string;
  full_name: string;
  role?: ParticipantRole;
  is_verified?: boolean;
}

export interface UpdateParticipantDTO {
  email?: string;
  full_name?: string;
  role?: ParticipantRole;
  is_verified?: boolean;
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

export interface ParticipantProfile {
  participant_id: string;
  handle: string | null;
  primary_role: ParticipantPrimaryRole | null;
  institution: string | null;
  shared_contact_handle: string | null;
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

