import { getSupabaseClient } from './client.js';
import type {
  CreatePendingAuthenticatorInput,
  CreatedPendingAuthenticator,
} from './authenticatorEnrollment.repository.js';

/**
 * US-029 / #269 data operations. Every call is owner-scoped by participant id
 * resolved from the authenticated session; none selects TOTP ciphertext or
 * recovery-code verifier columns back out of PostgreSQL.
 */

export interface DisabledAuthenticator {
  disabledAt: string;
  revokedRecoveryCodes: number;
}

export interface ReplaceRecoveryCodesInput {
  participantId: string;
  batchId: string;
  /** Caller's view of the current batch; null when it expects no current set. */
  expectedBatchId: string | null;
  verifiers: string[];
  keyVersion: string;
}

export interface ReplacedRecoveryCodes {
  batchId: string;
  codeCount: number;
  generatedAt: string;
}

/** Status-only projection of the current recovery set; never includes verifiers. */
export interface RecoveryCodeSummary {
  batchId: string;
  total: number;
  remaining: number;
  generatedAt: string;
}

export interface ActivateReplacementInput {
  participantId: string;
  enrollmentId: string;
  batchId: string;
  verifiers: string[];
  keyVersion: string;
}

export interface ActivatedReplacement {
  outcome: 'Activated' | 'Expired';
  activatedAt: string | null;
  recoveryBatchId: string | null;
  recoveryCodeCount: number;
}

export interface AuthenticatorRecoveryControlsRepository {
  beginReplacement(input: CreatePendingAuthenticatorInput): Promise<CreatedPendingAuthenticator>;
  /** Retires the old factor, activates the new one, and rotates recovery codes atomically. */
  activateReplacement(input: ActivateReplacementInput): Promise<ActivatedReplacement>;
  disableActive(participantId: string): Promise<DisabledAuthenticator>;
  replaceRecoveryCodes(input: ReplaceRecoveryCodesInput): Promise<ReplacedRecoveryCodes>;
  findCurrentRecoveryCodeSummary(participantId: string): Promise<RecoveryCodeSummary | null>;
}

function firstRow(data: unknown): Record<string, unknown> {
  const row = (data as Array<Record<string, unknown>> | null)?.[0];
  if (!row) throw new Error('TOTP_STORAGE_EMPTY_RESULT');
  return row;
}

export const authenticatorRecoveryControlsRepository: AuthenticatorRecoveryControlsRepository = {
  async beginReplacement(input) {
    const client = getSupabaseClient();
    const { data, error } = await client.rpc('begin_authenticator_replacement', {
      p_participant: input.participantId,
      p_enrollment: input.enrollmentId,
      p_secret_ciphertext: input.protectedSecret.ciphertext,
      p_secret_iv: input.protectedSecret.iv,
      p_secret_auth_tag: input.protectedSecret.authTag,
      p_key_version: input.protectedSecret.keyVersion,
      p_expires_at: input.expiresAt,
    });
    if (error) throw error;
    const row = firstRow(data);
    return {
      enrollmentId: String(row.enrollment_id),
      status: 'Pending',
      expiresAt: String(row.expires_at),
    };
  },

  async activateReplacement(input) {
    const client = getSupabaseClient();
    const { data, error } = await client.rpc('activate_authenticator_replacement', {
      p_participant: input.participantId,
      p_enrollment: input.enrollmentId,
      p_batch: input.batchId,
      p_verifiers: input.verifiers,
      p_key_version: input.keyVersion,
    });
    if (error) throw error;
    const row = firstRow(data);
    return {
      outcome: String(row.outcome) as ActivatedReplacement['outcome'],
      activatedAt: row.activation_time == null ? null : String(row.activation_time),
      recoveryBatchId: row.recovery_batch_id == null ? null : String(row.recovery_batch_id),
      recoveryCodeCount: Number(row.recovery_code_count ?? 0),
    };
  },

  async disableActive(participantId) {
    const client = getSupabaseClient();
    const { data, error } = await client.rpc('disable_authenticator', {
      p_participant: participantId,
    });
    if (error) throw error;
    const row = firstRow(data);
    return {
      disabledAt: String(row.disabled_at),
      revokedRecoveryCodes: Number(row.revoked_recovery_codes ?? 0),
    };
  },

  async replaceRecoveryCodes(input) {
    const client = getSupabaseClient();
    const { data, error } = await client.rpc('replace_authenticator_recovery_codes', {
      p_participant: input.participantId,
      p_batch: input.batchId,
      p_expected_batch: input.expectedBatchId,
      p_verifiers: input.verifiers,
      p_key_version: input.keyVersion,
    });
    if (error) throw error;
    const row = firstRow(data);
    return {
      batchId: String(row.batch_id),
      codeCount: Number(row.code_count),
      generatedAt: String(row.generated_at),
    };
  },

  async findCurrentRecoveryCodeSummary(participantId) {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('authenticator_recovery_codes')
      // Deliberately excludes code_verifier and verifier_key_version.
      .select('batch_id, created_at, used_at')
      .eq('participant_id', participantId)
      .is('revoked_at', null)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    const rows = (data ?? []) as Array<{
      batch_id: string;
      created_at: string;
      used_at: string | null;
    }>;
    if (rows.length === 0) return null;
    // The RPCs keep exactly one non-revoked batch; filter defensively anyway.
    const current = rows.filter((row) => row.batch_id === rows[0]!.batch_id);
    return {
      batchId: String(current[0]!.batch_id),
      total: current.length,
      remaining: current.filter((row) => row.used_at === null).length,
      generatedAt: String(current[0]!.created_at),
    };
  },
};
