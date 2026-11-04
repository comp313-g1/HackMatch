/**
 * US-021 / #204 — client integration: real NotificationBell + real notificationsApi +
 * real SSE parser/reconnect logic. Only the network (authFetch) is replaced, by a fake
 * backend that mimics the Express API contract (list / mark-read / read-all / stream).
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NotificationBell } from './NotificationBell';
import type { NotificationView } from './notificationTypes';

vi.mock('../../config/authFetch', async () => {
  const actual = await vi.importActual<typeof import('../../config/authFetch')>(
    '../../config/authFetch'
  );
  return { ...actual, authFetch: vi.fn() };
});

import { authFetch } from '../../config/authFetch';

const NOW = new Date().toISOString();

function item(id: string, overrides: Partial<NotificationView> = {}): NotificationView {
  return {
    id,
    type: 'team_invitation',
    category: 'invitation',
    message: `Message ${id}`,
    teamId: 't1',
    eventId: 'e1',
    requestId: null,
    submissionId: null,
    readAt: null,
    createdAt: NOW,
    ...overrides,
  };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** Fake Express backend + controllable SSE connection. */
function createBackend(initial: NotificationView[] = []) {
  const items = [...initial];
  const calls: Array<{ method: string; path: string }> = [];
  const enc = new TextEncoder();
  const behavior = {
    listStatus: 200 as number | 'network',
    markStatus: 200,
    markAllStatus: 200,
    streamStatus: 200,
  };

  // --- SSE plumbing
  let queue: Array<{ done: boolean; value?: Uint8Array }> = [];
  let waiter: ((r: { done: boolean; value?: Uint8Array }) => void) | null = null;
  const feed = (r: { done: boolean; value?: Uint8Array }) => {
    if (waiter) {
      const w = waiter;
      waiter = null;
      w(r);
    } else queue.push(r);
  };

  const unread = () => items.filter((n) => !n.readAt).length;

  const handler = async (path: string, init: RequestInit = {}): Promise<Response> => {
    const method = (init.method ?? 'GET').toUpperCase();
    calls.push({ method, path });

    if (path === '/api/notifications/stream') {
      if (behavior.streamStatus !== 200) {
        return json({ error: 'nope', code: 'X' }, behavior.streamStatus);
      }
      queue = [];
      return {
        ok: true,
        status: 200,
        body: {
          getReader: () => ({
            read: () =>
              queue.length
                ? Promise.resolve(queue.shift()!)
                : new Promise((resolve) => {
                    waiter = resolve;
                  }),
          }),
        },
      } as unknown as Response;
    }

    if (method === 'GET' && path.startsWith('/api/notifications')) {
      if (behavior.listStatus === 'network') throw new TypeError('Failed to fetch');
      if (behavior.listStatus !== 200) {
        return json({ error: 'denied', code: 'DENIED' }, behavior.listStatus);
      }
      const url = new URL(path, 'http://x');
      const limit = Number(url.searchParams.get('limit') ?? 20);
      const start = Number(url.searchParams.get('cursor') ?? 0);
      const slice = items.slice(start, start + limit);
      const next = start + limit < items.length ? String(start + limit) : null;
      return json({ status: 'ok', notifications: slice, unreadCount: unread(), nextCursor: next });
    }

    const readMatch = path.match(/^\/api\/notifications\/([^/]+)\/read$/);
    if (method === 'PATCH' && readMatch) {
      if (behavior.markStatus !== 200) {
        return json({ error: 'Notification not found.', code: 'NOTIFICATION_NOT_FOUND' }, behavior.markStatus);
      }
      const row = items.find((n) => n.id === decodeURIComponent(readMatch[1]));
      if (!row) return json({ error: 'Notification not found.', code: 'NOTIFICATION_NOT_FOUND' }, 404);
      const alreadyRead = !!row.readAt;
      row.readAt = row.readAt ?? new Date().toISOString();
      return json({ status: 'ok', notification: row, alreadyRead, unreadCount: unread() });
    }

    if (method === 'POST' && path === '/api/notifications/read-all') {
      if (behavior.markAllStatus !== 200) return json({ error: 'boom', code: 'UNKNOWN' }, behavior.markAllStatus);
      let markedCount = 0;
      for (const n of items) {
        if (!n.readAt) {
          n.readAt = new Date().toISOString();
          markedCount += 1;
        }
      }
      return json({ status: 'ok', markedCount, unreadCount: 0 });
    }
    return json({ error: 'Not Found' }, 404);
  };

  return {
    items,
    calls,
    behavior,
    handler,
    /** Server creates a notification and pushes it over the stream. */
    create: (n: NotificationView) => {
      items.unshift(n);
      feed({
        done: false,
        value: enc.encode(
          `event: notification\ndata: ${JSON.stringify({ notification: n, unreadCount: unread() })}\n\n`
        ),
      });
    },
    /** Server creates a notification WITHOUT pushing (stream is down). */
    createSilently: (n: NotificationView) => {
      items.unshift(n);
    },
    dropStream: () => feed({ done: true }),
    count: (method: string, pathPart: string) =>
      calls.filter((c) => c.method === method && c.path.includes(pathPart)).length,
  };
}

