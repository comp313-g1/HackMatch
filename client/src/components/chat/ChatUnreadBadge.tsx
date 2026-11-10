import React from 'react';
import { formatBadgeCount } from '../notifications/notificationTarget';
import { useChatUnread } from './ChatUnreadContext';

export interface ChatActivityBadgeProps {
  unreadCount: number;
  mentionCount: number;
  label?: string;
}

/** Reuses the US-021 hidden-at-zero and 99+ badge convention. */
export function ChatActivityBadge({
  unreadCount,
  mentionCount,
  label = 'conversation',
}: ChatActivityBadgeProps): React.JSX.Element | null {
  const unreadText = formatBadgeCount(unreadCount);
  const mentionText = formatBadgeCount(mentionCount);
  if (!unreadText && !mentionText) return null;

  const accessibleParts = [
    unreadCount > 0
      ? `${unreadCount} unread ${unreadCount === 1 ? 'message' : 'messages'}`
      : null,
    mentionCount > 0
      ? `${mentionCount} unread ${mentionCount === 1 ? 'mention' : 'mentions'}`
      : null,
  ].filter(Boolean);

  return (
    <span
      role="status"
      aria-label={`${label}: ${accessibleParts.join(', ')}`}
      className="ml-2 inline-flex shrink-0 items-center gap-1"
      data-testid="chat-activity-badge"
    >
      {unreadText && (
        <span
          aria-hidden="true"
          className="min-w-[1.25rem] rounded-full bg-red-600 px-1 text-center text-xs font-bold leading-5 text-white"
        >
          {unreadText}
        </span>
      )}
      {mentionText && (
        <span
          aria-hidden="true"
          className="min-w-[1.25rem] rounded-full bg-amber-500 px-1 text-center text-xs font-bold leading-5 text-amber-950"
        >
          @{mentionText}
        </span>
      )}
    </span>
  );
}

export function ChatUnreadStatus(): React.JSX.Element | null {
  const { enabled, loadState, error, announcement, refresh } = useChatUnread();
  if (!enabled) return null;

  if (loadState === 'loading') {
    return (
      <p role="status" aria-busy="true" className="text-xs text-ink-muted">
        Loading unread chat activity…
      </p>
    );
  }
  if (loadState === 'refreshing') {
    return (
      <p role="status" aria-busy="true" className="text-xs text-ink-muted">
        Refreshing unread chat activity…
      </p>
    );
  }
  if (loadState === 'error') {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-red-700">
        <span>{error}</span>
        <button
          type="button"
          onClick={() => void refresh()}
          className="rounded border border-red-300 px-2 py-1 font-semibold hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500"
        >
          Retry chat activity
        </button>
      </div>
    );
  }
  return announcement ? (
    <span className="sr-only" role="status" aria-live="polite">
      {announcement}
    </span>
  ) : null;
}

export interface ChatNavigationButtonProps {
  active: boolean;
  onClick: () => void;
}

export function ChatNavigationButton({
  active,
  onClick,
}: ChatNavigationButtonProps): React.JSX.Element {
  const activityDescriptionId = React.useId();
  const {
    enabled,
    loadState,
    totalUnreadCount,
    totalUnreadMentionCount,
  } = useChatUnread();
  const unreadText = formatBadgeCount(totalUnreadCount);
  const mentionText = formatBadgeCount(totalUnreadMentionCount);
  const loading = enabled && (loadState === 'loading' || loadState === 'refreshing');
  const failed = enabled && loadState === 'error';
  const activityDescription = failed
    ? 'Unread chat status unavailable.'
    : totalUnreadCount > 0
      ? `${totalUnreadCount} unread messages${
          totalUnreadMentionCount > 0
            ? ` including ${totalUnreadMentionCount} ${
                totalUnreadMentionCount === 1 ? 'mention' : 'mentions'
              }`
            : ''
        }.`
      : loading
        ? 'Loading unread chat activity.'
        : 'No unread chat messages.';

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Open chat"
      aria-describedby={activityDescriptionId}
      aria-current={active ? 'page' : undefined}
      className={`fixed bottom-5 left-5 z-50 inline-flex h-14 w-14 items-center justify-center rounded-full shadow-lg focus:outline-none focus:ring-2 focus:ring-forest focus:ring-offset-2 ${
        active
          ? 'bg-forest-800 text-white'
          : 'bg-forest text-white hover:bg-forest-800'
      }`}
    >
      <span id={activityDescriptionId} className="sr-only">
        {activityDescription}
      </span>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-6 w-6"
        aria-hidden="true"
      >
        <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
      </svg>
      {loading && (
        <span
          aria-hidden="true"
          data-testid="chat-nav-loading"
          className="absolute -right-1 -top-1 h-3 w-3 animate-pulse rounded-full bg-cream-100 ring-2 ring-forest"
        />
      )}
      {failed && (
        <span
          aria-hidden="true"
          data-testid="chat-nav-error"
          className="absolute -right-1.5 -top-1.5 min-w-[1.25rem] rounded-full bg-amber-400 px-1 text-center text-xs font-bold leading-5 text-amber-950"
        >
          !
        </span>
      )}
      {!loading && !failed && unreadText && (
        <span
          aria-hidden="true"
          data-testid="chat-nav-badge"
          className="absolute -right-2 -top-2 min-w-[1.4rem] rounded-full bg-red-600 px-1 text-center text-xs font-bold leading-5 text-white ring-2 ring-cream"
        >
          {unreadText}
        </span>
      )}
      {!loading && !failed && mentionText && (
        <span
          aria-hidden="true"
          data-testid="chat-nav-mention-badge"
          className="absolute -bottom-1 -right-2 min-w-[1.35rem] rounded-full bg-amber-400 px-1 text-center text-[0.65rem] font-bold leading-5 text-amber-950 ring-2 ring-cream"
        >
          @{mentionText}
        </span>
      )}
    </button>
  );
}

