import { describe, expect, it, vi } from 'vitest';
import type {
  AuthenticatorRecoveryControlsRepository,
  ReplaceRecoveryCodesInput,
} from '../db/authenticatorRecoveryControls.repository.js';
import type {
  CreatePendingAuthenticatorInput,
  StoredAuthenticatorEnrollment,
} from '../db/authenticatorEnrollment.repository.js';
import { _totpCodeForTest } from '../security/totp.js';
import {
  TotpEncryptionConfigurationError,
  createTotpSecretProtector,
} from '../security/totpSecretEncryption.js';
import { createRecoveryCodeVerifier } from '../security/recoveryCodes.js';
import { AuthenticatorEnrollmentError, type AuthenticatorOwnerContext } from './authenticatorEnrollment.js';
import { createPersistentAuthenticatorRecoveryControlsProvider } from './persistentAuthenticatorRecoveryControlsProvider.js';

const KEY = Buffer.alloc(32, 11).toString('base64');
const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const NOW = new Date('2026-11-11T18:00:00.000Z');
const CODES = ['ABCD-EFGH-JKMN', 'PQRS-TUVW-XYZ2'];
const owner: AuthenticatorOwnerContext = {
  participantId: '10000000-0000-4000-8000-000000000001',
  firebaseUid: 'firebase-owner',
  role: 'PART',
};

function repository(overrides: Partial<AuthenticatorRecoveryControlsRepository> = {}) {
  const replaceInputs: ReplaceRecoveryCodesInput[] = [];
  const replacementInputs: CreatePendingAuthenticatorInput[] = [];
  const repo: AuthenticatorRecoveryControlsRepository = {
    beginReplacement: vi.fn(async (input) => {
      replacementInputs.push(input);
      return { enrollmentId: input.enrollmentId, status: 'Pending' as const, expiresAt: input.expiresAt };
    }),
    activateReplacement: vi.fn(async (input) => ({
      outcome: 'Activated' as const,
      activatedAt: '2026-11-11T18:05:00.000Z',
      recoveryBatchId: input.batchId,
      recoveryCodeCount: input.verifiers.length,
    })),
    disableActive: vi.fn(async () => ({ disabledAt: '2026-11-11T18:30:00.000Z', revokedRecoveryCodes: 10 })),
    replaceRecoveryCodes: vi.fn(async (input) => {
      replaceInputs.push(input);
      return { batchId: input.batchId, codeCount: input.verifiers.length, generatedAt: NOW.toISOString() };
    }),
    findCurrentRecoveryCodeSummary: vi.fn(async () => null),
    ...overrides,
  };
  return { repo, replaceInputs, replacementInputs };
}

const REPLACEMENT_ID = '20000000-0000-4000-8000-000000000009';

function pendingReplacementRow(
  overrides: Partial<StoredAuthenticatorEnrollment> = {}
): StoredAuthenticatorEnrollment {
  const protectedSecret = createTotpSecretProtector(KEY, 'v1').encrypt(SECRET, {
    participantId: owner.participantId,
    enrollmentId: REPLACEMENT_ID,
  });
  return {
    id: REPLACEMENT_ID,
    participant_id: owner.participantId,
    secret_ciphertext: protectedSecret.ciphertext,
    secret_iv: protectedSecret.iv,
    secret_auth_tag: protectedSecret.authTag,
    encryption_key_version: protectedSecret.keyVersion,
    status: 'Pending',
    pending_expires_at: '2026-11-11T18:10:00.000Z',
    activated_at: null,
    retired_at: null,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    ...overrides,
  };
}

function provider(
  repo: AuthenticatorRecoveryControlsRepository,
  row: StoredAuthenticatorEnrollment | null = pendingReplacementRow()
) {
  return createPersistentAuthenticatorRecoveryControlsProvider({
    repository: repo,
    enrollmentRepository: {
      findOwnedById: vi.fn(async (participantId: string, enrollmentId: string) =>
        row && row.participant_id === participantId && row.id === enrollmentId ? row : null
      ),
    },
    getProtector: () => createTotpSecretProtector(KEY, 'v1'),
    getVerifier: () => createRecoveryCodeVerifier(KEY, 'v1'),
    generateSecret: () => SECRET,
    generateCodes: () => [...CODES],
    generateId: () => '20000000-0000-4000-8000-000000000009',
    now: () => NOW,
  });
}

