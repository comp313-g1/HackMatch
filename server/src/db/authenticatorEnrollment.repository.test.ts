import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSupabaseClient } from './client.js';
import { authenticatorEnrollmentRepository } from './authenticatorEnrollment.repository.js';

vi.mock('./client.js', () => ({ getSupabaseClient: vi.fn() }));

const PARTICIPANT = '10000000-0000-4000-8000-000000000001';
const ENROLLMENT = '20000000-0000-4000-8000-000000000002';

describe('authenticatorEnrollmentRepository (US-029 / #267)', () => {
  const rpc = vi.fn();
  const maybeSingle = vi.fn();
  const builder: Record<string, unknown> = {};
  const calls: unknown[][] = [];
  const selected: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
    selected.length = 0;
    builder.select = vi.fn((columns: string) => {
      selected.push(columns);
      return builder;
    });
    builder.eq = vi.fn((...args: unknown[]) => {
      calls.push(args);
      return builder;
    });
    builder.maybeSingle = maybeSingle;
    builder.in = vi.fn(() => builder);
    builder.order = vi.fn(() => builder);
    builder.limit = vi.fn(() => builder);
    vi.mocked(getSupabaseClient).mockReturnValue({
      rpc,
      from: vi.fn(() => builder),
    } as never);
  });

  it('passes ciphertext metadata to the atomic begin RPC and returns a safe projection', async () => {
    rpc.mockResolvedValue({
      data: [{
        enrollment_id: ENROLLMENT,
        enrollment_status: 'Pending',
        expires_at: '2026-11-11T18:10:00.000Z',
        secret_ciphertext: 'must-not-return',
      }],
      error: null,
    });

    const result = await authenticatorEnrollmentRepository.createPending({
      enrollmentId: ENROLLMENT,
      participantId: PARTICIPANT,
      protectedSecret: {
        ciphertext: 'encrypted-base64-value',
        iv: 'random-iv-base64',
        authTag: 'gcm-auth-tag-base64',
        keyVersion: 'v1',
      },
      expiresAt: '2026-11-11T18:10:00.000Z',
    });

    expect(rpc).toHaveBeenCalledWith('begin_authenticator_enrollment', {
      p_participant: PARTICIPANT,
      p_enrollment: ENROLLMENT,
      p_secret_ciphertext: 'encrypted-base64-value',
      p_secret_iv: 'random-iv-base64',
      p_secret_auth_tag: 'gcm-auth-tag-base64',
      p_key_version: 'v1',
      p_expires_at: '2026-11-11T18:10:00.000Z',
    });
    expect(result).toEqual({
      enrollmentId: ENROLLMENT,
      status: 'Pending',
      expiresAt: '2026-11-11T18:10:00.000Z',
    });
    expect(JSON.stringify(result)).not.toMatch(/ciphertext|authTag|secret_iv|secret_auth_tag/i);
  });

  it('always scopes protected-row reads by participant and opaque enrollment id', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });

    await expect(
      authenticatorEnrollmentRepository.findOwnedById(PARTICIPANT, ENROLLMENT)
    ).resolves.toBeNull();

    expect(calls).toEqual([
      ['id', ENROLLMENT],
      ['participant_id', PARTICIPANT],
    ]);
  });

  it('uses the atomic activation RPC and omits storage internals from its result', async () => {
    rpc.mockResolvedValue({
      data: [{
        outcome: 'Activated',
        enrollment_id: ENROLLMENT,
        activation_time: '2026-11-11T18:05:00.000Z',
        secret_ciphertext: 'must-not-return',
      }],
      error: null,
    });

    await expect(
      authenticatorEnrollmentRepository.activatePending(PARTICIPANT, ENROLLMENT)
    ).resolves.toEqual({
      outcome: 'Activated',
      enrollmentId: ENROLLMENT,
      activatedAt: '2026-11-11T18:05:00.000Z',
    });
    expect(rpc).toHaveBeenCalledWith('activate_authenticator_enrollment', {
      p_participant: PARTICIPANT,
      p_enrollment: ENROLLMENT,
    });
  });

  it('passes fresh protected material to the atomic pending-restart RPC', async () => {
    rpc.mockResolvedValue({
      data: [{
        enrollment_id: ENROLLMENT,
        enrollment_status: 'Pending',
        expires_at: '2026-11-11T18:10:00.000Z',
      }],
      error: null,
    });

    await expect(authenticatorEnrollmentRepository.restartPending({
      enrollmentId: ENROLLMENT,
      participantId: PARTICIPANT,
      protectedSecret: {
        ciphertext: 'fresh-encrypted-value',
        iv: 'fresh-random-iv',
        authTag: 'fresh-auth-tag',
        keyVersion: 'v1',
      },
      expiresAt: '2026-11-11T18:10:00.000Z',
    })).resolves.toEqual({
      enrollmentId: ENROLLMENT,
      status: 'Pending',
      expiresAt: '2026-11-11T18:10:00.000Z',
    });
    expect(rpc).toHaveBeenCalledWith('restart_authenticator_enrollment', {
      p_participant: PARTICIPANT,
      p_enrollment: ENROLLMENT,
      p_secret_ciphertext: 'fresh-encrypted-value',
      p_secret_iv: 'fresh-random-iv',
      p_secret_auth_tag: 'fresh-auth-tag',
      p_key_version: 'v1',
      p_expires_at: '2026-11-11T18:10:00.000Z',
    });
  });

  it('loads current owner status with a status-only projection', async () => {
    maybeSingle.mockResolvedValue({
      data: {
        status: 'Active',
        pending_expires_at: null,
        activated_at: '2026-11-11T18:05:00.000Z',
      },
      error: null,
    });

    await expect(
      authenticatorEnrollmentRepository.findCurrentByParticipantId(PARTICIPANT)
    ).resolves.toMatchObject({ status: 'Active' });
    expect(selected[0]).toBe('status, pending_expires_at, activated_at');
    expect(selected[0]).not.toMatch(/secret_|ciphertext|auth_tag|secret_iv/i);
    expect(calls).toContainEqual(['participant_id', PARTICIPANT]);
  });

  it('propagates storage errors and rejects empty RPC results', async () => {
    const failure = new Error('storage unavailable');
    rpc.mockResolvedValueOnce({ data: null, error: failure });
    await expect(authenticatorEnrollmentRepository.createPending({
      enrollmentId: ENROLLMENT,
      participantId: PARTICIPANT,
      protectedSecret: { ciphertext: 'cipher', iv: 'iv', authTag: 'tag', keyVersion: 'v1' },
      expiresAt: '2026-11-11T18:10:00.000Z',
    })).rejects.toBe(failure);

    rpc.mockResolvedValueOnce({ data: [], error: null });
    await expect(
      authenticatorEnrollmentRepository.activatePending(PARTICIPANT, ENROLLMENT)
    ).rejects.toThrow('TOTP_STORAGE_EMPTY_RESULT');
  });
});
