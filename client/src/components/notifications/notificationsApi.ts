import { authFetch, AuthRequiredError } from '../../config/authFetch';
import type {
  MarkAllReadResult,
  MarkReadResult,
  NotificationListPage,
  NotificationListParams,
} from './notificationTypes';

export { AuthRequiredError };

export class NotificationsApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string
  ) {
    super(message || code);
    this.name = 'NotificationsApiError';
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await authFetch(path, init);
  } catch (err: unknown) {
    if (err instanceof AuthRequiredError) throw err;
    throw new NotificationsApiError(0, 'NETWORK', 'Network error. Please try again.');
  }

  if (!res.ok) {
    let body: { error?: string; code?: string } = {};
    try {
      body = (await res.json()) as typeof body;
    } catch {
      /* non-JSON error body */
    }
    throw new NotificationsApiError(
      res.status,
      body.code || 'UNKNOWN_ERROR',
      body.error || `Request failed with status ${res.status}`
    );
  }

  return (await res.json()) as T;
}

export async function listNotifications(
  params: NotificationListParams = {}
): Promise<NotificationListPage> {
  const query = new URLSearchParams();
  if (params.limit !== undefined) query.set('limit', String(params.limit));
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.unreadOnly) query.set('unread', 'true');
  const qs = query.toString();

  const data = await requestJson<Partial<NotificationListPage>>(
    `/api/notifications${qs ? `?${qs}` : ''}`,
    { method: 'GET' }
  );
  return {
    notifications: data.notifications ?? [],
    unreadCount: data.unreadCount ?? 0,
    nextCursor: data.nextCursor ?? null,
  };
}

export async function markNotificationRead(id: string): Promise<MarkReadResult> {
  return requestJson<MarkReadResult>(`/api/notifications/${encodeURIComponent(id)}/read`, {
    method: 'PATCH',
  });
}

export async function markAllNotificationsRead(): Promise<MarkAllReadResult> {
  return requestJson<MarkAllReadResult>('/api/notifications/read-all', { method: 'POST' });
}