describe('persistent authenticator recovery controls (US-029 / #269)', () => {
  it('persists only encrypted replacement material and returns owner-only setup once', async () => {
    const { repo, replacementInputs } = repository();
    const result = await provider(repo).replace(owner);

    expect(result.manualEntryKey).toBe(SECRET);
    expect(result.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    expect(result.expiresAt).toBe('2026-11-11T18:10:00.000Z');
    expect(replacementInputs).toHaveLength(1);
    expect(replacementInputs[0]!.participantId).toBe(owner.participantId);
    expect(JSON.stringify(replacementInputs[0])).not.toContain(SECRET);
    expect(replacementInputs[0]!.protectedSecret.keyVersion).toBe('v1');
  });

  it('stores recovery-code verifiers only and returns raw codes to the caller once', async () => {
    const { repo, replaceInputs } = repository();
    const result = await provider(repo).generateRecoveryCodes(owner, null);

    expect(result.codes).toEqual(CODES);
    expect(replaceInputs).toHaveLength(1);
    const persisted = JSON.stringify(replaceInputs[0]);
    for (const code of CODES) {
      expect(persisted).not.toContain(code);
      expect(persisted).not.toContain(code.replace(/-/g, ''));
    }
    expect(replaceInputs[0]!.verifiers).toHaveLength(2);
    replaceInputs[0]!.verifiers.forEach((verifier) => expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/));
    expect(replaceInputs[0]).toMatchObject({ expectedBatchId: null, keyVersion: 'v1' });
  });

  it('never returns codes from the status projection', async () => {
    const { repo } = repository({
      findCurrentRecoveryCodeSummary: vi.fn(async () => ({
        batchId: '30000000-0000-4000-8000-00000000000a',
        total: 10,
        remaining: 7,
        generatedAt: NOW.toISOString(),
      })),
    });
    const status = await provider(repo).getRecoveryCodeStatus(owner);
    expect(status).toEqual({
      status: 'generated',
      batchId: '30000000-0000-4000-8000-00000000000a',
      total: 10,
      remaining: 7,
      generatedAt: NOW.toISOString(),
    });
  });

  it.each([
    ['TOTP_AUTHENTICATOR_NOT_ACTIVE', 'AUTHENTICATOR_NOT_ACTIVE', 409],
    ['RECOVERY_CODES_STALE', 'RECOVERY_CODES_STALE', 409],
    ['relation "authenticator_recovery_codes" violates something', 'RECOVERY_CODES_UNAVAILABLE', 503],
  ])('maps generation storage failure %s to a safe %s', async (message, code, status) => {
    const { repo } = repository({
      replaceRecoveryCodes: vi.fn(async () => {
        throw new Error(message);
      }),
    });
    const failure = await provider(repo).generateRecoveryCodes(owner, null).catch((error) => error);
    expect(failure).toBeInstanceOf(AuthenticatorEnrollmentError);
    expect(failure).toMatchObject({ code, status });
    expect(String(failure.message)).not.toMatch(/ABCD|relation/);
  });

  it('maps disable/replace without an active authenticator to AUTHENTICATOR_NOT_ACTIVE', async () => {
    const notActive = async () => {
      throw new Error('TOTP_AUTHENTICATOR_NOT_ACTIVE');
    };
    const { repo } = repository({ disableActive: vi.fn(notActive), beginReplacement: vi.fn(notActive) });
    await expect(provider(repo).disable(owner)).rejects.toMatchObject({ code: 'AUTHENTICATOR_NOT_ACTIVE' });
    await expect(provider(repo).replace(owner)).rejects.toMatchObject({ code: 'AUTHENTICATOR_NOT_ACTIVE' });
  });

  describe('replacement confirmation', () => {
    const validCode = () => _totpCodeForTest(SECRET, NOW);

    it('verifies the new code, then rotates to a fresh verifier-only set in one storage call', async () => {
      const { repo } = repository();
      const result = await provider(repo).confirmReplacement(owner, REPLACEMENT_ID, validCode());

      expect(result.activatedAt).toBe('2026-11-11T18:05:00.000Z');
      expect(result.recoveryCodes.codes).toEqual(CODES);
      expect(repo.activateReplacement).toHaveBeenCalledTimes(1);
      const input = vi.mocked(repo.activateReplacement).mock.calls[0]![0];
      expect(input).toMatchObject({
        participantId: owner.participantId,
        enrollmentId: REPLACEMENT_ID,
        keyVersion: 'v1',
      });
      const persisted = JSON.stringify(input);
      for (const code of CODES) expect(persisted).not.toContain(code);
      expect(persisted).not.toContain(SECRET);
      input.verifiers.forEach((verifier) => expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/));
      // Replacement never goes through the plain regenerate path.
      expect(repo.replaceRecoveryCodes).not.toHaveBeenCalled();
    });

    it('leaves the old factor and recovery codes untouched after a wrong code', async () => {
      const { repo } = repository();
      await expect(
        provider(repo).confirmReplacement(owner, REPLACEMENT_ID, validCode() === '000000' ? '111111' : '000000')
      ).rejects.toMatchObject({ code: 'INVALID_AUTHENTICATOR_CODE', status: 401 });
      expect(repo.activateReplacement).not.toHaveBeenCalled();
    });

    it.each([
      ['expired pending row', pendingReplacementRow({ pending_expires_at: '2026-11-11T17:59:59.000Z' }), 'AUTHENTICATOR_ENROLLMENT_EXPIRED'],
      ['cancelled pending row', pendingReplacementRow({ status: 'Canceled', retired_at: NOW.toISOString() }), 'AUTHENTICATOR_ENROLLMENT_STALE'],
      ['another owner’s row', pendingReplacementRow({ participant_id: 'someone-else' }), 'AUTHENTICATOR_ENROLLMENT_NOT_PENDING'],
    ])('rejects a %s without touching recovery codes', async (_label, row, code) => {
      const { repo } = repository();
      await expect(provider(repo, row).confirmReplacement(owner, REPLACEMENT_ID, validCode())).rejects.toMatchObject({ code });
      expect(repo.activateReplacement).not.toHaveBeenCalled();
    });

    it('reports a replacement that expired inside the transaction without returning codes', async () => {
      const { repo } = repository({
        activateReplacement: vi.fn(async () => ({
          outcome: 'Expired' as const,
          activatedAt: null,
          recoveryBatchId: null,
          recoveryCodeCount: 0,
        })),
      });
      const failure = await provider(repo)
        .confirmReplacement(owner, REPLACEMENT_ID, validCode())
        .catch((error) => error);
      expect(failure).toMatchObject({ code: 'AUTHENTICATOR_ENROLLMENT_EXPIRED' });
      expect(JSON.stringify(failure)).not.toMatch(/ABCD|PQRS/);
    });

    it('maps a storage failure to a safe error (old set preserved by the rolled-back transaction)', async () => {
      const { repo } = repository({
        activateReplacement: vi.fn(async () => {
          throw new Error('duplicate key value violates uq_authenticator_recovery_codes_participant_verifier');
        }),
      });
      const failure = await provider(repo)
        .confirmReplacement(owner, REPLACEMENT_ID, validCode())
        .catch((error) => error);
      expect(failure).toMatchObject({ code: 'AUTHENTICATOR_ENROLLMENT_UNAVAILABLE', status: 503 });
      expect(String(failure.message)).not.toMatch(/duplicate|verifier/);
    });
  });

  it('fails closed with a configuration error when the server key is missing', async () => {
    const { repo } = repository();
    const misconfigured = createPersistentAuthenticatorRecoveryControlsProvider({
      repository: repo,
      getVerifier: () => {
        throw new TotpEncryptionConfigurationError();
      },
    });
    await expect(misconfigured.generateRecoveryCodes(owner, null)).rejects.toMatchObject({
      code: 'AUTHENTICATOR_CONFIGURATION_ERROR',
    });
    expect(repo.replaceRecoveryCodes).not.toHaveBeenCalled();
  });
});
