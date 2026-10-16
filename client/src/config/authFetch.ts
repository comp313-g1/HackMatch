import { getIdToken, type User } from 'firebase/auth';
import { auth } from './firebase';

export class AuthRequiredError extends Error {
  readonly code = 'AUTH_REQUIRED';

  constructor() {
    super('You need to sign in first.');
    this.name = 'AuthRequiredError';
  }
}

async function readErrorCode(response: Response): Promise<string | null> {
  try {
    const body = (await response.clone().json()) as { code?: unknown };
    return typeof body.code === 'string' ? body.code : null;
  } catch {
    return null;
  }
}

/**
 * fetch() for protected API routes (US-003 AC 4). Sends the current Firebase ID token,
 * which the SDK refreshes automatically when it is close to its 1-hour expiry. If the
 * server still reports TOKEN_EXPIRED (e.g. clock skew), the token is force-refreshed
 * and the request retried once. Other failures are returned unchanged.
 *
 * Request bodies must be re-sendable (strings, FormData, Blob), not one-shot streams.
 */
export async function authFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  user: User | null = auth.currentUser
): Promise<Response> {
  if (!user) {
    throw new AuthRequiredError();
  }

  const send = async (forceRefresh: boolean): Promise<Response> => {
    const token = await getIdToken(user, forceRefresh);
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  };

  const response = await send(false);
  if (response.status !== 401 || (await readErrorCode(response)) !== 'TOKEN_EXPIRED') {
    return response;
  }
  return send(true);
}
