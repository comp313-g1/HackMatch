import React from 'react';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NotificationBell } from './NotificationBell';
import type { NotificationView } from './notificationTypes';
import type {
  NotificationStreamEvent,
  NotificationStreamHandlers,
  StreamStatus,
} from './notificationStream';

vi.mock('./notificationsApi', async () => {
  const actual = await vi.importActual<typeof import('./notificationsApi')>('./notificationsApi');
  return {
    ...actual,
    listNotifications: vi.fn(),
    markNotificationRead: vi.fn(),
    markAllNotificationsRead: vi.fn(),
  };
});

import { listNotifications } from './notificationsApi';

const NOW = new Date().toISOString();

function make(id: string, message: string): NotificationView {
  return {
    id,
    type: 'team_invitation',
    category: 'invitation',
    message,
    teamId: null,
    eventId: 'e1',
    requestId: null,
    submissionId: null,
    readAt: null,
    createdAt: NOW,
  };
}

const page = (notifications: NotificationView[], unreadCount: number) => ({
  notifications,
  unreadCount,
  nextCursor: null,
});

const liveEvent = (id: string, unreadCount: number): NotificationStreamEvent => ({
  notification: make(id, `Live ${id}`),
  unreadCount,
});

function fakeStream() {
  let handlers: NotificationStreamHandlers | null = null;
  const stop = vi.fn();
  const connect = vi.fn((h: NotificationStreamHandlers) => {
    handlers = h;
    return stop;
  });
  return {
    connect,
    stop,
    status: (s: StreamStatus) => act(() => handlers?.onStatus(s)),
    push: (e: NotificationStreamEvent) => act(() => handlers?.onNotification(e)),
  };
}

describe('NotificationBell live updates and polling fallback (US-021 / #202)', () => {
  const onNavigate = vi.fn();
  let stream: ReturnType<typeof fakeStream>;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(listNotifications).mockResolvedValue(page([], 0));
    stream = fakeStream();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const renderBell = (pollIntervalMs = 0) =>
    render(
      <NotificationBell
        onNavigate={onNavigate}
        pollIntervalMs={pollIntervalMs}
        connectStream={stream.connect}
      />
    );
  const bell = () => screen.getByRole('button', { name: /^notifications,/i });

  it('updates the badge instantly from a pushed notification and announces it', async () => {
    renderBell();
    await waitFor(() => expect(listNotifications).toHaveBeenCalled());
    expect(screen.queryByTestId('notification-badge')).not.toBeInTheDocument();

    await stream.push(liveEvent('L1', 1));

    expect(screen.getByTestId('notification-badge')).toHaveTextContent('1');
    expect(screen.getByTestId('notification-announcer')).toHaveTextContent(
      'New notification: Live L1'
    );
  });

  it('adds a pushed notification to an open list without duplicating it', async () => {
    vi.mocked(listNotifications).mockResolvedValue(page([make('n1', 'Existing invite')], 1));
    renderBell();
    await screen.findByTestId('notification-badge');
    fireEvent.click(bell());
    await screen.findByRole('list', { name: /notification list/i });

    await stream.push(liveEvent('L2', 2));
    expect(await screen.findByText('Live L2')).toBeInTheDocument();
    const items = within(screen.getByRole('list', { name: /notification list/i })).getAllByRole(
      'listitem'
    );
    expect(items[0]).toHaveTextContent('Live L2');

    await stream.push(liveEvent('L2', 2));
    expect(screen.getAllByText('Live L2')).toHaveLength(1);
    expect(screen.getByTestId('notification-badge')).toHaveTextContent('2');
  });

  it('does not poll while the stream is connected', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderBell(1000);
    await stream.status('connected');
    await waitFor(() => expect(listNotifications).toHaveBeenCalled());
    const calls = vi.mocked(listNotifications).mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(vi.mocked(listNotifications).mock.calls.length).toBe(calls);
  });

  it('falls back to polling when the stream is down and shows a note', async () => {
    vi.mocked(listNotifications)
      .mockResolvedValueOnce(page([], 0))
      .mockResolvedValue(page([], 5));
    renderBell(25);
    await stream.status('reconnecting');

    expect(await screen.findByTestId('notification-badge')).toHaveTextContent('5');

    fireEvent.click(bell());
    expect(await screen.findByTestId('live-updates-note')).toHaveTextContent(
      /live updates are unavailable/i
    );
  });

  it('hides the fallback note while connected', async () => {
    renderBell();
    await stream.status('connected');
    fireEvent.click(bell());
    await screen.findByRole('dialog');
    expect(screen.queryByTestId('live-updates-note')).not.toBeInTheDocument();
  });

  it('reconciles with the server every time the stream (re)connects', async () => {
    renderBell();
    await waitFor(() => expect(listNotifications).toHaveBeenCalledTimes(1));

    vi.mocked(listNotifications).mockResolvedValue(page([], 9));
    await stream.status('connected');

    expect(await screen.findByTestId('notification-badge')).toHaveTextContent('9');
  });

  it('refreshes an open list on reconnect so missed alerts appear', async () => {
    vi.mocked(listNotifications).mockResolvedValue(page([make('n1', 'Existing invite')], 1));
    renderBell();
    await screen.findByTestId('notification-badge');
    fireEvent.click(bell());
    await screen.findByRole('list', { name: /notification list/i });

    vi.mocked(listNotifications).mockResolvedValue(
      page([make('n2', 'Missed while offline'), make('n1', 'Existing invite')], 2)
    );
    await stream.status('connected');

    expect(await screen.findByText('Missed while offline')).toBeInTheDocument();
  });

  it('stops the live stream on unmount', async () => {
    const { unmount } = renderBell();
    await waitFor(() => expect(stream.connect).toHaveBeenCalledTimes(1));
    unmount();
    expect(stream.stop).toHaveBeenCalledTimes(1);
  });
});
