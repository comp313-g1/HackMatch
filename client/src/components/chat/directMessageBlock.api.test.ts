import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthRequiredError } from '../../config/authFetch';
import { ChatApiError, blockDirectMessageParticipant, unblockDirectMessageParticipant } from './chatApi';

vi.mock('../../config/authFetch', async () => {
  const actual = await vi.importActual<typeof import('../../config/authFetch')>('../../config/authFetch');
  return { ...actual, authFetch: vi.fn() };
});

import { authFetch } from '../../config/authFetch';

const PEER = '22222222-2222-4222-8222-222222222222';
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('block and unblock API calls (#433)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('blocks with PUT on the participant and resolves to true', async () => {
    vi.mocked(authFetch).mockResolvedValue(json({ status: 'ok', youBlockedPeer: true }));
    await expect(blockDirectMessageParticipant(PEER)).resolves.toBe(true);
    expect(authFetch).toHaveBeenCalledTimes(1);
    expect(authFetch).toHaveBeenCalledWith(`/api/direct-messages/blocks/${PEER}`, expect.objectContaining({ method: 'PUT' }));
  });

  it('unblocks with DELETE on the participant and resolves to false', async () => {
    vi.mocked(authFetch).mockResolvedValue(json({ status: 'ok', youBlockedPeer: false }));
    await expect(unblockDirectMessageParticipant(PEER)).resolves.toBe(false);
    expect(authFetch).toHaveBeenCalledWith(`/api/direct-messages/blocks/${PEER}`, expect.objectContaining({ method: 'DELETE' }));
  });

  it('encodes the participant id in the path', async () => {
    vi.mocked(authFetch).mockResolvedValue(json({ youBlockedPeer: true }));
    await blockDirectMessageParticipant('a/b c');
    expect(authFetch).toHaveBeenCalledWith('/api/direct-messages/blocks/a%2Fb%20c', expect.anything());
  });

  it('turns a "not available" answer into an error carrying the status and code', async () => {
    vi.mocked(authFetch).mockResolvedValue(
      json({ error: 'That participant is not available.', code: 'PEER_NOT_AVAILABLE' }, 404)
    );
    await expect(blockDirectMessageParticipant(PEER)).rejects.toMatchObject({
      name: 'ChatApiError',
      status: 404,
      code: 'PEER_NOT_AVAILABLE',
      message: 'That participant is not available.',
    });
  });

  it('rejects an answer that does not say whether you now block them', async () => {
    vi.mocked(authFetch).mockResolvedValue(json({ status: 'ok' }));
    const failure = await blockDirectMessageParticipant(PEER).catch((e) => e);
    expect(failure).toBeInstanceOf(ChatApiError);
    expect(failure).toMatchObject({ status: 502, code: 'INVALID_RESPONSE', message: 'Could not block this participant. Please try again.' });

    vi.mocked(authFetch).mockResolvedValue(json({ youBlockedPeer: 'yes' }));
    const other = await unblockDirectMessageParticipant(PEER).catch((e) => e);
    expect(other).toMatchObject({ code: 'INVALID_RESPONSE', message: 'Could not unblock this participant. Please try again.' });
  });

  it('passes a sign-in requirement through unchanged', async () => {
    vi.mocked(authFetch).mockRejectedValue(new AuthRequiredError());
    await expect(blockDirectMessageParticipant(PEER)).rejects.toBeInstanceOf(AuthRequiredError);
    await expect(unblockDirectMessageParticipant(PEER)).rejects.toBeInstanceOf(AuthRequiredError);
  });

  it('reports a network failure with a retry message', async () => {
    vi.mocked(authFetch).mockRejectedValue(new Error('offline'));
    await expect(unblockDirectMessageParticipant(PEER)).rejects.toMatchObject({
      status: 0,
      code: 'NETWORK',
      message: 'Network error. Please try again.',
    });
  });
});
