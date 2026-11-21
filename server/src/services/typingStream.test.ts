/**
 * US-035 / #407 — typing SSE transport: same rules as the notification stream,
 * a separate cap, no event ids or replay, and cleanup on disconnect.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { config } from '../config/index.js';
import { NotificationHub } from './notificationHub.js';
import { openNotificationStream, STREAM_MAX_LIFETIME_MS, STREAM_MAX_PER_PARTICIPANT } from './notificationStream.js';
import { TypingHub, type TypingConversation } from './chatTyping.js';
import { openTypingStream } from './typingStream.js';

const VIEWER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SENDER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CONVERSATION: TypingConversation = {
  conversationType: 'team',
  conversationId: '22222222-2222-4222-8222-222222222222',
};

function fakeConnection() {
  const req = new EventEmitter() as unknown as Request;
  const emitter = new EventEmitter();
  const writes: string[] = [];
  const state: { status?: number; headers: Record<string, string>; ended: boolean; json?: unknown } = {
    headers: {},
    ended: false,
  };
  const res = Object.assign(emitter, {
    status(code: number) {
      state.status = code;
      return res;
    },
    set(headers: Record<string, string>) {
      Object.assign(state.headers, headers);
      return res;
    },
    setHeader(name: string, value: string) {
      state.headers[name] = value;
    },
    json(body: unknown) {
      state.json = body;
    },
    flushHeaders: vi.fn(),
    write(chunk: string) {
      writes.push(chunk);
      return true;
    },
    end() {
      state.ended = true;
      emitter.emit('close');
    },
  }) as unknown as Response;
  return { req, res, writes, state };
}

let hub: TypingHub;
const open = (conn = fakeConnection(), authorize = async () => true) => {
  const opened = openTypingStream(conn.req, conn.res, { participantId: VIEWER, conversation: CONVERSATION, authorize }, { hub });
  return { ...conn, opened };
};

beforeEach(() => {
  hub = new TypingHub();
  config.richChat.typingEnabled = true;
});

afterEach(() => {
  hub._reset();
  vi.useRealTimers();
  config.richChat.typingEnabled = false;
});

describe('openTypingStream', () => {
  it('opens an SSE stream that announces the conversation and expiry, with no event ids', async () => {
    const conn = open();
    expect(conn.opened).toBe(true);
    expect(conn.state.status).toBe(200);
    expect(conn.state.headers['Content-Type']).toBe('text/event-stream; charset=utf-8');
    expect(conn.writes[0]).toContain('retry: 3000');
    expect(conn.writes[0]).toContain('event: ready');
    expect(conn.writes[0]).toContain('"typingExpiryMs":6000');

    await hub.signal({ conversation: CONVERSATION, participantId: SENDER, handle: 'avery', typing: true });
    const typingFrame = conn.writes.find((w) => w.startsWith('event: typing'))!;
    expect(typingFrame).toMatch(/^event: typing\ndata: \{.*\}\n\n$/);
    expect(conn.writes.join('')).not.toMatch(/^id:/m);
  });

  it('caps open typing streams per participant without touching notification streams', () => {
    for (let i = 0; i < STREAM_MAX_PER_PARTICIPANT; i += 1) expect(open().opened).toBe(true);
    const refused = open();
    expect(refused.opened).toBe(false);
    expect(refused.state.status).toBe(429);
    expect(refused.state.json).toMatchObject({ code: 'TOO_MANY_STREAMS' });

    // Notification streams have their own budget.
    const notifications = fakeConnection();
    expect(openNotificationStream(notifications.req, notifications.res, VIEWER, { hub: new NotificationHub() })).toBe(true);
  });

  it('unsubscribes when the client disconnects, and a reconnect gets no earlier typing state', async () => {
    const first = open();
    expect(hub.subscriberCount(CONVERSATION)).toBe(1);
    await hub.signal({ conversation: CONVERSATION, participantId: SENDER, handle: 'avery', typing: true });
    first.req.emit('close');
    expect(hub.subscriberCount(CONVERSATION)).toBe(0);
    expect(hub.streamCount(VIEWER)).toBe(0);

    const second = open();
    expect(second.writes.join('')).not.toContain('event: typing');
  });

  it('rotates after the bounded lifetime so the client re-authenticates', () => {
    vi.useFakeTimers();
    const conn = open();
    vi.advanceTimersByTime(STREAM_MAX_LIFETIME_MS);
    expect(conn.writes.at(-1)).toContain('event: reconnect');
    expect(conn.state.ended).toBe(true);
    expect(hub.subscriberCount(CONVERSATION)).toBe(0);
  });

  it('ends the stream when a delivery-time access check fails', async () => {
    const conn = open(fakeConnection(), async () => false);
    await hub.signal({ conversation: CONVERSATION, participantId: SENDER, handle: 'avery', typing: true });
    expect(conn.state.ended).toBe(true);
    expect(conn.writes.join('')).not.toContain('event: typing');
    expect(hub.subscriberCount(CONVERSATION)).toBe(0);
  });
});
