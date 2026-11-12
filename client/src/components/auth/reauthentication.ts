import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  type User,
} from 'firebase/auth';
import { googleProvider, githubProvider } from '../../config/firebase';
import { describeLoginError } from './loginErrors';

/**
 * US-029 / #269 primary reauthentication.
 *
 * HackMatch has no separate "reauth" model: the server's recent-authentication
 * check reads the Firebase ID token's `auth_time`, and current-session MFA
 * requires `mfa_auth_time === auth_time`. Firebase reauthentication therefore
 * issues a new `auth_time`, after which the existing US-004 email OTP
 * (`/api/auth/mfa/challenge` + `/api/auth/mfa/verify`) must be completed again
 * before any protected request succeeds. Both steps are real authentication
 * evidence verified by Firebase and the server; nothing here trusts a client clock.
 */

export type PrimaryReauthMethod = 'password' | 'google' | 'github';

const PROVIDER_METHODS: Record<string, PrimaryReauthMethod> = {
  password: 'password',
  'google.com': 'google',
  'github.com': 'github',
};

/** Methods linked to this Firebase user, password first. */
export function primaryReauthMethods(user: Pick<User, 'providerData'>): PrimaryReauthMethod[] {
  const linked = new Set<PrimaryReauthMethod>();
  for (const info of user.providerData ?? []) {
    const method = info && PROVIDER_METHODS[info.providerId];
    if (method) linked.add(method);
  }
  return (['password', 'google', 'github'] as const).filter((method) => linked.has(method));
}

export async function reauthenticateWithPassword(user: User, password: string): Promise<void> {
  if (!user.email) {
    throw Object.assign(new Error('This account has no email password sign-in.'), {
      code: 'auth/missing-email',
    });
  }
  // The credential is passed straight to Firebase and never stored.
  await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
}

export async function reauthenticateWithProvider(
  user: User,
  method: Exclude<PrimaryReauthMethod, 'password'>
): Promise<void> {
  await reauthenticateWithPopup(user, method === 'github' ? githubProvider : googleProvider);
}

export type ReauthErrorKind =
  | 'credentials'
  | 'cancelled'
  | 'mismatch'
  | 'session'
  | 'throttled'
  | 'network'
  | 'unknown';

export interface ReauthError {
  kind: ReauthErrorKind;
  message: string;
}

function codeOf(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error
    ? String((error as { code: unknown }).code)
    : '';
}

/** Maps Firebase reauthentication failures to safe, non-enumerating messages. */
export function describeReauthError(error: unknown): ReauthError {
  switch (codeOf(error)) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
    case 'auth/user-cancelled':
      return {
        kind: 'cancelled',
        message: 'Verification was cancelled. No changes were made. You can try again.',
      };
    case 'auth/popup-blocked':
      return {
        kind: 'cancelled',
        message: 'The verification window was blocked by your browser. Allow pop-ups and try again.',
      };
    case 'auth/user-mismatch':
      return {
        kind: 'mismatch',
        message:
          'That sign-in belongs to a different account. Verify with the account you are signed in to.',
      };
    case 'auth/user-token-expired':
    case 'auth/user-not-found':
    case 'auth/requires-recent-login':
    case 'auth/missing-email':
      return { kind: 'session', message: 'Your session has ended. Sign in again to continue.' };
    default: {
      const login = describeLoginError(error);
      if (login.kind === 'credentials') {
        return { kind: 'credentials', message: 'Incorrect password. Please try again.' };
      }
      if (login.kind === 'throttled' || login.kind === 'network') {
        return { kind: login.kind, message: login.message };
      }
      if (login.kind === 'disabled') {
        return { kind: 'session', message: login.message };
      }
      return { kind: 'unknown', message: 'We could not verify your identity. Please try again.' };
    }
  }
}
