import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSupabaseClient } from './client.js';
import { authenticatorRecoveryControlsRepository } from './authenticatorRecoveryControls.repository.js';

vi.mock('./client.js', () => ({ getSupabaseClient: vi.fn() }));

const PARTICIPANT = '10000000-0000-4000-8000-000000000001';
const BATCH = '30000000-0000-4000-8000-00000000000a';

describe('authenticatorRecoveryControlsRepository (US-029 / #269)', () => {
  const rpc = vi.fn();
  const limit = vi.fn();
  const builder: Record<string, unknown> = {};
  const selected: string[] = [];
  const filters: unknown[][] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    selected.length = 0;
    filters.length = 0;
    builder.select = vi.fn((columns: string) => {
      selected.push(columns);
      return builder;
    });
    builder.eq = vi.fn((...args: unknown[]) => {
      filters.push(['eq', ...args]);
      return builder;
    });
    builder.is = vi.fn((...args: unknown[]) => {
      filters.push(['is', ...args]);
      return builder;
    });
    builder.order = vi.fn(() => builder);
    builder.limit = limit;
    vi.mocked(getSupabaseClient).mockReturnValue({
      rpc,
      from: vi.fn(() => builder),
    } as never);
  });

  it('passes only ciphertext metadata to the atomic replacement RPC', async () => {
    rpc.mockResolvedValue({
      data: [{ enrollment_id: 'enr-1', expires_at: '2026-11-11T18:10:00.000Z', secret_ciphertext: 'x' }],
      error: null,
    });
    const result = await authenticatorRecoveryControlsRepository.beginReplacement({
      enrollmentId: 'enr-1',
      participantId: PARTICIPANT,
      protectedSecret: { ciphertext: 'ct', iv: 'iv', authTag: 'tag', keyVersion: 'v1' },
      expiresAt: '2026-11-11T18:10:00.000Z',
    });
    expect(rpc).toHaveBeenCalledWith('begin_authenticator_replacement', {
      p_participant: PARTICIPANT,
      p_enrollment: 'enr-1',
      p_secret_ciphertext: 'ct',
      p_secret_iv: 'iv',
      p_secret_auth_tag: 'tag',
      p_key_version: 'v1',
      p_expires_at: '2026-11-11T18:10:00.000Z',
    });
    expect(result).toEqual({
      enrollmentId: 'enr-1',
      status: 'Pending',
      expiresAt: '2026-11-11T18:10:00.000Z',
    });
  });

  it('confirms a replacement and rotates recovery verifiers through one atomic RPC', async () => {
    rpc.mockResolvedValue({
      data: [{
        outcome: 'Activated',
        enrollment_id: 'enr-2',
        activation_time: '2026-11-11T18:40:00.000Z',
        recovery_batch_id: BATCH,
        recovery_code_count: 1,
      }],
      error: null,
    });
    const result = await authenticatorRecoveryControlsRepository.activateReplacement({
      participantId: PARTICIPANT,
      enrollmentId: 'enr-2',
      batchId: BATCH,
      verifiers: ['v'.repeat(43)],
      keyVersion: 'v1',
    });
    expect(rpc).toHaveBeenCalledWith('activate_authenticator_replacement', {
      p_participant: PARTICIPANT,
      p_enrollment: 'enr-2',
      p_batch: BATCH,
      p_verifiers: ['v'.repeat(43)],
      p_key_version: 'v1',
    });
    expect(result).toEqual({
      outcome: 'Activated',
      activatedAt: '2026-11-11T18:40:00.000Z',
      recoveryBatchId: BATCH,
      recoveryCodeCount: 1,
    });

    rpc.mockResolvedValue({
      data: [{ outcome: 'Expired', enrollment_id: 'enr-2', activation_time: null, recovery_batch_id: null, recovery_code_count: 0 }],
      error: null,
    });
    await expect(
      authenticatorRecoveryControlsRepository.activateReplacement({
        participantId: PARTICIPANT,
        enrollmentId: 'enr-2',
        batchId: BATCH,
        verifiers: ['v'.repeat(43)],
        keyVersion: 'v1',
      })
    ).resolves.toEqual({ outcome: 'Expired', activatedAt: null, recoveryBatchId: null, recoveryCodeCount: 0 });
  });

  it('disables through one owner-scoped RPC', async () => {
    rpc.mockResolvedValue({
      data: [{ disabled_at: '2026-11-11T18:30:00.000Z', revoked_recovery_codes: 10 }],
      error: null,
    });
    await expect(authenticatorRecoveryControlsRepository.disableActive(PARTICIPANT)).resolves.toEqual({
      disabledAt: '2026-11-11T18:30:00.000Z',
      revokedRecoveryCodes: 10,
    });
    expect(rpc).toHaveBeenCalledWith('disable_authenticator', { p_participant: PARTICIPANT });
  });

  it('sends verifiers (never raw codes) and the expected batch to the atomic regenerate RPC', async () => {
    rpc.mockResolvedValue({
      data: [{ batch_id: BATCH, code_count: 2, generated_at: '2026-11-11T18:20:00.000Z' }],
      error: null,
    });
    const result = await authenticatorRecoveryControlsRepository.replaceRecoveryCodes({
      participantId: PARTICIPANT,
      batchId: BATCH,
      expectedBatchId: null,
      verifiers: ['v'.repeat(43), 'w'.repeat(43)],
      keyVersion: 'v1',
    });
    expect(rpc).toHaveBeenCalledWith('replace_authenticator_recovery_codes', {
      p_participant: PARTICIPANT,
      p_batch: BATCH,
      p_expected_batch: null,
      p_verifiers: ['v'.repeat(43), 'w'.repeat(43)],
      p_key_version: 'v1',
    });
    expect(result).toEqual({ batchId: BATCH, codeCount: 2, generatedAt: '2026-11-11T18:20:00.000Z' });
  });

  it('propagates storage errors without swallowing them', async () => {
    rpc.mockResolvedValue({ data: null, error: new Error('RECOVERY_CODES_STALE') });
    await expect(
      authenticatorRecoveryControlsRepository.replaceRecoveryCodes({
        participantId: PARTICIPANT,
        batchId: BATCH,
        expectedBatchId: null,
        verifiers: ['v'.repeat(43)],
        keyVersion: 'v1',
      })
    ).rejects.toThrow('RECOVERY_CODES_STALE');
  });

  it('summarizes the current set without selecting verifier columns', async () => {
    limit.mockResolvedValue({
      data: [
        { batch_id: BATCH, created_at: '2026-11-11T18:20:00.000Z', used_at: null },
        { batch_id: BATCH, created_at: '2026-11-11T18:20:00.000Z', used_at: '2026-11-11T18:25:00.000Z' },
        { batch_id: BATCH, created_at: '2026-11-11T18:20:00.000Z', used_at: null },
      ],
      error: null,
    });
    const summary =
      await authenticatorRecoveryControlsRepository.findCurrentRecoveryCodeSummary(PARTICIPANT);
    expect(summary).toEqual({
      batchId: BATCH,
      total: 3,
      remaining: 2,
      generatedAt: '2026-11-11T18:20:00.000Z',
    });
    expect(selected).toEqual(['batch_id, created_at, used_at']);
    expect(selected.join()).not.toMatch(/verifier|key_version/);
    expect(filters).toContainEqual(['eq', 'participant_id', PARTICIPANT]);
    expect(filters).toContainEqual(['is', 'revoked_at', null]);
  });

  it('returns null when no current set exists', async () => {
    limit.mockResolvedValue({ data: [], error: null });
    await expect(
      authenticatorRecoveryControlsRepository.findCurrentRecoveryCodeSummary(PARTICIPANT)
    ).resolves.toBeNull();
  });
});
