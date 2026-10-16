import { getIdToken, signOut, type User } from 'firebase/auth';
import { auth } from '../../config/firebase';

/**
 * Asks the backend whether this Firebase user may continue login (US-003 AC 2 / T4).
 * On ACCOUNT_SUSPENDED / ACCOUNT_DISABLED, signs the user out of the client SDK so no
 * half-open session remains, then throws `{ code }` for `describeLoginError`.
 */
export async function assertAccountActive(user: User): Promise<void> {
  const token = await getIdToken(user, false);
  let response: Response;
  try {
    response = await fetch('/api/auth/account-status', {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw Object.assign(new Error('network'), { code: 'auth/network-request-failed' });
  }

  if (response.ok) return;

  let code = 'unknown';
  try {
    const body = (await response.json()) as { code?: unknown };
    if (typeof body.code === 'string') code = body.code;
  } catch {
    // ignore JSON parse errors
  }

  if (code === 'ACCOUNT_SUSPENDED' || code === 'ACCOUNT_DISABLED') {
    try {
      await signOut(auth);
    } catch {
      // Prefer the suspension/disabled error for the UI.
    }
    throw Object.assign(new Error(code), { code });
  }

  if (response.status === 401) {
    try {
      await signOut(auth);
    } catch {
      // ignore
    }
    throw Object.assign(new Error('INVALID_TOKEN'), { code: 'auth/invalid-credential' });
  }

  throw Object.assign(new Error('status-check-failed'), { code: 'unknown' });
}
