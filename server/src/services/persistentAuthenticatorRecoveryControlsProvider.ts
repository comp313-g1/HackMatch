import { randomUUID } from 'node:crypto';
import {
  authenticatorRecoveryControlsRepository,
  type AuthenticatorRecoveryControlsRepository,
} from '../db/authenticatorRecoveryControls.repository.js';
import {
  createTotpSecretProtectorFromEnvironment,
  type TotpSecretProtector,
} from '../security/totpSecretEncryption.js';
import {
  authenticatorEnrollmentRepository,
  type AuthenticatorEnrollmentRepository,
} from '../db/authenticatorEnrollment.repository.js';
import { buildTotpAuthUri, generateTotpSecret, verifyTotpCode } from '../security/totp.js';
import {
  RECOVERY_CODE_POLICY,
  createRecoveryCodeVerifierFromEnvironment,
  generateRecoveryCodeSet,
  type RecoveryCodeVerifier,
} from '../security/recoveryCodes.js';
import {
  AuthenticatorEnrollmentError,
  type AuthenticatorOwnerContext,
} from './authenticatorEnrollment.js';
import type { AuthenticatorRecoveryControlsProvider } from './authenticatorRecoveryControls.js';
import {
  AUTHENTICATOR_ACCOUNT_LABEL,
  AUTHENTICATOR_ENROLLMENT_TTL_MS,
  mapStorageError,
} from './persistentAuthenticatorEnrollmentProvider.js';

interface PersistentRecoveryControlsDependencies {
  repository?: AuthenticatorRecoveryControlsRepository;
  enrollmentRepository?: Pick<AuthenticatorEnrollmentRepository, 'findOwnedById'>;
  getProtector?: () => TotpSecretProtector;
  getVerifier?: () => RecoveryCodeVerifier;
  generateSecret?: () => string;
  generateCodes?: () => string[];
  generateId?: () => string;
  now?: () => Date;
}

function messageOf(error: unknown): string {
  if (!error || typeof error !== 'object' || !('message' in error)) return '';
  return String((error as { message: unknown }).message);
}

function mapControlsError(error: unknown): AuthenticatorEnrollmentError {
  const message = messageOf(error);
  if (message.includes('TOTP_AUTHENTICATOR_NOT_ACTIVE')) {
    return new AuthenticatorEnrollmentError('AUTHENTICATOR_NOT_ACTIVE', 409);
  }
  if (message.includes('RECOVERY_CODES_STALE')) {
    return new AuthenticatorEnrollmentError('RECOVERY_CODES_STALE', 409);
  }
  return mapStorageError(error);
}

/**
 * Durable #269 provider. Decrypted TOTP setup material and raw recovery codes
 * exist only inside a single call and are never attached to errors or logs.
 */
