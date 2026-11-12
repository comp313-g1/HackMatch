import { randomUUID } from 'node:crypto';
import {
  authenticatorEnrollmentRepository,
  type AuthenticatorEnrollmentRepository,
  type StoredAuthenticatorEnrollment,
} from '../db/authenticatorEnrollment.repository.js';
import {
  createTotpSecretProtectorFromEnvironment,
  TotpEncryptionConfigurationError,
  TotpSecretIntegrityError,
  type TotpSecretProtector,
} from '../security/totpSecretEncryption.js';
import {
  buildTotpAuthUri,
  generateTotpSecret,
  verifyTotpCode,
} from '../security/totp.js';
import {
  AuthenticatorEnrollmentError,
  type AuthenticatorEnrollmentProvider,
  type AuthenticatorOwnerContext,
} from './authenticatorEnrollment.js';

export const AUTHENTICATOR_ENROLLMENT_TTL_MS = 10 * 60 * 1000;
export const AUTHENTICATOR_ACCOUNT_LABEL = 'HackMatch account';

interface PersistentProviderDependencies {
  repository?: AuthenticatorEnrollmentRepository;
  getProtector?: () => TotpSecretProtector;
  generateSecret?: () => string;
  generateEnrollmentId?: () => string;
  now?: () => Date;
}

function messageOf(error: unknown): string {
  if (!error || typeof error !== 'object' || !('message' in error)) return '';
  return String((error as { message: unknown }).message);
}

export function mapStorageError(error: unknown): AuthenticatorEnrollmentError {
  if (error instanceof AuthenticatorEnrollmentError) return error;
  if (error instanceof TotpEncryptionConfigurationError) {
    return new AuthenticatorEnrollmentError('AUTHENTICATOR_CONFIGURATION_ERROR', 503);
  }
  if (error instanceof TotpSecretIntegrityError) {
    return new AuthenticatorEnrollmentError('AUTHENTICATOR_ENROLLMENT_UNAVAILABLE', 503);
  }

  const message = messageOf(error);
  if (message.includes('TOTP_AUTHENTICATOR_ALREADY_ACTIVE')) {
    return new AuthenticatorEnrollmentError('AUTHENTICATOR_ALREADY_ACTIVE', 409);
  }
  if (message.includes('TOTP_ENROLLMENT_PENDING')) {
    return new AuthenticatorEnrollmentError('AUTHENTICATOR_ENROLLMENT_PENDING', 409);
  }
  if (message.includes('TOTP_ENROLLMENT_NOT_PENDING')) {
    return new AuthenticatorEnrollmentError('AUTHENTICATOR_ENROLLMENT_NOT_PENDING', 409);
  }
  if (message.includes('TOTP_ENROLLMENT_STALE')) {
    return new AuthenticatorEnrollmentError('AUTHENTICATOR_ENROLLMENT_STALE', 409);
  }
  return new AuthenticatorEnrollmentError('AUTHENTICATOR_ENROLLMENT_UNAVAILABLE', 503);
}

function protectedSecretOf(row: StoredAuthenticatorEnrollment) {
  return {
    ciphertext: row.secret_ciphertext,
    iv: row.secret_iv,
    authTag: row.secret_auth_tag,
    keyVersion: row.encryption_key_version,
  };
}

/**
 * Durable #267 provider. Repository calls are owner-scoped; decrypted material
 * exists only inside begin/confirm and is never attached to errors or DTOs.
 */
export function createPersistentAuthenticatorEnrollmentProvider(
  dependencies: PersistentProviderDependencies = {}
): AuthenticatorEnrollmentProvider {
  const repository = dependencies.repository ?? authenticatorEnrollmentRepository;
  const getProtector =
    dependencies.getProtector ?? (() => createTotpSecretProtectorFromEnvironment());
  const secretGenerator = dependencies.generateSecret ?? generateTotpSecret;
  const enrollmentIdGenerator = dependencies.generateEnrollmentId ?? randomUUID;
  const now = dependencies.now ?? (() => new Date());

  async function createSetup(
    owner: AuthenticatorOwnerContext,
    persist: AuthenticatorEnrollmentRepository['createPending']
  ) {
    let secret = '';
    try {
      const protector = getProtector();
      const enrollmentId = enrollmentIdGenerator();
      const createdAt = now();
      const expiresAt = new Date(createdAt.getTime() + AUTHENTICATOR_ENROLLMENT_TTL_MS);
      secret = secretGenerator();
      const protectedSecret = protector.encrypt(secret, {
        participantId: owner.participantId,
        enrollmentId,
      });
      const pending = await persist.call(repository, {
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
      throw mapStorageError(error);
    } finally {
      secret = '';
    }
  }

  return {
    async getStatus(owner: AuthenticatorOwnerContext) {
      try {
        const row = await repository.findCurrentByParticipantId(owner.participantId);
        if (!row) return { status: 'not_enrolled' as const };
        if (row.status === 'Active' && row.activated_at) {
          return { status: 'active' as const, activatedAt: row.activated_at };
        }
        if (
          row.status === 'Pending' &&
          row.pending_expires_at &&
          Date.parse(row.pending_expires_at) > now().getTime()
        ) {
          return { status: 'pending' as const, expiresAt: row.pending_expires_at };
        }
        return { status: 'not_enrolled' as const };
      } catch (error: unknown) {
        throw mapStorageError(error);
      }
    },

    async begin(owner: AuthenticatorOwnerContext) {
      return createSetup(owner, repository.createPending);
    },

    async restart(owner: AuthenticatorOwnerContext) {
      return createSetup(owner, repository.restartPending);
    },

    async confirm(owner: AuthenticatorOwnerContext, enrollmentId: string, code: string) {
      let secret = '';
      try {
        const row = await repository.findOwnedById(owner.participantId, enrollmentId);
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
        // #269: a pending row beside an active factor is a replacement, which must
        // be confirmed through the replacement flow so recovery codes rotate with it.
        const active = await repository.findActiveByParticipantId(owner.participantId);
        if (active && active.id !== enrollmentId) {
          throw new AuthenticatorEnrollmentError(
            'AUTHENTICATOR_REPLACEMENT_CONFIRMATION_REQUIRED',
            409
          );
        }

        secret = getProtector().decrypt(protectedSecretOf(row), {
          participantId: owner.participantId,
          enrollmentId,
        });
        if (!verifyTotpCode(secret, code, now())) {
          throw new AuthenticatorEnrollmentError('INVALID_AUTHENTICATOR_CODE', 401);
        }

        const activated = await repository.activatePending(owner.participantId, enrollmentId);
        if (activated.outcome === 'Expired' || !activated.activatedAt) {
          throw new AuthenticatorEnrollmentError('AUTHENTICATOR_ENROLLMENT_EXPIRED', 410);
        }
        return { activatedAt: activated.activatedAt };
      } catch (error: unknown) {
        throw mapStorageError(error);
      } finally {
        // JavaScript strings cannot be zeroized; constraining this local is the
        // narrowest practical lifetime. Buffer copies are zeroized by crypto helpers.
        secret = '';
      }
    },
  };
}

export const persistentAuthenticatorEnrollmentProvider =
  createPersistentAuthenticatorEnrollmentProvider();
