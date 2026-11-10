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
