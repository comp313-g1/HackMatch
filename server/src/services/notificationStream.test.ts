import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { NotificationHub, type NotificationEvent } from './notificationHub.js';
import {
  STREAM_RETRY_MS,
  formatSseEvent,
  openNotificationStream,
} from './notificationStream.js';

const ME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

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

function event(id: string): NotificationEvent {
  return {
    notification: {
      id,
      type: 'team_invitation',
      category: 'invitation',
      message: 'hi',
      teamId: null,
      eventId: null,
      requestId: null,
      submissionId: null,
      readAt: null,
      createdAt: '2026-11-03T10:00:00Z',
    },
    unreadCount: 3,
  };
}

describe('notificationStream (US-021 / #202)', () => {
  let hub: NotificationHub;

  beforeEach(() => {
    vi.useFakeTimers();
    hub = new NotificationHub();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('formats SSE events', () => {
    expect(formatSseEvent('x', { a: 1 })).toBe('event: x\ndata: {"a":1}\n\n');
  });

  it('opens an event-stream with a retry hint and ready event', () => {
    const { req, res, writes, state } = fakeConnection();
    expect(openNotificationStream(req, res, ME, { hub })).toBe(true);

    expect(state.status).toBe(200);
    expect(state.headers['Content-Type']).toContain('text/event-stream');
    expect(state.headers['Cache-Control']).toContain('no-cache');
    expect(state.headers['X-Accel-Buffering']).toBe('no');
    expect(res.flushHeaders).toHaveBeenCalled();
    expect(writes[0]).toBe(`retry: ${STREAM_RETRY_MS}\nevent: ready\ndata: {}\n\n`);
    expect(hub.subscriberCount(ME)).toBe(1);
  });

  it('delivers only the participant\'s own notifications', () => {
    const { req, res, writes } = fakeConnection();
    openNotificationStream(req, res, ME, { hub });

    hub.publish(ME, event('mine'));
    hub.publish(OTHER, event('theirs'));

    const joined = writes.join('');
    expect(joined).toContain('event: notification');
    expect(joined).toContain('"id":"mine"');
    expect(joined).not.toContain('theirs');
  });

  it('sends keep-alive comments', () => {
    const { req, res, writes } = fakeConnection();
    openNotificationStream(req, res, ME, { hub, heartbeatMs: 1000 });
    vi.advanceTimersByTime(2500);
    expect(writes.filter((w) => w === ': keep-alive\n\n')).toHaveLength(2);
  });

  it('unsubscribes and stops timers when the client disconnects', () => {
    const { req, res, writes } = fakeConnection();
    openNotificationStream(req, res, ME, { hub, heartbeatMs: 1000 });
    (req as unknown as EventEmitter).emit('close');

    expect(hub.subscriberCount(ME)).toBe(0);
    const before = writes.length;
    vi.advanceTimersByTime(5000);
    hub.publish(ME, event('late'));
    expect(writes).toHaveLength(before);
  });

  it('rotates the stream after its max lifetime so the client re-authenticates', () => {
    const { req, res, writes, state } = fakeConnection();
    openNotificationStream(req, res, ME, { hub, maxLifetimeMs: 5000, heartbeatMs: 100000 });

    vi.advanceTimersByTime(5000);

    expect(writes.join('')).toContain('event: reconnect');
    expect(state.ended).toBe(true);
    expect(hub.subscriberCount(ME)).toBe(0);
  });

  it('rejects with 429 once the per-participant cap is reached', () => {
    for (let i = 0; i < 2; i++) {
      const c = fakeConnection();
      expect(openNotificationStream(c.req, c.res, ME, { hub, maxPerParticipant: 2 })).toBe(true);
    }
    const extra = fakeConnection();
    expect(openNotificationStream(extra.req, extra.res, ME, { hub, maxPerParticipant: 2 })).toBe(false);

    expect(extra.state.status).toBe(429);
    expect(extra.state.json).toMatchObject({ code: 'TOO_MANY_STREAMS' });
    expect(extra.writes).toHaveLength(0);
    expect(hub.subscriberCount(ME)).toBe(2);
    // A different account is unaffected by this one's cap.
    const other = fakeConnection();
    expect(openNotificationStream(other.req, other.res, OTHER, { hub, maxPerParticipant: 2 })).toBe(true);
  });
});
