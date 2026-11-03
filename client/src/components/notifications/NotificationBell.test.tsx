import React from 'react';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationBell } from './NotificationBell';
import { NotificationsApiError } from './notificationsApi';
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

import { listNotifications, markAllNotificationsRead, markNotificationRead } from './notificationsApi';

const NOW = new Date().toISOString();

function make(overrides: Partial<NotificationView> & { id: string }): NotificationView {
  return {
    type: 'team_invitation',
    category: 'invitation',
    message: `Message ${overrides.id}`,
    teamId: null,
    eventId: 'e1',
    requestId: null,
    submissionId: null,
    readAt: null,
    createdAt: NOW,
    ...overrides,
  };
}

const invitation = make({ id: 'n1', message: 'You received an invitation to Team Rocket' });
const decision = make({
  id: 'n2',
  type: 'team_application_approved',
  category: 'decision',
  message: 'Your application was approved',
});
const read = make({
  id: 'n3',
  type: 'TEAM_ROSTER_LOCKED',
  category: 'roster',
  message: 'Your team roster is now final',
  readAt: NOW,
});

const page = (notifications: NotificationView[], unreadCount: number, nextCursor: string | null = null) => ({
  notifications,
  unreadCount,
  nextCursor,
});

/** Controllable stand-in for the live stream. */
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

