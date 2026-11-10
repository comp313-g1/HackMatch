import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  canonicalParticipantPair,
  directMessageRepository,
  getPeerParticipantId,
  isDirectMessageParticipant,
} from './directMessage.repository.js';
import { getSupabaseClient } from './client.js';

vi.mock('./client.js', () => ({ getSupabaseClient: vi.fn() }));

const LOW = '11111111-1111-4111-8111-111111111111';
const HIGH = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = '55555555-5555-4555-8555-555555555555';
const THREAD = {
  id: 't1',
  participant_low_id: LOW,
  participant_high_id: HIGH,
  last_message_at: '2026-11-09T20:00:00.000Z',
  created_at: '2026-11-09T20:00:00.000Z',
  updated_at: '2026-11-09T20:00:00.000Z',
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

describe('isDirectMessageParticipant & getPeerParticipantId (US-032 / #387)', () => {
  it('checks participant membership correctly and case-insensitively', () => {
    expect(isDirectMessageParticipant(THREAD, LOW)).toBe(true);
    expect(isDirectMessageParticipant(THREAD, HIGH.toUpperCase())).toBe(true);
    expect(isDirectMessageParticipant(THREAD, OTHER)).toBe(false);
    expect(isDirectMessageParticipant(null, LOW)).toBe(false);
  });

  it('resolves peer ID for each member and returns null for non-members', () => {
    expect(getPeerParticipantId(THREAD, LOW)).toBe(HIGH);
    expect(getPeerParticipantId(THREAD, HIGH)).toBe(LOW);
    expect(getPeerParticipantId(THREAD, OTHER)).toBeNull();
    expect(getPeerParticipantId(null, LOW)).toBeNull();
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

describe('directMessageRepository inbox, thread, and send-message methods (US-032 / #387)', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('findThreadById looks up thread by UUID', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: THREAD, error: null });
    const eq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    vi.mocked(getSupabaseClient).mockReturnValue({ from } as never);

    const result = await directMessageRepository.findThreadById('t1');
    expect(from).toHaveBeenCalledWith('direct_message_threads');
    expect(eq).toHaveBeenCalledWith('id', 't1');
    expect(result).toEqual(THREAD);
  });

  it('listThreadsForParticipant queries either low or high participant side', async () => {
    const limit = vi.fn().mockResolvedValue({ data: [THREAD], error: null });
    const order = vi.fn(() => ({ limit }));
    const or = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ or }));
    const from = vi.fn(() => ({ select }));
    vi.mocked(getSupabaseClient).mockReturnValue({ from } as never);

    const result = await directMessageRepository.listThreadsForParticipant(LOW, { limit: 25 });
    expect(from).toHaveBeenCalledWith('direct_message_threads');
    expect(or).toHaveBeenCalledWith(
      `participant_low_id.eq.${LOW.toLowerCase()},participant_high_id.eq.${LOW.toLowerCase()}`
    );
    expect(order).toHaveBeenCalledWith('updated_at', { ascending: false });
    expect(limit).toHaveBeenCalledWith(25);
    expect(result).toEqual([THREAD]);
  });

  it('listMessagesByThread queries messages ordered oldest-first (created_at ASC)', async () => {
    const messages = [
      {
        id: 'm1',
        thread_id: 't1',
        author_id: LOW,
        body: 'Hello',
        created_at: '2026-11-09T20:05:00.000Z',
      },
    ];
    const limit = vi.fn().mockResolvedValue({ data: messages, error: null });
    const order = vi.fn(() => ({ limit }));
    const eq = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    vi.mocked(getSupabaseClient).mockReturnValue({ from } as never);

    const result = await directMessageRepository.listMessagesByThread('t1');
    expect(from).toHaveBeenCalledWith('direct_messages');
    expect(eq).toHaveBeenCalledWith('thread_id', 't1');
    expect(order).toHaveBeenCalledWith('created_at', { ascending: true });
    expect(result).toEqual(messages);
  });

  it('createMessage inserts into direct_messages', async () => {
    const msg = {
      id: 'm1',
      thread_id: 't1',
      author_id: LOW,
      body: 'Hello world',
      created_at: '2026-11-09T20:10:00.000Z',
    };
    const single = vi.fn().mockResolvedValue({ data: msg, error: null });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    const from = vi.fn(() => ({ insert }));
    vi.mocked(getSupabaseClient).mockReturnValue({ from } as never);

    const result = await directMessageRepository.createMessage({
      thread_id: 't1',
      author_id: LOW,
      body: 'Hello world',
    });
    expect(from).toHaveBeenCalledWith('direct_messages');
    expect(insert).toHaveBeenCalledWith({
      thread_id: 't1',
      author_id: LOW,
      body: 'Hello world',
    });
    expect(result).toEqual(msg);
  });

  it('findLatestMessagesForThreads groups latest message by thread_id', async () => {
    const rows = [
      { id: 'm2', thread_id: 't1', author_id: HIGH, body: 'latest', created_at: '2026-11-09T21:00:00.000Z' },
      { id: 'm1', thread_id: 't1', author_id: LOW, body: 'earlier', created_at: '2026-11-09T20:00:00.000Z' },
    ];
    const order = vi.fn().mockResolvedValue({ data: rows, error: null });
    const inFn = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ in: inFn }));
    const from = vi.fn(() => ({ select }));
    vi.mocked(getSupabaseClient).mockReturnValue({ from } as never);

    const map = await directMessageRepository.findLatestMessagesForThreads(['t1']);
    expect(map.get('t1')?.id).toBe('m2');
  });

  it('isParticipantPairBlocked checks participant_blocks table', async () => {
    const limit = vi.fn().mockResolvedValue({ data: [{ blocker_id: LOW, blocked_id: HIGH }], error: null });
    const or = vi.fn(() => ({ limit }));
    const select = vi.fn(() => ({ or }));
    const from = vi.fn(() => ({ select }));
    vi.mocked(getSupabaseClient).mockReturnValue({ from } as never);

    const isBlocked = await directMessageRepository.isParticipantPairBlocked(LOW, HIGH);
    expect(from).toHaveBeenCalledWith('participant_blocks');
    expect(isBlocked).toBe(true);
  });
});
