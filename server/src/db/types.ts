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