describe('NotificationBell (US-021 / #200)', () => {
  const onNavigate = vi.fn();
  let stream: ReturnType<typeof fakeStream>;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(listNotifications).mockResolvedValue(page([], 0));
    stream = fakeStream();
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

  it('shows no badge when there are no unread notifications', async () => {
    renderBell();
    await waitFor(() => expect(listNotifications).toHaveBeenCalled());
    expect(bell()).toHaveAccessibleName('Notifications, no unread');
    expect(screen.queryByTestId('notification-badge')).not.toBeInTheDocument();
  });

  it('shows the unread badge count and exposes it to assistive tech', async () => {
    vi.mocked(listNotifications).mockResolvedValue(page([], 3));
    renderBell();
    expect(await screen.findByTestId('notification-badge')).toHaveTextContent('3');
    expect(bell()).toHaveAccessibleName('Notifications, 3 unread');
  });

  it('caps the badge at 99+', async () => {
    vi.mocked(listNotifications).mockResolvedValue(page([], 250));
    renderBell();
    expect(await screen.findByTestId('notification-badge')).toHaveTextContent('99+');
  });

  it('keeps the last badge value when a background refresh fails', async () => {
    vi.mocked(listNotifications).mockResolvedValueOnce(page([], 2));
    vi.mocked(listNotifications).mockRejectedValue(new NotificationsApiError(0, 'NETWORK'));
    renderBell(20);
    expect(await screen.findByTestId('notification-badge')).toHaveTextContent('2');
    await waitFor(() => expect(vi.mocked(listNotifications).mock.calls.length).toBeGreaterThan(2));
    expect(screen.getByTestId('notification-badge')).toHaveTextContent('2');
  });

  it('shows a loading state, then the feed with distinct type labels', async () => {
    let resolve!: (v: ReturnType<typeof page>) => void;
    vi.mocked(listNotifications)
      .mockResolvedValueOnce(page([], 2))
      .mockReturnValueOnce(new Promise((r) => (resolve = r)));
    renderBell();
    await screen.findByTestId('notification-badge');

    fireEvent.click(bell());
    expect(await screen.findByRole('status')).toHaveTextContent(/loading notifications/i);

    resolve(page([invitation, decision, read], 2));
    const list = await screen.findByRole('list', { name: /notification list/i });
    expect(within(list).getByText('Invitation')).toBeInTheDocument();
    expect(within(list).getByText('Application approved')).toBeInTheDocument();
    expect(within(list).getByText('Roster locked')).toBeInTheDocument();
    expect(within(list).getByText('Opens Requests › Invitations')).toBeInTheDocument();
    expect(within(list).getByText('Opens Requests › Applications')).toBeInTheDocument();
    expect(within(list).getByText('Opens your team')).toBeInTheDocument();
    expect(within(list).getAllByText('Unread')).toHaveLength(2);
  });

  it('shows an empty state when there are no notifications', async () => {
    renderBell();
    fireEvent.click(bell());
    expect(await screen.findByText(/you.re all caught up/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /mark all as read/i })).toBeDisabled();
  });

  it('shows an error with retry when loading fails, then recovers', async () => {
    vi.mocked(listNotifications)
      .mockResolvedValueOnce(page([], 0))
      .mockRejectedValueOnce(new NotificationsApiError(0, 'NETWORK'))
      .mockResolvedValueOnce(page([invitation], 1));
    renderBell();
    await waitFor(() => expect(listNotifications).toHaveBeenCalledTimes(1));

    fireEvent.click(bell());
    expect(await screen.findByRole('alert')).toHaveTextContent(/network error/i);

    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText(/invitation to team rocket/i)).toBeInTheDocument();
  });

  it('maps 403 to a clear message', async () => {
    vi.mocked(listNotifications)
      .mockResolvedValueOnce(page([], 0))
      .mockRejectedValueOnce(new NotificationsApiError(403, 'FORBIDDEN'));
    renderBell();
    await waitFor(() => expect(listNotifications).toHaveBeenCalledTimes(1));
    fireEvent.click(bell());
    expect(await screen.findByRole('alert')).toHaveTextContent(/not available for this account/i);
  });

  it('marks one notification read from its button and updates the badge', async () => {
    vi.mocked(listNotifications).mockResolvedValue(page([invitation, decision], 2));
    vi.mocked(markNotificationRead).mockResolvedValue({
      notification: { ...invitation, readAt: NOW },
      alreadyRead: false,
      unreadCount: 1,
    });
    renderBell();
    await screen.findByTestId('notification-badge');
    fireEvent.click(bell());
    await screen.findByRole('list', { name: /notification list/i });

    fireEvent.click(screen.getByRole('button', { name: /mark as read: you received an invitation/i }));

    await waitFor(() => expect(screen.getByTestId('notification-badge')).toHaveTextContent('1'));
    expect(markNotificationRead).toHaveBeenCalledWith('n1');
    expect(onNavigate).not.toHaveBeenCalled();
    expect(screen.getAllByText('Unread')).toHaveLength(1);
  });

  it('reverts the optimistic read and shows an error when marking fails', async () => {
    vi.mocked(listNotifications).mockResolvedValue(page([invitation], 1));
    vi.mocked(markNotificationRead).mockRejectedValue(new NotificationsApiError(500, 'UNKNOWN_ERROR'));
    renderBell();
    await screen.findByTestId('notification-badge');
    fireEvent.click(bell());
    await screen.findByRole('list', { name: /notification list/i });

    fireEvent.click(screen.getByRole('button', { name: /mark as read:/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not mark the notification as read/i);
    expect(screen.getByTestId('notification-badge')).toHaveTextContent('1');
    expect(screen.getByText('Unread')).toBeInTheDocument();
  });

  it('marks all as read and clears the badge', async () => {
    vi.mocked(listNotifications).mockResolvedValue(page([invitation, decision], 2));
    vi.mocked(markAllNotificationsRead).mockResolvedValue({ markedCount: 2, unreadCount: 0 });
    renderBell();
    await screen.findByTestId('notification-badge');
    fireEvent.click(bell());
    await screen.findByRole('list', { name: /notification list/i });

    fireEvent.click(screen.getByRole('button', { name: /mark all as read/i }));

    await waitFor(() => expect(screen.queryByTestId('notification-badge')).not.toBeInTheDocument());
    expect(screen.queryByText('Unread')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /mark all as read/i })).toBeDisabled();
  });

  it('preserves the list and badge when mark-all fails', async () => {
    vi.mocked(listNotifications).mockResolvedValue(page([invitation, decision], 2));
    vi.mocked(markAllNotificationsRead).mockRejectedValue(new NotificationsApiError(0, 'NETWORK'));
    renderBell();
    await screen.findByTestId('notification-badge');
    fireEvent.click(bell());
    await screen.findByRole('list', { name: /notification list/i });

    fireEvent.click(screen.getByRole('button', { name: /mark all as read/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/network error/i);
    expect(screen.getByTestId('notification-badge')).toHaveTextContent('2');
    expect(screen.getAllByText('Unread')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /mark all as read/i })).toBeEnabled();
  });

  it('navigates to the action view on click, closes the panel, and marks it read', async () => {
    vi.mocked(listNotifications).mockResolvedValue(page([invitation], 1));
    vi.mocked(markNotificationRead).mockResolvedValue({
      notification: { ...invitation, readAt: NOW },
      alreadyRead: false,
      unreadCount: 0,
    });
    renderBell();
    await screen.findByTestId('notification-badge');
    fireEvent.click(bell());
    await screen.findByRole('list', { name: /notification list/i });

    fireEvent.click(screen.getByText(/invitation to team rocket/i));

    expect(onNavigate).toHaveBeenCalledWith(
      { kind: 'requests', tab: 'invitations' },
      expect.objectContaining({ id: 'n1' })
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(markNotificationRead).toHaveBeenCalledWith('n1'));
  });

  it('does not re-mark an already-read notification when clicked', async () => {
    vi.mocked(listNotifications).mockResolvedValue(page([read], 0));
    renderBell();
    await waitFor(() => expect(listNotifications).toHaveBeenCalled());
    fireEvent.click(bell());
    await screen.findByRole('list', { name: /notification list/i });

    fireEvent.click(screen.getByText('Your team roster is now final'));

    expect(onNavigate).toHaveBeenCalledWith(
      { kind: 'team', eventId: 'e1' },
      expect.objectContaining({ id: 'n3' })
    );
    expect(markNotificationRead).not.toHaveBeenCalled();
  });

  it('loads older notifications without duplicating rows', async () => {
    vi.mocked(listNotifications)
      .mockResolvedValueOnce(page([], 2))
      .mockResolvedValueOnce(page([invitation], 2, 'cursor-1'))
      .mockResolvedValueOnce(page([invitation, decision], 2));
    renderBell();
    await screen.findByTestId('notification-badge');
    fireEvent.click(bell());
    await screen.findByRole('list', { name: /notification list/i });

    fireEvent.click(screen.getByRole('button', { name: /load older notifications/i }));

    expect(await screen.findByText('Your application was approved')).toBeInTheDocument();
    expect(screen.getAllByText(/invitation to team rocket/i)).toHaveLength(1);
    expect(listNotifications).toHaveBeenLastCalledWith({ limit: 20, cursor: 'cursor-1' });
    expect(screen.queryByRole('button', { name: /load older/i })).not.toBeInTheDocument();
  });

  it('shows no destination hint for a notification that only marks read', async () => {
    const rejected = make({
      id: 'n9',
      type: 'event_verification_rejected',
      category: 'event_verification',
      message: 'Your event was not approved',
    });
    vi.mocked(listNotifications).mockResolvedValue(page([rejected], 1));
    renderBell();
    await screen.findByTestId('notification-badge');
    fireEvent.click(bell());
    const list = await screen.findByRole('list', { name: /notification list/i });
    expect(within(list).getByText('Event not approved')).toBeInTheDocument();
    expect(within(list).queryByText(/^Opens /)).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Your event was not approved'));
    expect(onNavigate).toHaveBeenCalledWith({ kind: 'none' }, expect.objectContaining({ id: 'n9' }));
  });

  it('closes on Escape and returns focus to the bell', async () => {
    renderBell();
    fireEvent.click(bell());
    expect(await screen.findByRole('dialog', { name: /notifications/i })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(bell()).toHaveFocus();
  });

  it('closes on outside click', async () => {
    renderBell();
    fireEvent.click(bell());
    await screen.findByRole('dialog');
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