export function createPersistentAuthenticatorRecoveryControlsProvider(
  dependencies: PersistentRecoveryControlsDependencies = {}
): AuthenticatorRecoveryControlsProvider {
  const repository = dependencies.repository ?? authenticatorRecoveryControlsRepository;
  const enrollmentRepository =
    dependencies.enrollmentRepository ?? authenticatorEnrollmentRepository;
  const getProtector =
    dependencies.getProtector ?? (() => createTotpSecretProtectorFromEnvironment());
  const getVerifier =
    dependencies.getVerifier ?? (() => createRecoveryCodeVerifierFromEnvironment());
  const secretGenerator = dependencies.generateSecret ?? generateTotpSecret;
  const codeGenerator =
    dependencies.generateCodes ?? (() => generateRecoveryCodeSet(RECOVERY_CODE_POLICY.count));
  const idGenerator = dependencies.generateId ?? randomUUID;
  const now = dependencies.now ?? (() => new Date());

  return {
    async replace(owner: AuthenticatorOwnerContext) {
      let secret = '';
      try {
        const protector = getProtector();
        const enrollmentId = idGenerator();
        const expiresAt = new Date(now().getTime() + AUTHENTICATOR_ENROLLMENT_TTL_MS);
        secret = secretGenerator();
        const protectedSecret = protector.encrypt(secret, {
          participantId: owner.participantId,
          enrollmentId,
        });
        const pending = await repository.beginReplacement({
          enrollmentId,
          participantId: owner.participantId,
          protectedSecret,
          expiresAt: expiresAt.toISOString(),
        });
        return {
          enrollmentId: pending.enrollmentId,
          expiresAt: pending.expiresAt,
          otpauthUri: buildTotpAuthUri(secret, AUTHENTICATOR_ACCOUNT_LABEL),
          manualEntryKey: secret,
          accountLabel: AUTHENTICATOR_ACCOUNT_LABEL,
        };
      } catch (error: unknown) {
        throw mapControlsError(error);
      } finally {
        secret = '';
      }
    },

    async confirmReplacement(owner: AuthenticatorOwnerContext, enrollmentId: string, code: string) {
      let secret = '';
      let codes: string[] = [];
      try {
        const row = await enrollmentRepository.findOwnedById(owner.participantId, enrollmentId);
        if (!row) {
          throw new AuthenticatorEnrollmentError('AUTHENTICATOR_ENROLLMENT_NOT_PENDING', 409);
        }
        if (row.status === 'Active') {
          throw new AuthenticatorEnrollmentError('AUTHENTICATOR_ALREADY_ACTIVE', 409);
        }
        if (row.status !== 'Pending') {
          throw new AuthenticatorEnrollmentError('AUTHENTICATOR_ENROLLMENT_STALE', 409);
        }
        if (!row.pending_expires_at || Date.parse(row.pending_expires_at) <= now().getTime()) {
          throw new AuthenticatorEnrollmentError('AUTHENTICATOR_ENROLLMENT_EXPIRED', 410);
        }

        // The code is verified before any state changes; a wrong code leaves the
        // old factor and its recovery codes untouched.
        secret = getProtector().decrypt(
          {
            ciphertext: row.secret_ciphertext,
            iv: row.secret_iv,
            authTag: row.secret_auth_tag,
            keyVersion: row.encryption_key_version,
          },
          { participantId: owner.participantId, enrollmentId }
        );
        if (!verifyTotpCode(secret, code, now())) {
          throw new AuthenticatorEnrollmentError('INVALID_AUTHENTICATOR_CODE', 401);
        }

        const verifier = getVerifier();
        codes = codeGenerator();
        const verifiers = codes.map((value) => verifier.verifierFor(owner.participantId, value));
        const activated = await repository.activateReplacement({
          participantId: owner.participantId,
          enrollmentId,
          batchId: idGenerator(),
          verifiers,
          keyVersion: verifier.keyVersion,
        });
        if (
          activated.outcome === 'Expired' ||
          !activated.activatedAt ||
          !activated.recoveryBatchId
        ) {
          throw new AuthenticatorEnrollmentError('AUTHENTICATOR_ENROLLMENT_EXPIRED', 410);
        }
        if (activated.recoveryCodeCount !== codes.length) {
          throw new Error('RECOVERY_CODE_STORAGE_MISMATCH');
        }
        return {
          activatedAt: activated.activatedAt,
          recoveryCodes: {
            codes: [...codes],
            batchId: activated.recoveryBatchId,
            generatedAt: activated.activatedAt,
          },
        };
      } catch (error: unknown) {
        throw mapControlsError(error);
      } finally {
        secret = '';
        codes = [];
      }
    },

    async disable(owner: AuthenticatorOwnerContext) {
      try {
        const disabled = await repository.disableActive(owner.participantId);
        return { disabledAt: disabled.disabledAt };
      } catch (error: unknown) {
        throw mapControlsError(error);
      }
    },

    async getRecoveryCodeStatus(owner: AuthenticatorOwnerContext) {
      try {
        const summary = await repository.findCurrentRecoveryCodeSummary(owner.participantId);
        if (!summary) {
          return {
            status: 'not_generated' as const,
            batchId: null,
            total: 0,
            remaining: 0,
            generatedAt: null,
          };
        }
        return {
          status: 'generated' as const,
          batchId: summary.batchId,
          total: summary.total,
          remaining: summary.remaining,
          generatedAt: summary.generatedAt,
        };
      } catch (error: unknown) {
        throw mapControlsError(error);
      }
    },

    async generateRecoveryCodes(owner: AuthenticatorOwnerContext, expectedBatchId: string | null) {
      let codes: string[] = [];
      try {
        const verifier = getVerifier();
        codes = codeGenerator();
        const verifiers = codes.map((code) => verifier.verifierFor(owner.participantId, code));
        const stored = await repository.replaceRecoveryCodes({
          participantId: owner.participantId,
          batchId: idGenerator(),
          expectedBatchId,
          verifiers,
          keyVersion: verifier.keyVersion,
        });
        if (stored.codeCount !== codes.length) {
          throw new Error('RECOVERY_CODE_STORAGE_MISMATCH');
        }
        // Return a copy so the local reference can be dropped below.
        return { codes: [...codes], batchId: stored.batchId, generatedAt: stored.generatedAt };
      } catch (error: unknown) {
        const mapped = mapControlsError(error);
        throw mapped.code === 'AUTHENTICATOR_ENROLLMENT_UNAVAILABLE'
          ? new AuthenticatorEnrollmentError('RECOVERY_CODES_UNAVAILABLE', 503)
          : mapped;
      } finally {
        codes = [];
      }
    },
  };
}

export const persistentAuthenticatorRecoveryControlsProvider =
  createPersistentAuthenticatorRecoveryControlsProvider();
