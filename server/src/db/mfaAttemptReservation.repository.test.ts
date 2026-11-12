import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { mfaRepository } from './mfa.repository.js';
import * as clientModule from './client.js';

/** US-029 / #271 repository contract for the serialized attempt reservation (unit, Supabase mocked). */
describe('mfaRepository attempt reservation (#271)', () => {
  const rpc = vi.fn();
  const filters: unknown[][] = [];
  const builder: Record<string, unknown> = {};
  let terminal: { error: unknown };

  beforeEach(() => {
    vi.restoreAllMocks();
    filters.length = 0;
    terminal = { error: null };
    for (const method of ['update', 'delete']) {
      builder[method] = vi.fn((...args: unknown[]) => {
        filters.push([method, ...args]);
        return builder;
      });
    }
    builder.eq = vi.fn((...args: unknown[]) => {
      filters.push(['eq', ...args]);
      return builder;
    });
    // Make the builder awaitable like a Supabase query.
    builder.then = (resolve: (value: { error: unknown }) => unknown) => resolve(terminal);
    vi.spyOn(clientModule, 'getSupabaseClient').mockReturnValue({
      rpc,
      from: vi.fn(() => builder),
    } as unknown as SupabaseClient);
  });

  it('reserves through the serialized RPC and returns a failed attempt projection', async () => {
    rpc.mockResolvedValue({
      data: [{ attempt_id: 'att-9', attempted_at: '2026-11-12T10:00:00.000001+00:00' }],
      error: null,
    });
    const attempt = await mfaRepository.reserveAttempt({
      participant_id: 'part-1',
      challenge_id: 'chal-1',
      ip_address: '203.0.113.7',
    });
    expect(rpc).toHaveBeenCalledWith('reserve_mfa_verification_attempt', {
      p_participant: 'part-1',
      p_challenge: 'chal-1',
      p_ip_address: '203.0.113.7',
    });
    expect(attempt).toEqual({
      id: 'att-9',
      participant_id: 'part-1',
      challenge_id: 'chal-1',
      success: false,
      ip_address: '203.0.113.7',
      created_at: '2026-11-12T10:00:00.000001+00:00',
    });
  });

  it('validates input and propagates RPC errors', async () => {
    await expect(mfaRepository.reserveAttempt({ participant_id: '' })).rejects.toThrow('participant_id is required');
    rpc.mockResolvedValueOnce({ data: null, error: new Error('rpc failed') });
    await expect(mfaRepository.reserveAttempt({ participant_id: 'part-1' })).rejects.toThrow('rpc failed');
    rpc.mockResolvedValueOnce({ data: [], error: null });
    await expect(mfaRepository.reserveAttempt({ participant_id: 'part-1' })).rejects.toThrow(/no row/);
  });

  it('marks only the owner’s reserved attempt successful', async () => {
    await mfaRepository.markAttemptSucceeded('att-9', 'part-1');
    expect(filters).toEqual([
      ['update', { success: true }],
      ['eq', 'id', 'att-9'],
      ['eq', 'participant_id', 'part-1'],
    ]);
  });

  it('discards only the owner’s still-failed reservation, never a success row', async () => {
    await mfaRepository.discardAttempt('att-9', 'part-1');
    expect(filters).toEqual([
      ['delete'],
      ['eq', 'id', 'att-9'],
      ['eq', 'participant_id', 'part-1'],
      ['eq', 'success', false],
    ]);
  });

  it('surfaces storage errors from settle operations', async () => {
    terminal = { error: new Error('update failed') };
    await expect(mfaRepository.markAttemptSucceeded('att-9', 'part-1')).rejects.toThrow('update failed');
    await expect(mfaRepository.discardAttempt('att-9', 'part-1')).rejects.toThrow('update failed');
    await expect(mfaRepository.discardAttempt('', 'part-1')).rejects.toThrow(/required/);
  });
});
