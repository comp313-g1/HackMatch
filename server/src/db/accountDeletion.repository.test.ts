import { describe, it, expect, vi, beforeEach } from 'vitest';
import { accountDeletionRepository } from './accountDeletion.repository.js';
import { getSupabaseClient } from './client.js';

vi.mock('./client.js', () => ({
  getSupabaseClient: vi.fn(),
}));

describe('accountDeletionRepository (US-027 / #249)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a deletion request with safe_state_summary defaults (happy path)', async () => {
    const inserted = {
      id: '11111111-1111-4111-8111-111111111111',
      participant_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      requested_by: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      reason: 'Verified owner requested deletion',
      status: 'Pending',
      ownership_verified: true,
      ownership_verified_at: '2026-10-20T12:00:00.000Z',
      ownership_verified_by: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      blocked_reason: null,
      target_completion_at: '2026-11-19T12:00:00.000Z',
      completed_at: null,
      safe_state_summary: {
        credentialsIncluded: false,
        otpsIncluded: false,
        privateNotesIncluded: false,
      },
      created_at: '2026-10-20T12:00:00.000Z',
      updated_at: '2026-10-20T12:00:00.000Z',
    };

    const single = vi.fn().mockResolvedValue({ data: inserted, error: null });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    vi.mocked(getSupabaseClient).mockReturnValue({
      from: vi.fn(() => ({ insert })),
    } as never);

    const result = await accountDeletionRepository.create({
      participant_id: inserted.participant_id,
      requested_by: inserted.requested_by,
      reason: inserted.reason,
      ownership_verified: true,
      ownership_verified_at: inserted.ownership_verified_at,
      ownership_verified_by: inserted.ownership_verified_by,
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        participant_id: inserted.participant_id,
        requested_by: inserted.requested_by,
        reason: inserted.reason,
        ownership_verified: true,
        safe_state_summary: expect.objectContaining({
          credentialsIncluded: false,
          otpsIncluded: false,
        }),
      })
    );
    expect(result.status).toBe('Pending');
    expect(result.target_completion_at).toBe(inserted.target_completion_at);
  });

  it('findOpenByParticipantId queries in-flight statuses only', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const inFn = vi.fn(() => ({ maybeSingle }));
    const eq = vi.fn(() => ({ in: inFn }));
    const select = vi.fn(() => ({ eq }));
    vi.mocked(getSupabaseClient).mockReturnValue({
      from: vi.fn(() => ({ select })),
    } as never);

    const result = await accountDeletionRepository.findOpenByParticipantId(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    );

    expect(result).toBeNull();
    expect(inFn).toHaveBeenCalledWith('status', [
      'Pending',
      'BlockedNeedsDisband',
      'Processing',
    ]);
  });

  it('surfaces repository errors from create (failure path)', async () => {
    const single = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'duplicate open request', code: '23505' },
    });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    vi.mocked(getSupabaseClient).mockReturnValue({
      from: vi.fn(() => ({ insert })),
    } as never);

    await expect(
      accountDeletionRepository.create({
        participant_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        requested_by: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        reason: 'Duplicate',
      })
    ).rejects.toMatchObject({ code: '23505' });
  });
});
