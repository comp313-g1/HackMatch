import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchAvailableCandidates } from './availabilityApi';

describe('fetchAvailableCandidates', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns an empty list instead of undefined when the response has no candidates array', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ status: 'ok' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    await expect(fetchAvailableCandidates('token')).resolves.toEqual([]);
  });

  it('returns the candidates when present', async () => {
    const candidates = [{ participantId: 'p-1', displayName: 'Dev', skills: [] }];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ status: 'ok', candidates }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    await expect(fetchAvailableCandidates('token')).resolves.toEqual(candidates);
  });
});
