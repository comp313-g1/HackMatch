/**
 * US-035 / #406 — reaction and capability API client against the #405 contract.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/authFetch', async () => {
  const actual = await vi.importActual<typeof import('../../config/authFetch')>('../../config/authFetch');
  return { ...actual, authFetch: vi.fn() };
});

import { authFetch } from '../../config/authFetch';
import { ChatApiError, fetchChatCapabilities, normalizeReactionSummaries, setChatMessageReaction } from './chatApi';
import { CHAT_REACTION_CODES } from './chatTypes';

const CHANNEL = '11111111-1111-4111-8111-111111111111';
const TEAM = '22222222-2222-4222-8222-222222222222';
const THREAD = '44444444-4444-4444-8444-444444444444';
const MESSAGE = '33333333-3333-4333-8333-333333333333';

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function okMutation(reaction: string, reactedByMe: boolean, reactions: unknown[] = []): Response {
  return json({ status: 'ok', messageId: MESSAGE, reaction, reactedByMe, changed: true, reactions });
}

describe('setChatMessageReaction (US-035 / #406)', () => {
  beforeEach(() => vi.mocked(authFetch).mockReset());

  it.each([
    [{ kind: 'channel', channelId: CHANNEL } as const, `/api/chat/channels/${CHANNEL}/messages/${MESSAGE}/reactions/heart`],
    [{ kind: 'team', teamId: TEAM } as const, `/api/teams/${TEAM}/chat/messages/${MESSAGE}/reactions/heart`],
    [{ kind: 'directMessage', threadId: THREAD } as const, `/api/direct-messages/threads/${THREAD}/messages/${MESSAGE}/reactions/heart`],
  ])('uses the #405 route for %o: PUT to add, DELETE to remove, with no body or participant id', async (target, path) => {
    vi.mocked(authFetch).mockResolvedValueOnce(okMutation('heart', true, [{ reaction: 'heart', count: 1, reactedByMe: true }]));
    await setChatMessageReaction(target, MESSAGE, 'heart', true);
    vi.mocked(authFetch).mockResolvedValueOnce(okMutation('heart', false));
    await setChatMessageReaction(target, MESSAGE, 'heart', false);

    expect(vi.mocked(authFetch).mock.calls).toEqual([
      [path, { method: 'PUT' }],
      [path, { method: 'DELETE' }],
    ]);
  });

  it('returns the stored aggregate in the approved order with only safe fields', async () => {
    vi.mocked(authFetch).mockResolvedValueOnce(
      okMutation('eyes', true, [
        { reaction: 'eyes', count: 1, reactedByMe: true, participantIds: ['x'] },
        { reaction: 'thumbs_up', count: 3, reactedByMe: false, handles: ['someone'] },
      ])
    );
    const result = await setChatMessageReaction({ kind: 'channel', channelId: CHANNEL }, MESSAGE, 'eyes', true);
    expect(result.reactions).toEqual([
      { reaction: 'thumbs_up', count: 3, reactedByMe: false },
      { reaction: 'eyes', count: 1, reactedByMe: true },
    ]);
  });

  it('rejects responses that do not match the request or contain unknown values', async () => {
    for (const body of [
      { messageId: 'other', reaction: 'heart', reactedByMe: true, changed: true, reactions: [] },
      { messageId: MESSAGE, reaction: 'sad', reactedByMe: true, changed: true, reactions: [] },
      { messageId: MESSAGE, reaction: 'heart', reactedByMe: true, changed: true, reactions: [{ reaction: '🦜', count: 1, reactedByMe: true }] },
      { messageId: MESSAGE, reaction: 'heart', reactedByMe: true, changed: true, reactions: [{ reaction: 'heart', count: 0, reactedByMe: true }] },
    ]) {
      vi.mocked(authFetch).mockResolvedValueOnce(json(body));
      await expect(
        setChatMessageReaction({ kind: 'channel', channelId: CHANNEL }, MESSAGE, 'heart', true)
      ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    }
  });

  it('surfaces Retry-After on a 429 (header first, then body)', async () => {
    vi.mocked(authFetch).mockResolvedValueOnce(
      json({ error: 'Too many reaction changes.', code: 'RATE_LIMITED', retryAfterSeconds: 9 }, 429, { 'Retry-After': '42' })
    );
    const error = await setChatMessageReaction({ kind: 'team', teamId: TEAM }, MESSAGE, 'heart', true).catch((e) => e);
    expect(error).toBeInstanceOf(ChatApiError);
    expect(error).toMatchObject({ status: 429, code: 'RATE_LIMITED', retryAfterSeconds: 42 });

    vi.mocked(authFetch).mockResolvedValueOnce(json({ code: 'RATE_LIMITED', retryAfterSeconds: 7 }, 429));
    await expect(
      setChatMessageReaction({ kind: 'team', teamId: TEAM }, MESSAGE, 'heart', true)
    ).rejects.toMatchObject({ retryAfterSeconds: 7 });
  });

  it('keeps server codes for denials and reports network failures as NETWORK', async () => {
    vi.mocked(authFetch).mockResolvedValueOnce(json({ error: 'x', code: 'DM_BLOCKED_BY_YOU' }, 403));
    await expect(
      setChatMessageReaction({ kind: 'directMessage', threadId: THREAD }, MESSAGE, 'heart', true)
    ).rejects.toMatchObject({ status: 403, code: 'DM_BLOCKED_BY_YOU', retryAfterSeconds: undefined });

    vi.mocked(authFetch).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(
      setChatMessageReaction({ kind: 'directMessage', threadId: THREAD }, MESSAGE, 'heart', true)
    ).rejects.toMatchObject({ status: 0, code: 'NETWORK' });
  });
});

describe('fetchChatCapabilities', () => {
  beforeEach(() => vi.mocked(authFetch).mockReset());

  it('reads reactions, typing, and attachments from the server and never reports unimplemented features', async () => {
    vi.mocked(authFetch).mockResolvedValueOnce(
      json({
        capabilities: {
          reactions: { enabled: true, allowedReactions: [...CHAT_REACTION_CODES, 'custom_parrot'] },
          typing: { enabled: true },
          attachments: { enabled: true },
          voiceVideo: true,
        },
      })
    );
    const capabilities = await fetchChatCapabilities();
    expect(vi.mocked(authFetch)).toHaveBeenCalledWith('/api/chat/capabilities', { method: 'GET' });
    expect(capabilities).toEqual({
      reactions: { enabled: true, allowedReactions: [...CHAT_REACTION_CODES] },
      // #408: typing now follows the server flag (it was hardcoded off in #406).
      typing: { enabled: true },
      // #410: attachments now follows the server flag (it was hardcoded off in #406-#408).
      attachments: { enabled: true },
      voiceVideo: false,
    });
  });

  it('treats anything but an exact true as attachments disabled', async () => {
    for (const attachments of [{ enabled: false }, { enabled: 'true' }, {}, undefined]) {
      vi.mocked(authFetch).mockResolvedValueOnce(json({ capabilities: { reactions: { enabled: false }, attachments } }));
      expect((await fetchChatCapabilities()).attachments).toEqual({ enabled: false });
    }
  });

  it('treats anything but an exact true as typing disabled', async () => {
    for (const typing of [{ enabled: false }, { enabled: 'true' }, {}, undefined]) {
      vi.mocked(authFetch).mockResolvedValueOnce(json({ capabilities: { reactions: { enabled: false }, typing } }));
      expect((await fetchChatCapabilities()).typing).toEqual({ enabled: false });
    }
  });

  it('treats a disabled or malformed answer as no reactions', async () => {
    for (const body of [
      { capabilities: { reactions: { enabled: false } } },
      { capabilities: { reactions: { enabled: 'true', allowedReactions: ['heart'] } } },
      { capabilities: { reactions: { enabled: true, allowedReactions: ['custom_parrot'] } } },
      {},
    ]) {
      vi.mocked(authFetch).mockResolvedValueOnce(json(body));
      expect((await fetchChatCapabilities()).reactions).toEqual({
        enabled: false,
        allowedReactions: expect.any(Array),
      });
    }
  });
});

describe('normalizeReactionSummaries', () => {
  it('rejects duplicates and non-arrays', () => {
    expect(() =>
      normalizeReactionSummaries([
        { reaction: 'heart', count: 1, reactedByMe: true },
        { reaction: 'heart', count: 2, reactedByMe: false },
      ])
    ).toThrow(ChatApiError);
    expect(() => normalizeReactionSummaries(undefined)).toThrow(ChatApiError);
  });
});
