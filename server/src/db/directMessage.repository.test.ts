import { describe, it, expect, vi, beforeEach } from 'vitest';
import { canonicalParticipantPair, directMessageRepository } from './directMessage.repository.js';
import { getSupabaseClient } from './client.js';

vi.mock('./client.js', () => ({ getSupabaseClient: vi.fn() }));

const LOW = '11111111-1111-4111-8111-111111111111';
const HIGH = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const THREAD = {
  id: 't1',
  participant_low_id: LOW,
  participant_high_id: HIGH,
  last_message_at: 'm',
  created_at: 'c',
  updated_at: 'u',
};

/** Builds a fake client whose select returns `lookups` in order and whose insert returns `insertResult`. */
function fakeClient(lookups: Array<unknown>, insertResult: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn();
  for (const l of lookups) maybeSingle.mockResolvedValueOnce({ data: l, error: null });
  const eq2 = vi.fn(() => ({ maybeSingle }));
  const eq1 = vi.fn(() => ({ eq: eq2 }));
  const select = vi.fn(() => ({ eq: eq1 }));
  const single = vi.fn().mockResolvedValue(insertResult);
  const insertSelect = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select: insertSelect }));
  vi.mocked(getSupabaseClient).mockReturnValue({ from: vi.fn(() => ({ select, insert })) } as never);
  return { insert, eq1, eq2 };
}

describe('canonicalParticipantPair (US-032 / #386)', () => {
  it('orders the pair the same way regardless of argument order', () => {
    expect(canonicalParticipantPair(HIGH, LOW)).toEqual({ low: LOW, high: HIGH });
    expect(canonicalParticipantPair(LOW, HIGH)).toEqual({ low: LOW, high: HIGH });
  });
  it('is case-insensitive', () => {
    expect(canonicalParticipantPair(HIGH.toUpperCase(), LOW)).toEqual({ low: LOW, high: HIGH });
  });
  it('returns null for the same participant', () => {
    expect(canonicalParticipantPair(LOW, LOW.toUpperCase())).toBeNull();
  });
});

describe('directMessageRepository.findOrCreateThread (US-032 / #386)', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns the existing thread without inserting', async () => {
    const c = fakeClient([THREAD], { data: null, error: null });
    const r = await directMessageRepository.findOrCreateThread(LOW, HIGH);
    expect(r).toEqual({ thread: THREAD, created: false });
    expect(c.insert).not.toHaveBeenCalled();
    expect(c.eq1).toHaveBeenCalledWith('participant_low_id', LOW);
    expect(c.eq2).toHaveBeenCalledWith('participant_high_id', HIGH);
  });

  it('creates the thread when none exists', async () => {
    const c = fakeClient([null], { data: THREAD, error: null });
    const r = await directMessageRepository.findOrCreateThread(LOW, HIGH);
    expect(r).toEqual({ thread: THREAD, created: true });
    expect(c.insert).toHaveBeenCalledWith({ participant_low_id: LOW, participant_high_id: HIGH });
  });

  it('resolves to the winner when a concurrent request created it first (unique violation)', async () => {
    fakeClient([null, THREAD], { data: null, error: { code: '23505', message: 'duplicate key value' } });
    const r = await directMessageRepository.findOrCreateThread(LOW, HIGH);
    expect(r).toEqual({ thread: THREAD, created: false });
  });

  it('rethrows other database errors', async () => {
    fakeClient([null], { data: null, error: { code: '08006', message: 'connection failure' } });
    await expect(directMessageRepository.findOrCreateThread(LOW, HIGH)).rejects.toMatchObject({ code: '08006' });
  });

  it('rethrows a unique violation if the winning row cannot be found', async () => {
    fakeClient([null, null], { data: null, error: { code: '23505', message: 'duplicate key' } });
    await expect(directMessageRepository.findOrCreateThread(LOW, HIGH)).rejects.toMatchObject({ code: '23505' });
  });
});
