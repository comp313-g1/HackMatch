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

