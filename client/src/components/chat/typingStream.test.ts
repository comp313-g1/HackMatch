/**
 * US-035 / #408 — typing stream client: routes, ready/expiry handling, event
 * filtering, no history across reconnects, and permanent stop on refusal.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectTypingStream, DEFAULT_TYPING_EXPIRY_MS, type TypingStreamHandlers } from './typingStream';
import type { ChatConversationTarget } from './chatTypes';

const CHANNEL = '11111111-1111-4111-8111-111111111111';
const TEAM = '22222222-2222-4222-8222-222222222222';
const THREAD = '44444444-4444-4444-8444-444444444444';

function controllableResponse() {
  let push!: (text: string) => void;
  let end!: () => void;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      push = (text) => controller.enqueue(encoder.encode(text));
      end = () => controller.close();
    },
  });
  return { response: new Response(body, { status: 200 }), push: (t: string) => push(t), end: () => end() };
}

const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

function handlers(): TypingStreamHandlers & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    onConnected: vi.fn((ms: number) => calls.push(`connected:${ms}`)),
    onTyping: vi.fn((e) => calls.push(`typing:${e.typist.handle}:${e.typing}`)),
    onDisconnected: vi.fn(() => calls.push('disconnected')),
    onUnavailable: vi.fn((code: string) => calls.push(`unavailable:${code}`)),
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
let stops: Array<() => void> = [];
afterEach(() => {
  stops.forEach((stop) => stop());
  stops = [];
  vi.useRealTimers();
});

describe('connectTypingStream (US-035 / #408)', () => {
  it.each([
    [{ kind: 'channel', channelId: CHANNEL } as const, `/api/chat/channels/${CHANNEL}/typing/stream`],
    [{ kind: 'team', teamId: TEAM } as const, `/api/teams/${TEAM}/chat/typing/stream`],
    [{ kind: 'directMessage', threadId: THREAD } as const, `/api/direct-messages/threads/${THREAD}/typing/stream`],
  ])('opens the #407 stream route for %o with an abort signal', async (target, path) => {
    const stream = controllableResponse();
    const fetchStream = vi.fn().mockResolvedValue(stream.response);
    stops.push(connectTypingStream(target, handlers(), { fetchStream }));
    await flush();
    expect(fetchStream).toHaveBeenCalledWith(path, expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) }));
    expect(path).not.toMatch(/\?/);
  });

  it('uses the server-provided typingExpiryMs, falling back to 6000 for a malformed ready event', async () => {
    const good = controllableResponse();
    const h1 = handlers();
    stops.push(connectTypingStream({ kind: 'channel', channelId: CHANNEL }, h1, { fetchStream: async () => good.response }));
    await flush();
    good.push(frame('ready', { typingExpiryMs: 4000 }));
    await vi.waitFor(() => expect(h1.onConnected).toHaveBeenCalledWith(4000));

    const bad = controllableResponse();
    const h2 = handlers();
    stops.push(connectTypingStream({ kind: 'channel', channelId: CHANNEL }, h2, { fetchStream: async () => bad.response }));
    await flush();
    bad.push(frame('ready', { typingExpiryMs: 'soon' }));
    await vi.waitFor(() => expect(h2.onConnected).toHaveBeenCalledWith(DEFAULT_TYPING_EXPIRY_MS));
    expect(DEFAULT_TYPING_EXPIRY_MS).toBe(6000);
  });

  it('passes only well-formed events for exactly this conversation', async () => {
    const stream = controllableResponse();
    const h = handlers();
    const target: ChatConversationTarget = { kind: 'team', teamId: TEAM };
    stops.push(connectTypingStream(target, h, { fetchStream: async () => stream.response }));
    await flush();
    stream.push(frame('ready', { typingExpiryMs: 6000 }));
    stream.push(frame('typing', { conversationType: 'team', conversationId: TEAM.toUpperCase(), typist: { handle: 'avery' }, typing: true }));
    stream.push(frame('typing', { conversationType: 'team', conversationId: 'other', typist: { handle: 'x' }, typing: true }));
    stream.push(frame('typing', { conversationType: 'channel', conversationId: TEAM, typist: { handle: 'y' }, typing: true }));
    stream.push(frame('typing', { conversationType: 'team', conversationId: TEAM, typist: {}, typing: true }));
    stream.push('event: typing\ndata: not json\n\n');
    stream.push(frame('typing', { conversationType: 'team', conversationId: TEAM, typist: { handle: 'avery' }, typing: false }));
    await vi.waitFor(() => expect(h.calls).toEqual(['connected:6000', 'typing:avery:true', 'typing:avery:false']));
  });

  it('starts every reconnection empty (planned rotation) and keeps a single connection', async () => {
    const first = controllableResponse();
    const second = controllableResponse();
    const fetchStream = vi.fn().mockResolvedValueOnce(first.response).mockResolvedValueOnce(second.response);
    const h = handlers();
    stops.push(connectTypingStream({ kind: 'channel', channelId: CHANNEL }, h, { fetchStream }));
    await flush();
    first.push(frame('ready', { typingExpiryMs: 6000 }));
    first.push(frame('reconnect', {}));
    first.end();
    await vi.waitFor(() => expect(fetchStream).toHaveBeenCalledTimes(2), { timeout: 2000 });
    second.push(frame('ready', { typingExpiryMs: 6000 }));
    await vi.waitFor(() => expect(h.calls).toEqual(['connected:6000', 'disconnected', 'connected:6000']));
  });

  it('backs off after a failure instead of hammering the server', async () => {
    const fetchStream = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const h = handlers();
    stops.push(connectTypingStream({ kind: 'channel', channelId: CHANNEL }, h, { fetchStream, baseDelayMs: 50, maxDelayMs: 50 }));
    await vi.waitFor(() => expect(fetchStream.mock.calls.length).toBeGreaterThanOrEqual(2), { timeout: 2000 });
    expect(h.onDisconnected).toHaveBeenCalled();
    expect(h.onUnavailable).not.toHaveBeenCalled();
  });

  it.each([
    [404, 'FEATURE_DISABLED'],
    [403, 'FORBIDDEN_NOT_TEAM_MEMBER'],
    [401, 'UNAUTHORIZED'],
  ])('stops for good on %i %s and never retries', async (status, code) => {
    const fetchStream = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code }), { status }));
    const h = handlers();
    stops.push(connectTypingStream({ kind: 'team', teamId: TEAM }, h, { fetchStream, baseDelayMs: 1 }));
    await vi.waitFor(() => expect(h.onUnavailable).toHaveBeenCalledWith(code));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fetchStream).toHaveBeenCalledTimes(1);
  });

  it('aborts the request and delivers nothing after stop', async () => {
    const stream = controllableResponse();
    let signal: AbortSignal | undefined;
    const h = handlers();
    const stop = connectTypingStream({ kind: 'channel', channelId: CHANNEL }, h, {
      fetchStream: async (_path, init) => {
        signal = init.signal ?? undefined;
        return stream.response;
      },
    });
    await flush();
    stream.push(frame('ready', { typingExpiryMs: 6000 }));
    await vi.waitFor(() => expect(h.onConnected).toHaveBeenCalled());
    stop();
    expect(signal?.aborted).toBe(true);
    stream.push(frame('typing', { conversationType: 'channel', conversationId: CHANNEL, typist: { handle: 'late' }, typing: true }));
    await flush();
    expect(h.onTyping).not.toHaveBeenCalled();
  });
});
