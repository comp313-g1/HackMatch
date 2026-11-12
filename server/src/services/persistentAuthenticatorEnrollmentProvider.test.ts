import { describe, expect, it, vi } from 'vitest';
import type {
  ActivatedAuthenticator,
  AuthenticatorEnrollmentRepository,
  CreatePendingAuthenticatorInput,
  StoredAuthenticatorEnrollment,
} from '../db/authenticatorEnrollment.repository.js';
import { createTotpSecretProtector } from '../security/totpSecretEncryption.js';
import { _totpCodeForTest } from '../security/totp.js';
import type { AuthenticatorOwnerContext } from './authenticatorEnrollment.js';
import { createPersistentAuthenticatorEnrollmentProvider } from './persistentAuthenticatorEnrollmentProvider.js';

const KEY = Buffer.alloc(32, 11).toString('base64');
const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const NOW = new Date('2026-11-11T18:00:00.000Z');
const ENROLLMENT_ID = '20000000-0000-4000-8000-000000000002';
const owner: AuthenticatorOwnerContext = {
  participantId: '10000000-0000-4000-8000-000000000001',
  firebaseUid: 'firebase-owner',
  role: 'PART',
};

class MemoryRepository implements AuthenticatorEnrollmentRepository {
  rows = new Map<string, StoredAuthenticatorEnrollment>();
  createInputs: CreatePendingAuthenticatorInput[] = [];
  activateCalls = 0;

  async createPending(input: CreatePendingAuthenticatorInput) {
    this.createInputs.push(input);
    const existing = [...this.rows.values()].find(
      (row) => row.participant_id === input.participantId && row.status === 'Pending'
    );
    if (existing) throw new Error('TOTP_ENROLLMENT_PENDING');
    if ([...this.rows.values()].some(
      (row) => row.participant_id === input.participantId && row.status === 'Active'
    )) throw new Error('TOTP_AUTHENTICATOR_ALREADY_ACTIVE');

    this.rows.set(input.enrollmentId, {
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
      created_at: NOW.toISOString(),
      updated_at: NOW.toISOString(),
    });
    return { enrollmentId: input.enrollmentId, status: 'Pending' as const, expiresAt: input.expiresAt };
  }

  async findOwnedById(participantId: string, enrollmentId: string) {
    const row = this.rows.get(enrollmentId);
    return row?.participant_id === participantId ? row : null;
  }

  async findActiveByParticipantId(participantId: string) {
    return [...this.rows.values()].find(
      (row) => row.participant_id === participantId && row.status === 'Active'
    ) ?? null;
  }

  async activatePending(participantId: string, enrollmentId: string): Promise<ActivatedAuthenticator> {
    this.activateCalls += 1;
    const row = await this.findOwnedById(participantId, enrollmentId);
    if (!row || row.status !== 'Pending') throw new Error('TOTP_ENROLLMENT_STALE');
    for (const existing of this.rows.values()) {
      if (existing.participant_id === participantId && existing.status === 'Active') {
        existing.status = 'Retired';
        existing.retired_at = NOW.toISOString();
      }
    }
    row.status = 'Active';
    row.pending_expires_at = null;
    row.activated_at = NOW.toISOString();
    return { outcome: 'Activated', enrollmentId, activatedAt: NOW.toISOString() };
  }
}

function providerWith(repository: AuthenticatorEnrollmentRepository, overrides = {}) {
  return createPersistentAuthenticatorEnrollmentProvider({
    repository,
    getProtector: () => createTotpSecretProtector(KEY, 'v1'),
    generateSecret: () => SECRET,
    generateEnrollmentId: () => ENROLLMENT_ID,
    now: () => new Date(NOW),
    ...overrides,
  });
}

