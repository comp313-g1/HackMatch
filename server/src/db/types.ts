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