describe('NotificationBell end to end against the API contract (US-021 / #204)', () => {
  const onNavigate = vi.fn();
  let backend: ReturnType<typeof createBackend>;

  const setup = (
    initial: NotificationView[] = [],
    pollIntervalMs = 0,
    configure?: (b: ReturnType<typeof createBackend>) => void
  ) => {
    backend = createBackend(initial);
    configure?.(backend); // before render: the stream connects during mount
    vi.mocked(authFetch).mockImplementation((input, init) =>
      backend.handler(String(input), init as RequestInit)
    );
    return render(<NotificationBell onNavigate={onNavigate} pollIntervalMs={pollIntervalMs} />);
  };

  const bell = () => screen.getByRole('button', { name: /^notifications,/i });
  const open = async () => {
    fireEvent.click(bell());
    return screen.findByRole('dialog', { name: /notifications/i });
  };

  beforeEach(() => {
    vi.mocked(authFetch).mockReset();
    onNavigate.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // ---------------------------------------------------------------- happy path
  it('shows the unread badge from the server, then the typed feed with destination hints', async () => {
    setup([
      item('n1', { message: 'You were invited to Team Rocket' }),
      item('n2', {
        type: 'team_application_approved',
        category: 'decision',
        message: 'Your application was approved',
      }),
      item('n3', { type: 'TEAM_ROSTER_LOCKED', category: 'roster', message: 'Roster is final', readAt: NOW }),
    ]);

    expect(await screen.findByTestId('notification-badge')).toHaveTextContent('2');
    expect(backend.calls.some((c) => c.path === '/api/notifications?limit=1')).toBe(true);

    const dialog = await open();
    const list = await within(dialog).findByRole('list', { name: /notification list/i });
    expect(within(list).getByText('Invitation')).toBeInTheDocument();
    expect(within(list).getByText('Application approved')).toBeInTheDocument();
    expect(within(list).getByText('Roster locked')).toBeInTheDocument();
    expect(within(list).getByText('Opens Requests › Invitations')).toBeInTheDocument();
    expect(within(list).getAllByText('Unread')).toHaveLength(2);
    expect(backend.calls).toContainEqual({ method: 'GET', path: '/api/notifications?limit=20' });
  });

  it('empty state: a user with no notifications sees a clear message and no badge', async () => {
    setup([]);
    await waitFor(() => expect(backend.calls.length).toBeGreaterThan(0));
    expect(screen.queryByTestId('notification-badge')).not.toBeInTheDocument();
    await open();
    expect(await screen.findByText(/you.re all caught up/i)).toBeInTheDocument();
  });

  // --------------------------------------------------------------- live creation
  it('a notification created on the server appears live in the badge and the open list', async () => {
    setup([item('n1', { message: 'Existing alert' })]);
    await screen.findByTestId('notification-badge');
    await open();
    await screen.findByText('Existing alert');
    await waitFor(() => expect(backend.count('GET', '/stream')).toBe(1));

    act(() => backend.create(item('live1', { message: 'Brand new application', category: 'application', type: 'team_application_submitted' })));

    expect(await screen.findByText('Brand new application')).toBeInTheDocument();
    expect(screen.getByTestId('notification-badge')).toHaveTextContent('2');
    expect(screen.getByTestId('notification-announcer')).toHaveTextContent('New notification: Brand new application');
    const rows = within(screen.getByRole('list', { name: /notification list/i })).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Brand new application');
  });

  it('reconnects after the stream drops and reconciles alerts missed in the gap', async () => {
    setup([item('n1')]);
    await screen.findByTestId('notification-badge');
    await waitFor(() => expect(backend.count('GET', '/stream')).toBe(1));

    backend.createSilently(item('missed', { message: 'Arrived while offline' }));
    act(() => backend.dropStream());

    await waitFor(() => expect(backend.count('GET', '/stream')).toBe(2), { timeout: 4000 });
    await waitFor(() => expect(screen.getByTestId('notification-badge')).toHaveTextContent('2'));
  });

  // ------------------------------------------------------------------- reading
  it('marks one notification read: PATCH is sent, the dot clears, the badge drops', async () => {
    setup([item('n1', { message: 'First' }), item('n2', { message: 'Second' })]);
    await screen.findByTestId('notification-badge');
    await open();
    await screen.findByText('First');

    fireEvent.click(screen.getByRole('button', { name: /mark as read: first/i }));

    await waitFor(() => expect(screen.getByTestId('notification-badge')).toHaveTextContent('1'));
    expect(backend.calls).toContainEqual({ method: 'PATCH', path: '/api/notifications/n1/read' });
    expect(backend.items.find((n) => n.id === 'n1')!.readAt).toBeTruthy();
    expect(screen.getAllByText('Unread')).toHaveLength(1);
  });

  it('marks all read: POST is sent and the badge disappears', async () => {
    setup([item('n1'), item('n2'), item('n3')]);
    await screen.findByTestId('notification-badge');
    await open();
    await screen.findByText('Message n1');

    fireEvent.click(screen.getByRole('button', { name: /mark all as read/i }));

    await waitFor(() => expect(screen.queryByTestId('notification-badge')).not.toBeInTheDocument());
    expect(backend.count('POST', '/read-all')).toBe(1);
    expect(screen.queryByText('Unread')).not.toBeInTheDocument();
  });

  it('clicking a notification navigates to its action view and marks it read', async () => {
    setup([item('n1', { message: 'Join Team Rocket?' })]);
    await screen.findByTestId('notification-badge');
    await open();

    fireEvent.click(await screen.findByText('Join Team Rocket?'));

    expect(onNavigate).toHaveBeenCalledWith(
      { kind: 'requests', tab: 'invitations' },
      expect.objectContaining({ id: 'n1' })
    );
    await waitFor(() => expect(backend.count('PATCH', '/n1/read')).toBe(1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  // ----------------------------------------------------------------- boundaries
  it('caps the badge at 99+ and pages older alerts with the server-issued cursor', async () => {
    const many = Array.from({ length: 120 }, (_, i) => item(`m${i}`, { message: `Alert ${i}` }));
    setup(many);

    expect(await screen.findByTestId('notification-badge')).toHaveTextContent('99+');
    await open();
    await screen.findByText('Alert 0');
    expect(screen.queryByText('Alert 20')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /load older notifications/i }));

    expect(await screen.findByText('Alert 20')).toBeInTheDocument();
    expect(backend.calls).toContainEqual({ method: 'GET', path: '/api/notifications?limit=20&cursor=20' });
    expect(screen.getAllByText(/^Alert 0$/)).toHaveLength(1);
  });

  // --------------------------------------------------- unauthorized + failures
  it.each([
    [401, /session has expired/i],
    [403, /not available for this account/i],
  ])('permission state: a %i from the server is shown as an explicit message', async (status, message) => {
    setup([item('n1')]);
    await screen.findByTestId('notification-badge');
    backend.behavior.listStatus = status;

    await open();

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.queryByText('Message n1')).not.toBeInTheDocument();
  });

  it('network failure on load shows retry, and retry succeeds once the server is back', async () => {
    setup([item('n1', { message: 'Recovered alert' })]);
    await screen.findByTestId('notification-badge');
    backend.behavior.listStatus = 'network';

    await open();
    expect(await screen.findByRole('alert')).toHaveTextContent(/network error/i);

    backend.behavior.listStatus = 200;
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText('Recovered alert')).toBeInTheDocument();
  });

  it('a failed mark-read reverts the optimistic change and keeps the data', async () => {
    setup([item('n1', { message: 'Keep me unread' })]);
    await screen.findByTestId('notification-badge');
    await open();
    await screen.findByText('Keep me unread');
    backend.behavior.markStatus = 500;

    fireEvent.click(screen.getByRole('button', { name: /mark as read: keep me unread/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByTestId('notification-badge')).toHaveTextContent('1');
    expect(screen.getByText('Unread')).toBeInTheDocument();
    expect(backend.items[0].readAt).toBeNull();
  });

  it('a failed mark-all keeps every item unread and the badge unchanged', async () => {
    setup([item('n1'), item('n2')]);
    await screen.findByTestId('notification-badge');
    await open();
    await screen.findByText('Message n1');
    backend.behavior.markAllStatus = 500;

    fireEvent.click(screen.getByRole('button', { name: /mark all as read/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not mark all/i);
    expect(screen.getByTestId('notification-badge')).toHaveTextContent('2');
    expect(screen.getAllByText('Unread')).toHaveLength(2);
  });

  it('falls back to polling when the live stream is unavailable and still shows new alerts', async () => {
    // 404: an older server without the stream endpoint
    setup([item('n1')], 40, (b) => {
      b.behavior.streamStatus = 404;
    });
    await screen.findByTestId('notification-badge');
    expect(screen.getByTestId('notification-badge')).toHaveTextContent('1');

    backend.createSilently(item('polled', { message: 'Found by polling' }));

    await waitFor(() => expect(screen.getByTestId('notification-badge')).toHaveTextContent('2'));
    await open();
    expect(await screen.findByTestId('live-updates-note')).toHaveTextContent(/live updates are unavailable/i);
    expect(await screen.findByText('Found by polling')).toBeInTheDocument();
  });
});