describe('persistent authenticator enrollment provider (US-029 / #267)', () => {
  it('persists only encrypted pending material and returns owner setup material', async () => {
    const repository = new MemoryRepository();
    const result = await providerWith(repository).begin(owner);

    expect(result).toMatchObject({
      enrollmentId: ENROLLMENT_ID,
      expiresAt: '2026-11-11T18:10:00.000Z',
      manualEntryKey: SECRET,
      accountLabel: 'HackMatch account',
    });
    expect(result.otpauthUri).toContain(`secret=${SECRET}`);
    const stored = repository.createInputs[0]!;
    expect(JSON.stringify(stored)).not.toContain(SECRET);
    expect(stored.protectedSecret.keyVersion).toBe('v1');
    expect(stored.protectedSecret.ciphertext).not.toBe(SECRET);
  });

  it('decrypts and activates only after a valid current code', async () => {
    const repository = new MemoryRepository();
    const provider = providerWith(repository);
    await provider.begin(owner);
    const code = _totpCodeForTest(SECRET, NOW);

    await expect(provider.confirm(owner, ENROLLMENT_ID, code)).resolves.toEqual({
      activatedAt: NOW.toISOString(),
    });
    expect(repository.rows.get(ENROLLMENT_ID)?.status).toBe('Active');
    expect(repository.activateCalls).toBe(1);
  });

  it('preserves pending state after a wrong code and supports a valid retry', async () => {
    const repository = new MemoryRepository();
    const provider = providerWith(repository);
    await provider.begin(owner);

    await expect(provider.confirm(owner, ENROLLMENT_ID, '000000')).rejects.toMatchObject({
      code: 'INVALID_AUTHENTICATOR_CODE',
      status: 401,
    });
    expect(repository.rows.get(ENROLLMENT_ID)?.status).toBe('Pending');
    expect(repository.activateCalls).toBe(0);

    await expect(
      provider.confirm(owner, ENROLLMENT_ID, _totpCodeForTest(SECRET, NOW))
    ).resolves.toBeTruthy();
  });

  it('does not let another account retrieve or confirm the enrollment', async () => {
    const repository = new MemoryRepository();
    const provider = providerWith(repository);
    await provider.begin(owner);
    const other = { ...owner, participantId: 'another-participant' };

    await expect(
      provider.confirm(other, ENROLLMENT_ID, _totpCodeForTest(SECRET, NOW))
    ).rejects.toMatchObject({ code: 'AUTHENTICATOR_ENROLLMENT_NOT_PENDING' });
    expect(repository.rows.get(ENROLLMENT_ID)?.status).toBe('Pending');
  });

  it('fails closed for expired or corrupted protected material', async () => {
    const repository = new MemoryRepository();
    const provider = providerWith(repository);
    await provider.begin(owner);
    const row = repository.rows.get(ENROLLMENT_ID)!;
    row.pending_expires_at = new Date(NOW.getTime() - 1).toISOString();
    await expect(provider.confirm(owner, ENROLLMENT_ID, '123456')).rejects.toMatchObject({
      code: 'AUTHENTICATOR_ENROLLMENT_EXPIRED',
    });
    expect(row.status).toBe('Pending');

    row.pending_expires_at = new Date(NOW.getTime() + 60_000).toISOString();
    row.secret_auth_tag = 'corrupted';
    await expect(provider.confirm(owner, ENROLLMENT_ID, '123456')).rejects.toMatchObject({
      code: 'AUTHENTICATOR_ENROLLMENT_UNAVAILABLE',
      status: 503,
    });
    expect(row.status).toBe('Pending');
  });

  it('keeps an existing active factor intact when replacement begin fails', async () => {
    const repository = new MemoryRepository();
    repository.rows.set('active-id', {
      id: 'active-id',
      participant_id: owner.participantId,
      secret_ciphertext: 'ciphertext',
      secret_iv: 'initial-vector',
      secret_auth_tag: 'authentication-tag',
      encryption_key_version: 'v1',
      status: 'Active',
      pending_expires_at: null,
      activated_at: NOW.toISOString(),
      retired_at: null,
      created_at: NOW.toISOString(),
      updated_at: NOW.toISOString(),
    });

    await expect(providerWith(repository).begin(owner)).rejects.toMatchObject({
      code: 'AUTHENTICATOR_ALREADY_ACTIVE',
    });
    expect(repository.rows.get('active-id')?.status).toBe('Active');
  });

  it('maps storage/configuration failures without leaking their details', async () => {
    const repository = new MemoryRepository();
    vi.spyOn(repository, 'createPending').mockRejectedValue(
      new Error('database ciphertext OWNER_SECRET connection failed')
    );
    await expect(providerWith(repository).begin(owner)).rejects.toMatchObject({
      code: 'AUTHENTICATOR_ENROLLMENT_UNAVAILABLE',
      message: 'AUTHENTICATOR_ENROLLMENT_UNAVAILABLE',
    });

    const missingConfig = createPersistentAuthenticatorEnrollmentProvider({
      repository,
      getProtector: () => createTotpSecretProtector('', 'v1'),
    });
    await expect(missingConfig.begin(owner)).rejects.toMatchObject({
      code: 'AUTHENTICATOR_CONFIGURATION_ERROR',
    });
  });
});
