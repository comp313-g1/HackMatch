import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSupabaseClient } from './client.js';
import { moderationTargetRepository } from './moderationTarget.repository.js';

vi.mock('./client.js', () => ({
  getSupabaseClient: vi.fn(),
}));

function mockIdentityLookup(result: { data: { id: string } | null; error: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  vi.mocked(getSupabaseClient).mockReturnValue({ from } as never);
  return { from, select, eq, maybeSingle };
}

describe('moderationTargetRepository (US-033 / #392)', () => {
  const id = '11111111-1111-4111-8111-111111111111';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['chat channel', 'chat_channels', 'chatChannelExists'],
    ['chat message', 'chat_messages', 'chatMessageExists'],
  ] as const)('resolves %s identity without selecting private content', async (_label, table, method) => {
    const query = mockIdentityLookup({ data: { id }, error: null });

    await expect(moderationTargetRepository[method](id)).resolves.toBe(true);

    expect(query.from).toHaveBeenCalledWith(table);
    expect(query.select).toHaveBeenCalledWith('id');
    expect(query.eq).toHaveBeenCalledWith('id', id);
    expect(query.select).not.toHaveBeenCalledWith(expect.stringMatching(/body|email|author|title/));
  });

  it('returns false when the identifier does not exist in the expected entity table', async () => {
    mockIdentityLookup({ data: null, error: null });

    await expect(moderationTargetRepository.chatMessageExists(id)).resolves.toBe(false);
  });

  it('surfaces database failures rather than treating them as a missing target', async () => {
    const failure = { code: '08006', message: 'connection failure' };
    mockIdentityLookup({ data: null, error: failure });

    await expect(moderationTargetRepository.chatChannelExists(id)).rejects.toBe(failure);
  });
});
