import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  AuthRequiredError,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  NotificationsApiError,
} from './notificationsApi';
import {
  describeNotificationTarget,
  formatBadgeCount,
  formatRelativeTime,
  resolveNotificationTarget,
  type NotificationTarget,
} from './notificationTarget';
import { getNotificationLabel, type NotificationView } from './notificationTypes';

export const NOTIFICATION_PAGE_SIZE = 20;
export const NOTIFICATION_POLL_MS = 30_000;

export interface NotificationBellProps {
  /** Called when a notification is clicked; the app routes to the matching view. */
  onNavigate: (target: NotificationTarget, notification: NotificationView) => void;
  /** Badge refresh interval; 0 disables polling. */
  pollIntervalMs?: number;
}

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

function describeError(err: unknown, fallback: string): string {
  if (err instanceof AuthRequiredError) return 'Please sign in again to see notifications.';
  if (err instanceof NotificationsApiError) {
    if (err.status === 0) return 'Network error. Check your connection and try again.';
    if (err.status === 401) return 'Your session has expired. Please sign in again.';
    if (err.status === 403) return 'Notifications are not available for this account.';
    if (err.status === 404) return 'That notification is no longer available.';
  }
  return fallback;
}

export function NotificationBell({
  onNavigate,
  pollIntervalMs = NOTIFICATION_POLL_MS,
}: NotificationBellProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationView[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [markAllPending, setMarkAllPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const requestSeq = useRef(0);
  const mounted = useRef(true);
  const panelId = useId();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** Full (re)load of the first page; keeps the previous list visible on failure. */
  const loadFirstPage = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoadState((prev) => (prev === 'ready' ? prev : 'loading'));
    setLoadError(null);
    try {
      const page = await listNotifications({ limit: NOTIFICATION_PAGE_SIZE });
      if (!mounted.current || seq !== requestSeq.current) return;
      setItems(page.notifications);
      setUnreadCount(page.unreadCount);
      setNextCursor(page.nextCursor);
      setLoadState('ready');
    } catch (err: unknown) {
      if (!mounted.current || seq !== requestSeq.current) return;
      setLoadError(describeError(err, 'Could not load notifications. Please try again.'));
      setLoadState((prev) => (prev === 'ready' ? prev : 'error'));
    }
  }, []);

  /** Cheap badge refresh (one row) used on mount and by polling while closed. */
  const refreshBadge = useCallback(async () => {
    try {
      const page = await listNotifications({ limit: 1 });
      if (mounted.current) setUnreadCount(page.unreadCount);
    } catch {
      /* the badge keeps its last known value; errors surface when the panel opens */
    }
  }, []);

  useEffect(() => {
    void refreshBadge();
  }, [refreshBadge]);

  useEffect(() => {
    if (open || pollIntervalMs <= 0) return;
    const timer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void refreshBadge();
    }, pollIntervalMs);
    return () => window.clearInterval(timer);
  }, [open, pollIntervalMs, refreshBadge]);

  // Close on outside pointer and Escape (focus returns to the bell).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && rootRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const toggleOpen = () => {
    if (!open) {
      setActionError(null);
      void loadFirstPage();
    }
    setOpen(!open);
  };

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setActionError(null);
    try {
      const page = await listNotifications({ limit: NOTIFICATION_PAGE_SIZE, cursor: nextCursor });
      if (!mounted.current) return;
      setItems((prev) => {
        const seen = new Set(prev.map((n) => n.id));
        return [...prev, ...page.notifications.filter((n) => !seen.has(n.id))];
      });
      setUnreadCount(page.unreadCount);
      setNextCursor(page.nextCursor);
    } catch (err: unknown) {
      if (mounted.current) {
        setActionError(describeError(err, 'Could not load more notifications.'));
      }
    } finally {
      if (mounted.current) setLoadingMore(false);
    }
  };

  /** Optimistically marks one notification read; reverts on failure. Returns success. */
  const markOneRead = async (notification: NotificationView): Promise<boolean> => {
    if (notification.readAt) return true;
    const optimisticReadAt = new Date().toISOString();
    setActionError(null);
    setItems((prev) =>
      prev.map((n) => (n.id === notification.id ? { ...n, readAt: optimisticReadAt } : n))
    );
    setUnreadCount((count) => Math.max(0, count - 1));
    try {
      const result = await markNotificationRead(notification.id);
      if (mounted.current) {
        // Read response fields before the state updater so a malformed response
        // cannot throw during render; fall back to the optimistic values.
        const confirmedReadAt = result?.notification?.readAt ?? optimisticReadAt;
        const confirmedUnread = result?.unreadCount;
        setItems((prev) =>
          prev.map((n) => (n.id === notification.id ? { ...n, readAt: confirmedReadAt } : n))
        );
        if (typeof confirmedUnread === 'number') setUnreadCount(confirmedUnread);
      }
      return true;
    } catch (err: unknown) {
      if (mounted.current) {
        setItems((prev) =>
          prev.map((n) => (n.id === notification.id ? { ...n, readAt: null } : n))
        );
        setUnreadCount((count) => count + 1);
        setActionError(describeError(err, 'Could not mark the notification as read.'));
      }
      return false;
    }
  };

  const handleMarkAll = async () => {
    if (markAllPending || unreadCount === 0) return;
    setMarkAllPending(true);
    setActionError(null);
    try {
      const result = await markAllNotificationsRead();
      if (!mounted.current) return;
      const readAt = new Date().toISOString();
      setItems((prev) => prev.map((n) => (n.readAt ? n : { ...n, readAt })));
      setUnreadCount(result.unreadCount);
    } catch (err: unknown) {
      // Nothing was changed locally, so the existing list and badge stay accurate.
      if (mounted.current) {
        setActionError(describeError(err, 'Could not mark all notifications as read.'));
      }
    } finally {
      if (mounted.current) setMarkAllPending(false);
    }
  };

  const handleSelect = (notification: NotificationView) => {
    const target = resolveNotificationTarget(notification);
    setOpen(false);
    // Navigation is never blocked by a failed mark-read; the badge reverts if it failed.
    void markOneRead(notification);
    onNavigate(target, notification);
  };

  const badge = formatBadgeCount(unreadCount);
  const now = Date.now();

  return (
    <div className="relative" ref={rootRef} data-nav-menu-root="true">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleOpen}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={
          unreadCount > 0
            ? `Notifications, ${unreadCount} unread`
            : 'Notifications, no unread'
        }
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-md border border-cream-300 text-ink hover:bg-cream-100 focus:outline-none focus:ring-2 focus:ring-forest focus:ring-offset-2 focus:ring-offset-cream"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-5 w-5"
          aria-hidden="true"
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {badge && (
          <span
            data-testid="notification-badge"
            aria-hidden="true"
            className="absolute -right-1.5 -top-1.5 min-w-[1.25rem] rounded-full bg-red-600 px-1 text-center text-xs font-bold leading-5 text-white"
          >
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 z-50 mt-2 w-[min(24rem,calc(100vw-2rem))] rounded-lg border border-cream-200 bg-white shadow-lg"
        >
          <div className="flex items-center justify-between gap-2 border-b border-cream-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-ink">Notifications</h2>
            <button
              type="button"
              onClick={() => void handleMarkAll()}
              disabled={markAllPending || unreadCount === 0}
              className="rounded text-sm font-medium text-forest-800 hover:underline focus:outline-none focus:ring-2 focus:ring-forest disabled:cursor-not-allowed disabled:text-ink-muted disabled:no-underline"
            >
              {markAllPending ? 'Marking…' : 'Mark all as read'}
            </button>
          </div>

          {actionError && (
            <p role="alert" className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
              {actionError}
            </p>
          )}

          {loadState === 'loading' && (
            <p role="status" className="px-4 py-6 text-center text-sm text-ink-muted">
              Loading notifications…
            </p>
          )}

          {loadState === 'error' && (
            <div className="px-4 py-6 text-center">
              <p role="alert" className="text-sm text-red-800">
                {loadError}
              </p>
              <button
                type="button"
                onClick={() => void loadFirstPage()}
                className="mt-3 rounded-md border border-cream-300 px-3 py-1.5 text-sm font-semibold text-ink hover:bg-cream-100 focus:outline-none focus:ring-2 focus:ring-forest"
              >
                Try again
              </button>
            </div>
          )}

          {loadState === 'ready' && loadError && (
            <p role="alert" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
              {loadError} Showing what was loaded earlier.
            </p>
          )}

          {loadState === 'ready' && items.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-ink-muted">
              You&apos;re all caught up. New invitations, applications and updates will appear here.
            </p>
          )}

          {loadState === 'ready' && items.length > 0 && (
            <>
              <ul className="max-h-96 divide-y divide-cream-200 overflow-y-auto" aria-label="Notification list">
                {items.map((n) => {
                  const unread = !n.readAt;
                  return (
                    <li key={n.id} className={unread ? 'bg-forest-50/40' : undefined}>
                      <div className="flex items-start gap-2 px-4 py-3">
                        <button
                          type="button"
                          onClick={() => handleSelect(n)}
                          className="min-w-0 flex-1 rounded text-left focus:outline-none focus:ring-2 focus:ring-forest"
                        >
                          <span className="flex items-center gap-2">
                            <span className="rounded bg-cream-100 px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                              {getNotificationLabel(n)}
                            </span>
                            {unread && (
                              <>
                                <span className="h-2 w-2 rounded-full bg-forest" aria-hidden="true" />
                                <span className="sr-only">Unread</span>
                              </>
                            )}
                            <span className="ml-auto text-xs text-ink-muted">
                              {formatRelativeTime(n.createdAt, now)}
                            </span>
                          </span>
                          <span
                            className={`mt-1 block break-words text-sm ${
                              unread ? 'font-semibold text-ink' : 'text-ink-muted'
                            }`}
                          >
                            {n.message}
                          </span>
                          {(() => {
                            const hint = describeNotificationTarget(resolveNotificationTarget(n));
                            return hint ? (
                              <span className="mt-1 block text-xs font-medium text-forest-800">
                                {hint}
                              </span>
                            ) : null;
                          })()}
                        </button>
                        {unread && (
                          <button
                            type="button"
                            onClick={() => void markOneRead(n)}
                            aria-label={`Mark as read: ${n.message}`}
                            className="shrink-0 rounded px-1.5 py-1 text-xs font-medium text-forest-800 hover:underline focus:outline-none focus:ring-2 focus:ring-forest"
                          >
                            Mark read
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              {nextCursor && (
                <div className="border-t border-cream-200 px-4 py-2 text-center">
                  <button
                    type="button"
                    onClick={() => void loadMore()}
                    disabled={loadingMore}
                    className="rounded text-sm font-medium text-forest-800 hover:underline focus:outline-none focus:ring-2 focus:ring-forest disabled:opacity-50"
                  >
                    {loadingMore ? 'Loading…' : 'Load older notifications'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
