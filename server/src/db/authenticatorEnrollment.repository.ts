import { getSupabaseClient } from './client.js';
import type { ProtectedTotpSecret } from '../security/totpSecretEncryption.js';

export type StoredAuthenticatorStatus =
  | 'Pending'
  | 'Active'
  | 'Retired'
  | 'Expired'
  | 'Canceled';

export interface StoredAuthenticatorEnrollment {
  id: string;
  participant_id: string;
  secret_ciphertext: string;
  secret_iv: string;
  secret_auth_tag: string;
  encryption_key_version: string;
  status: StoredAuthenticatorStatus;
  pending_expires_at: string | null;
  activated_at: string | null;
  retired_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreatePendingAuthenticatorInput {
  enrollmentId: string;
  participantId: string;
  protectedSecret: ProtectedTotpSecret;
  expiresAt: string;
}

export interface CreatedPendingAuthenticator {
  enrollmentId: string;
  status: 'Pending';
  expiresAt: string;
}

export interface ActivatedAuthenticator {
  outcome: 'Activated' | 'Expired';
  enrollmentId: string;
  activatedAt: string | null;
}

export interface AuthenticatorEnrollmentRepository {
  createPending(input: CreatePendingAuthenticatorInput): Promise<CreatedPendingAuthenticator>;
  findOwnedById(
    participantId: string,
    enrollmentId: string
  ): Promise<StoredAuthenticatorEnrollment | null>;
  findActiveByParticipantId(
    participantId: string
  ): Promise<StoredAuthenticatorEnrollment | null>;
  activatePending(participantId: string, enrollmentId: string): Promise<ActivatedAuthenticator>;
}

export const authenticatorEnrollmentRepository: AuthenticatorEnrollmentRepository = {
  async createPending(input) {
    const client = getSupabaseClient();
    const { data, error } = await client.rpc('begin_authenticator_enrollment', {
      p_participant: input.participantId,
      p_enrollment: input.enrollmentId,
      p_secret_ciphertext: input.protectedSecret.ciphertext,
      p_secret_iv: input.protectedSecret.iv,
      p_secret_auth_tag: input.protectedSecret.authTag,
      p_key_version: input.protectedSecret.keyVersion,
      p_expires_at: input.expiresAt,
    });
    if (error) throw error;
    const row = (data as Array<Record<string, unknown>> | null)?.[0];
    if (!row) throw new Error('TOTP_STORAGE_EMPTY_RESULT');
    return {
      enrollmentId: String(row.enrollment_id),
      status: 'Pending',
      expiresAt: String(row.expires_at),
    };
  },

  async findOwnedById(participantId, enrollmentId) {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('authenticator_enrollments')
      .select(
        'id, participant_id, secret_ciphertext, secret_iv, secret_auth_tag, encryption_key_version, status, pending_expires_at, activated_at, retired_at, created_at, updated_at'
      )
      .eq('id', enrollmentId)
      .eq('participant_id', participantId)
      .maybeSingle();
    if (error) throw error;
    return data as StoredAuthenticatorEnrollment | null;
  },

  async findActiveByParticipantId(participantId) {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('authenticator_enrollments')
      .select(
        'id, participant_id, secret_ciphertext, secret_iv, secret_auth_tag, encryption_key_version, status, pending_expires_at, activated_at, retired_at, created_at, updated_at'
      )
      .eq('participant_id', participantId)
      .eq('status', 'Active')
      .maybeSingle();
    if (error) throw error;
    return data as StoredAuthenticatorEnrollment | null;
  },

  async activatePending(participantId, enrollmentId) {
    const client = getSupabaseClient();
    const { data, error } = await client.rpc('activate_authenticator_enrollment', {
      p_participant: participantId,
      p_enrollment: enrollmentId,
    });
    if (error) throw error;
    const row = (data as Array<Record<string, unknown>> | null)?.[0];
    if (!row) throw new Error('TOTP_STORAGE_EMPTY_RESULT');
    return {
      outcome: String(row.outcome) as ActivatedAuthenticator['outcome'],
      enrollmentId: String(row.enrollment_id),
      activatedAt: row.activation_time == null ? null : String(row.activation_time),
    };
  },
};
