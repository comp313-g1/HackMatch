import type {
  AuthenticatorEnrollmentRepository,
  CreatePendingAuthenticatorInput,
  StoredAuthenticatorEnrollment,
} from '../db/authenticatorEnrollment.repository.js';
import type {
  ActivateReplacementInput,
  AuthenticatorRecoveryControlsRepository,
  ReplaceRecoveryCodesInput,
} from '../db/authenticatorRecoveryControls.repository.js';

/**
 * Shared US-029 test fixture (#270, reused by #271). Mirrors the ownership and
 * lifecycle rules of the 0063–0065 SQL functions so route tests can run the REAL
 * persistent providers without PostgreSQL. The SQL itself is covered by PGlite suites.
 */
export class MemoryAuthenticatorStore
  implements AuthenticatorEnrollmentRepository, AuthenticatorRecoveryControlsRepository
{
  enrollments = new Map<string, StoredAuthenticatorEnrollment>();
  codes: Array<{
    participantId: string;
    batchId: string;
    verifier: string;
    createdAt: string;
    usedAt: string | null;
    revokedAt: string | null;
  }> = [];
  failNext: Error | null = null;

  private maybeFail() {
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = null;
      throw error;
    }
  }
  private owned(participantId: string, status?: string) {
    return [...this.enrollments.values()].filter(
      (row) => row.participant_id === participantId && (!status || row.status === status)
    );
  }
  private insertPending(input: CreatePendingAuthenticatorInput) {
    const now = new Date().toISOString();
    this.enrollments.set(input.enrollmentId, {
      id: input.enrollmentId,
      participant_id: input.participantId,
      secret_ciphertext: input.protectedSecret.ciphertext,
      secret_iv: input.protectedSecret.iv,
      secret_auth_tag: input.protectedSecret.authTag,
      encryption_key_version: input.protectedSecret.keyVersion,
      status: 'Pending',
      pending_expires_at: input.expiresAt,
      activated_at: null,
      retired_at: null,
      created_at: now,
      updated_at: now,
    });
    return { enrollmentId: input.enrollmentId, status: 'Pending' as const, expiresAt: input.expiresAt };
  }
  private cancelPending(participantId: string) {
    for (const row of this.owned(participantId, 'Pending')) {
      row.status = 'Canceled';
      row.retired_at = new Date().toISOString();
    }
  }
  private currentBatch(participantId: string) {
    return this.codes.find((code) => code.participantId === participantId && !code.revokedAt)?.batchId ?? null;
  }
  private rotateCodes(participantId: string, batchId: string, verifiers: string[], at: string) {
    for (const code of this.codes) {
      if (code.participantId === participantId && !code.revokedAt) code.revokedAt = at;
    }
    for (const verifier of verifiers) {
      this.codes.push({ participantId, batchId, verifier, createdAt: at, usedAt: null, revokedAt: null });
    }
  }

  async createPending(input: CreatePendingAuthenticatorInput) {
    this.maybeFail();
    if (this.owned(input.participantId, 'Active').length) throw new Error('TOTP_AUTHENTICATOR_ALREADY_ACTIVE');
    if (this.owned(input.participantId, 'Pending').length) throw new Error('TOTP_ENROLLMENT_PENDING');
    return this.insertPending(input);
  }
  async restartPending(input: CreatePendingAuthenticatorInput) {
    if (this.owned(input.participantId, 'Active').length) throw new Error('TOTP_AUTHENTICATOR_ALREADY_ACTIVE');
    if (!this.owned(input.participantId, 'Pending').length) throw new Error('TOTP_ENROLLMENT_NOT_PENDING');
    this.cancelPending(input.participantId);
    return this.insertPending(input);
  }
  async findOwnedById(participantId: string, enrollmentId: string) {
    this.maybeFail();
    const row = this.enrollments.get(enrollmentId);
    return row && row.participant_id === participantId ? row : null;
  }
  async findActiveByParticipantId(participantId: string) {
    return this.owned(participantId, 'Active')[0] ?? null;
  }
  async findCurrentByParticipantId(participantId: string) {
    const row = this.owned(participantId, 'Active')[0] ?? this.owned(participantId, 'Pending')[0];
    if (!row) return null;
    return {
      status: row.status as 'Active' | 'Pending',
      pending_expires_at: row.pending_expires_at,
      activated_at: row.activated_at,
    };
  }
  async activatePending(participantId: string, enrollmentId: string) {
    const row = await this.findOwnedById(participantId, enrollmentId);
    if (!row || row.status !== 'Pending') throw new Error('TOTP_ENROLLMENT_NOT_PENDING');
    const now = new Date().toISOString();
    for (const active of this.owned(participantId, 'Active')) {
      active.status = 'Retired';
      active.retired_at = now;
    }
    Object.assign(row, { status: 'Active', pending_expires_at: null, activated_at: now });
    return { outcome: 'Activated' as const, enrollmentId, activatedAt: now };
  }
  async beginReplacement(input: CreatePendingAuthenticatorInput) {
    if (!this.owned(input.participantId, 'Active').length) throw new Error('TOTP_AUTHENTICATOR_NOT_ACTIVE');
    this.cancelPending(input.participantId);
    return this.insertPending(input);
  }
  async activateReplacement(input: ActivateReplacementInput) {
    const row = await this.findOwnedById(input.participantId, input.enrollmentId);
    if (!row) throw new Error('TOTP_ENROLLMENT_NOT_PENDING');
    if (row.status !== 'Pending') throw new Error('TOTP_ENROLLMENT_STALE');
    const now = new Date().toISOString();
    for (const active of this.owned(input.participantId, 'Active')) {
      active.status = 'Retired';
      active.retired_at = now;
    }
    Object.assign(row, { status: 'Active', pending_expires_at: null, activated_at: now });
    this.rotateCodes(input.participantId, input.batchId, input.verifiers, now);
    return {
      outcome: 'Activated' as const,
      activatedAt: now,
      recoveryBatchId: input.batchId,
      recoveryCodeCount: input.verifiers.length,
    };
  }
  async disableActive(participantId: string) {
    if (!this.owned(participantId, 'Active').length) throw new Error('TOTP_AUTHENTICATOR_NOT_ACTIVE');
    this.cancelPending(participantId);
    const now = new Date().toISOString();
    for (const active of this.owned(participantId, 'Active')) {
      active.status = 'Retired';
      active.retired_at = now;
    }
    let revoked = 0;
    for (const code of this.codes) {
      if (code.participantId === participantId && !code.revokedAt) {
        code.revokedAt = now;
        revoked += 1;
      }
    }
    return { disabledAt: now, revokedRecoveryCodes: revoked };
  }
  async replaceRecoveryCodes(input: ReplaceRecoveryCodesInput) {
    this.maybeFail();
    if (!this.owned(input.participantId, 'Active').length) throw new Error('TOTP_AUTHENTICATOR_NOT_ACTIVE');
    if (this.currentBatch(input.participantId) !== input.expectedBatchId) throw new Error('RECOVERY_CODES_STALE');
    const now = new Date().toISOString();
    this.rotateCodes(input.participantId, input.batchId, input.verifiers, now);
    return { batchId: input.batchId, codeCount: input.verifiers.length, generatedAt: now };
  }
  async findCurrentRecoveryCodeSummary(participantId: string) {
    const current = this.codes.filter((code) => code.participantId === participantId && !code.revokedAt);
    if (!current.length) return null;
    return {
      batchId: current[0]!.batchId,
      total: current.length,
      remaining: current.filter((code) => !code.usedAt).length,
      generatedAt: current[0]!.createdAt,
    };
  }
}
