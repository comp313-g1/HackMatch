import { describe, it, expect, vi, afterEach } from 'vitest';
import { AuthRequiredError } from '../../config/authFetch';
import {
  connectNotificationStream,
  parseSseFrames,
  type StreamStatus,
} from './notificationStream';

describe('parseSseFrames', () => {
  it('parses complete frames and keeps the incomplete remainder', () => {
    const { frames, rest } = parseSseFrames(
      'retry: 3000\nevent: ready\ndata: {}\n\nevent: notification\ndata: {"a":1}\n\nevent: noti'
    );
    expect(frames).toEqual([
      { event: 'ready', data: '{}' },
      { event: 'notification', data: '{"a":1}' },
    ]);
    expect(rest).toBe('event: noti');
  });

  it('ignores keep-alive comments and handles CRLF and multi-line data', () => {
    const { frames } = parseSseFrames(': keep-alive\r\n\r\nevent: x\r\ndata: a\r\ndata: b\r\n\r\n');
    expect(frames).toEqual([{ event: 'x', data: 'a\nb' }]);
  });

  it('returns nothing for an empty buffer', () => {
    expect(parseSseFrames('')).toEqual({ frames: [], rest: '' });
  });
});

/** A Response-like object whose body is fed by the test. */
function fakeStreamResponse(status = 200) {
  const queue: Array<{ done: boolean; value?: Uint8Array }> = [];
  let pending: ((r: { done: boolean; value?: Uint8Array }) => void) | null = null;
  const enc = new TextEncoder();
  const push = (r: { done: boolean; value?: Uint8Array }) => {
    if (pending) {
      const p = pending;
      pending = null;
      p(r);
    } else queue.push(r);
  };
  const response = {
    ok: status >= 200 && status < 300,
    status,
    body: {
      getReader: () => ({
        read: () =>
          queue.length ? Promise.resolve(queue.shift()!) : new Promise((r) => (pending = r)),
      }),
    },
  } as unknown as Response;
  return {
    response,
    send: (text: string) => push({ done: false, value: enc.encode(text) }),
    end: () => push({ done: true }),
  };
}

const notificationFrame = (id: string, unread = 1) =>
  `event: notification\ndata: ${JSON.stringify({
    notification: { id, message: `msg ${id}` },
    unreadCount: unread,
  })}\n\n`;

describe('connectNotificationStream (US-021 / #202)', () => {
  const stops: Array<() => void> = [];
  afterEach(() => {
    stops.splice(0).forEach((stop) => stop());
    vi.useRealTimers();
  });

  function setup(responses: Array<ReturnType<typeof fakeStreamResponse> | Error>) {
    const statuses: StreamStatus[] = [];
    const received: Array<{ id: string; unread: number }> = [];
    let call = 0;
    const fetchStream = vi.fn(async () => {
      const next = responses[Math.min(call++, responses.length - 1)];
      if (next instanceof Error) throw next;
      return next.response;
    });
    const stop = connectNotificationStream(
      {
        onStatus: (s) => statuses.push(s),
        onNotification: (e) => received.push({ id: e.notification.id, unread: e.unreadCount }),
      },
      { fetchStream, baseDelayMs: 10, maxDelayMs: 40 }
    );
    stops.push(stop);
    return { statuses, received, fetchStream, stop };
  }

  it('connects, authenticates via the injected fetch, and delivers notifications', async () => {
    const conn = fakeStreamResponse();
    const { statuses, received, fetchStream } = setup([conn]);

    await vi.waitFor(() => expect(statuses).toContain('connected'));
    expect(fetchStream).toHaveBeenCalledWith(
      '/api/notifications/stream',
      expect.objectContaining({ method: 'GET', headers: { Accept: 'text/event-stream' } })
    );

    conn.send('retry: 3000\nevent: ready\ndata: {}\n\n');
    conn.send(notificationFrame('a', 3));
    await vi.waitFor(() => expect(received).toEqual([{ id: 'a', unread: 3 }]));
  });

  it('reassembles frames split across chunks and ignores malformed ones', async () => {
    const conn = fakeStreamResponse();
    const { received } = setup([conn]);
    const frame = notificationFrame('split', 2);

    conn.send('event: notification\ndata: not-json\n\n');
    conn.send(frame.slice(0, 20));
    conn.send(frame.slice(20));

    await vi.waitFor(() => expect(received).toEqual([{ id: 'split', unread: 2 }]));
  });

  it('reconnects with backoff after the connection drops', async () => {
    const first = fakeStreamResponse();
    const second = fakeStreamResponse();
    const { statuses, fetchStream } = setup([first, second]);

    await vi.waitFor(() => expect(statuses).toContain('connected'));
    first.end();

    await vi.waitFor(() => expect(fetchStream).toHaveBeenCalledTimes(2));
    expect(statuses).toContain('reconnecting');
    await vi.waitFor(() => expect(statuses.filter((s) => s === 'connected')).toHaveLength(2));
  });

  it('retries after a network error or 5xx without giving up', async () => {
    const ok = fakeStreamResponse();
    const { statuses, fetchStream } = setup([new TypeError('offline'), fakeStreamResponse(503), ok]);

    await vi.waitFor(() => expect(fetchStream).toHaveBeenCalledTimes(3));
    await vi.waitFor(() => expect(statuses).toContain('connected'));
    expect(statuses).toContain('reconnecting');
  });

  it('reconnects promptly after a planned reconnect frame', async () => {
    const first = fakeStreamResponse();
    const second = fakeStreamResponse();
    const { fetchStream } = setup([first, second]);

    await vi.waitFor(() => expect(fetchStream).toHaveBeenCalledTimes(1));
    first.send('event: reconnect\ndata: {}\n\n');
    first.end();

    await vi.waitFor(() => expect(fetchStream).toHaveBeenCalledTimes(2));
  });

  it.each([403, 404])('stops and reports unavailable on %i so polling takes over', async (status) => {
    const { statuses, fetchStream } = setup([fakeStreamResponse(status)]);
    await vi.waitFor(() => expect(statuses).toContain('unavailable'));
    await new Promise((r) => setTimeout(r, 60));
    expect(fetchStream).toHaveBeenCalledTimes(1);
  });

  it('reports unavailable when the user is not signed in', async () => {
    const { statuses, fetchStream } = setup([new AuthRequiredError()]);
    await vi.waitFor(() => expect(statuses).toContain('unavailable'));
    expect(fetchStream).toHaveBeenCalledTimes(1);
  });

  it('stops reconnecting once stopped', async () => {
    const conn = fakeStreamResponse();
    const { statuses, fetchStream, stop } = setup([conn, fakeStreamResponse()]);
    await vi.waitFor(() => expect(statuses).toContain('connected'));

    stop();
    conn.end();
    await new Promise((r) => setTimeout(r, 80));
    expect(fetchStream).toHaveBeenCalledTimes(1);
  });
});
