import React, { useCallback, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, getIdTokenResult, type User } from 'firebase/auth';
import { auth } from '../../config/firebase';
import { hasCompletedMfa, describeSessionError, type SessionError } from './mfaClaim';
import { logout } from './logout';
import { OtpEntryForm } from './OtpEntryForm';
import type { OtpChallenge } from './providerSignIn';

type GateStatus = 'loading' | 'signed-out' | 'mfa-required' | 'authorized' | 'error';

export interface MfaGateProps {
  /** Rendered only when the signed-in user's current session has passed the email code. */
  children: (user: User) => React.ReactNode;
  onNavigateToSignIn?: () => void;
  /** Optional challenge from password/OAuth primary auth so resend is not forced immediately. */
  initialChallenge?: OtpChallenge | null;
}

const cardClass =
  'max-w-md w-full mx-auto p-6 bg-white rounded-xl border border-cream-200 shadow-sm';
const primaryButtonClass =
  'w-full py-2.5 px-4 border border-transparent rounded-md shadow-sm text-sm font-semibold text-white bg-forest hover:bg-forest-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-forest disabled:opacity-50';
const secondaryButtonClass =
  'w-full py-2 px-4 border border-cream-200 rounded-md shadow-sm text-sm font-medium text-ink bg-white hover:bg-cream-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-forest disabled:opacity-50';

export function MfaGate({
  children,
  onNavigateToSignIn,
  initialChallenge = null,
}: MfaGateProps): React.JSX.Element {
  const [status, setStatus] = useState<GateStatus>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<SessionError | null>(null);
  const [rechecking, setRechecking] = useState<boolean>(false);
  const [signingOut, setSigningOut] = useState<boolean>(false);
  const checkId = useRef(0);

  const checkSession = useCallback(async (currentUser: User, forceRefresh: boolean) => {
    const id = ++checkId.current;
    try {
      const result = await getIdTokenResult(currentUser, forceRefresh);
      if (id !== checkId.current) return false;
      const verified = hasCompletedMfa(result.claims as Record<string, unknown>);
      setError(null);
      setStatus(verified ? 'authorized' : 'mfa-required');
      return verified;
    } catch (err: unknown) {
      if (id !== checkId.current) return false;
      setError(describeSessionError(err));
      setStatus('error');
      return false;
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      if (!nextUser) {
        checkId.current++;
        setError(null);
        setStatus('signed-out');
        return;
      }
      setStatus('loading');
      void checkSession(nextUser, false);
    });
    return unsubscribe;
  }, [checkSession]);

  const handleRecheck = async () => {
    if (!user || rechecking) return;
    setRechecking(true);
    await checkSession(user, true);
    setRechecking(false);
  };

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await logout(user);
    } catch (err: unknown) {
      const message =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: unknown }).message)
          : 'Sign-out failed. Please try again.';
      setError({ kind: 'unknown', message });
      setStatus('error');
    } finally {
      setSigningOut(false);
    }
  };

  if (status === 'authorized' && user) {
    return <>{children(user)}</>;
  }

  if (status === 'loading') {
    return (
      <div role="status" aria-live="polite" aria-busy="true" className={`${cardClass} text-center`}>
        <div
          className="mx-auto mb-3 h-8 w-8 rounded-full border-4 border-forest-100 border-t-forest animate-spin"
          aria-hidden="true"
        />
        <p className="text-sm text-ink-muted">Checking your session...</p>
      </div>
    );
  }

  if (status === 'signed-out') {
    return (
      <div className={cardClass}>
        <h3 className="font-display text-xl font-semibold text-forest-900 mb-2">You are not signed in</h3>
        <p className="text-sm text-ink-muted mb-6">Sign in to access your HackMatch account.</p>
        {onNavigateToSignIn && (
          <button type="button" onClick={onNavigateToSignIn} className={primaryButtonClass}>
            Go to sign in
          </button>
        )}
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className={cardClass}>
        <div
          role="alert"
          className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-md"
        >
          {error?.message}
        </div>
        <div className="space-y-3">
          {user && error?.kind !== 'session-ended' && (
            <button
              type="button"
              onClick={handleRecheck}
              disabled={rechecking}
              className={primaryButtonClass}
            >
              {rechecking ? 'Checking...' : 'Try again'}
            </button>
          )}
          {error?.kind === 'session-ended' && onNavigateToSignIn ? (
            <button type="button" onClick={onNavigateToSignIn} className={primaryButtonClass}>
              Go to sign in
            </button>
          ) : (
            user && (
              <button
                type="button"
                onClick={handleSignOut}
                disabled={signingOut}
                className={secondaryButtonClass}
              >
                {signingOut ? 'Signing out...' : 'Sign out'}
              </button>
            )
          )}
        </div>
      </div>
    );
  }

  // mfa-required — show OTP entry (S1-P1-10)
  if (user) {
    return (
      <OtpEntryForm
        user={user}
        initialChallenge={initialChallenge}
        onVerified={() => {
          void checkSession(user, true);
        }}
        onSignedOut={() => {
          onNavigateToSignIn?.();
        }}
      />
    );
  }

  return (
    <div className={cardClass}>
      <h3 className="font-display text-xl font-semibold text-forest-900 mb-2">Email code required</h3>
      <p className="text-sm text-ink-muted mb-6">Sign in again to receive a verification code.</p>
      {onNavigateToSignIn && (
        <button type="button" onClick={onNavigateToSignIn} className={primaryButtonClass}>
          Go to sign in
        </button>
      )}
    </div>
  );
}

export default MfaGate;
