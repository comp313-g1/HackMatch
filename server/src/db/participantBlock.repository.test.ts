import { describe, it, expect, vi, beforeEach } from 'vitest';
import { participantBlockRepository } from './participantBlock.repository.js';
import { getSupabaseClient } from './client.js';

vi.mock('./client.js', () => ({ getSupabaseClient: vi.fn() }));

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function fake(result: { data: unknown; error: unknown }) {
  const or = vi.fn().mockResolvedValue(result);
  const select = vi.fn(() => ({ or }));
  const from = vi.fn(() => ({ select }));
  vi.mocked(getSupabaseClient).mockReturnValue({ from } as never);
  return { from, select, or };
}

describe('participantBlockRepository.findBlockState (US-032 / #388)', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('reports no blocks', async () => {
    fake({ data: [], error: null });
    expect(await participantBlockRepository.findBlockState(A, B)).toEqual({ blockedByMe: false, blockedByThem: false });
  });

  it('maps direction from the first participant\'s point of view', async () => {
    fake({ data: [{ blocker_id: A, blocked_id: B }], error: null });
    expect(await participantBlockRepository.findBlockState(A, B)).toEqual({ blockedByMe: true, blockedByThem: false });
    fake({ data: [{ blocker_id: A, blocked_id: B }], error: null });
    expect(await participantBlockRepository.findBlockState(B, A)).toEqual({ blockedByMe: false, blockedByThem: true });
  });

  it('reports a mutual block', async () => {
    fake({ data: [{ blocker_id: A, blocked_id: B }, { blocker_id: B, blocked_id: A }], error: null });
    expect(await participantBlockRepository.findBlockState(A, B)).toEqual({ blockedByMe: true, blockedByThem: true });
  });

  it('queries only the two directions between exactly these two participants', async () => {
    const c = fake({ data: null, error: null });
    await participantBlockRepository.findBlockState(A, B);
    expect(c.from).toHaveBeenCalledWith('participant_blocks');
    expect(c.or).toHaveBeenCalledWith(`and(blocker_id.eq.${A},blocked_id.eq.${B}),and(blocker_id.eq.${B},blocked_id.eq.${A})`);
  });

  it('refuses ids that are not plain uuids (no filter injection) and never queries', async () => {
    const c = fake({ data: [], error: null });
    await expect(participantBlockRepository.findBlockState(`${A},blocker_id.neq.x`, B)).rejects.toThrow();
    await expect(participantBlockRepository.findBlockState(A, 'x)or(y')).rejects.toThrow();
    expect(c.from).not.toHaveBeenCalled();
  });

  it('rethrows database errors', async () => {
    fake({ data: null, error: { message: 'boom' } });
    await expect(participantBlockRepository.findBlockState(A, B)).rejects.toMatchObject({ message: 'boom' });
  });
});

describe('participantBlockRepository.addBlock / removeBlock (#433)', () => {
  beforeEach(() => vi.restoreAllMocks());

  function fakeWrites(result: { error: unknown } = { error: null }) {
    const upsert = vi.fn().mockResolvedValue(result);
    const eq2 = vi.fn().mockResolvedValue(result);
    const eq1 = vi.fn(() => ({ eq: eq2 }));
    const del = vi.fn(() => ({ eq: eq1 }));
    const from = vi.fn(() => ({ upsert, delete: del }));
    vi.mocked(getSupabaseClient).mockReturnValue({ from } as never);
    return { from, upsert, del, eq1, eq2 };
  }

  it('adds a block for exactly this pair, ignoring one that already exists (idempotent)', async () => {
    const c = fakeWrites();
    await participantBlockRepository.addBlock(A, B);
    expect(c.from).toHaveBeenCalledWith('participant_blocks');
    expect(c.upsert).toHaveBeenCalledWith(
      { blocker_id: A, blocked_id: B },
      { onConflict: 'blocker_id,blocked_id', ignoreDuplicates: true }
    );
  });

  it('stores ids in lower case', async () => {
    const c = fakeWrites();
    await participantBlockRepository.addBlock(A.toUpperCase(), B.toUpperCase());
    expect(c.upsert).toHaveBeenCalledWith({ blocker_id: A, blocked_id: B }, expect.anything());
  });

  it('removes only the block the blocker set on the blocked person', async () => {
    const c = fakeWrites();
    await participantBlockRepository.removeBlock(A, B);
    expect(c.from).toHaveBeenCalledWith('participant_blocks');
    expect(c.eq1).toHaveBeenCalledWith('blocker_id', A);
    expect(c.eq2).toHaveBeenCalledWith('blocked_id', B);
  });

  it('refuses ids that are not plain uuids and never queries', async () => {
    const c = fakeWrites();
    await expect(participantBlockRepository.addBlock('x', B)).rejects.toThrow();
    await expect(participantBlockRepository.addBlock(A, 'y')).rejects.toThrow();
    await expect(participantBlockRepository.removeBlock(`${A},blocker_id.neq.z`, B)).rejects.toThrow();
    expect(c.from).not.toHaveBeenCalled();
  });

  it('rethrows database errors', async () => {
    fakeWrites({ error: { message: 'add failed' } });
    await expect(participantBlockRepository.addBlock(A, B)).rejects.toMatchObject({ message: 'add failed' });
    fakeWrites({ error: { message: 'remove failed' } });
    await expect(participantBlockRepository.removeBlock(A, B)).rejects.toMatchObject({ message: 'remove failed' });
  });
});
