import React, { useState, useEffect, useRef, useCallback } from 'react';
import { applyActionCode, checkActionCode } from 'firebase/auth';
import { auth, translateAuthError } from '../../config/firebase';
import { ReplacementLinkForm } from './ReplacementLinkForm';

export type VerificationStatus =
  | 'loading'
  | 'success'
  | 'expired'
  | 'invalid'
  | 'empty_code'
  | 'network_error';

export interface EmailVerificationViewProps {
  actionCode?: string | null;
  mode?: string | null;
  initialEmail?: string;
  onNavigateToSignIn?: () => void;
  onNavigateToRegister?: () => void;
}

/**
 * Email verification view component handling URL query parameters,
 * Firebase Auth action code verification, accessible UI states,
 * and replacement-link requests per US-001 AC 3, AC 5, US-001-T3, US-001-T4, and NR-018.
 */
export function EmailVerificationView({
  actionCode: propActionCode,
  mode: propMode,
  initialEmail,
  onNavigateToSignIn,
  onNavigateToRegister,
}: EmailVerificationViewProps): React.JSX.Element {
  const [status, setStatus] = useState<VerificationStatus>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(initialEmail || null);

  useEffect(() => {
    if (initialEmail) {
      setUserEmail(initialEmail);
    }
  }, [initialEmail]);

  // Execution latch to guard against React 18 StrictMode double-execution
  const hasExecutedRef = useRef<boolean>(false);

  // Resolved parameters (prop overrides take precedence over URL search parameters)
  const resolvedCode =
    propActionCode !== undefined
      ? propActionCode
      : typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('oobCode')
      : null;

  const resolvedMode =
    propMode !== undefined
      ? propMode
      : typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('mode')
      : null;

  const resolvedEmail =
    initialEmail ||
    (typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('email') ||
        sessionStorage.getItem('hackmatch_last_registered_email')
      : null);

  const handleVerify = useCallback(async (code: string) => {
    setStatus('loading');
    setErrorMessage(null);

    // Try inspecting the action code first to recover email for pre-fill if expired/needed
    try {
      const info = await checkActionCode(auth, code);
      if (info?.data?.email) {
        setUserEmail(info.data.email);
      }
    } catch {
      // Ignored: checkActionCode may fail on expired/tampered codes, handled below
    }

    try {
      // 1. Execute email verification with Firebase Client SDK
      await applyActionCode(auth, code);

      // 2. Dispatch lightweight backend sync notification if endpoint is available
      try {
        await fetch('/api/auth/verify-email', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ oobCode: code }),
        });
      } catch {
        // Non-blocking: catch and ignore network/endpoint errors for defensive sync
      }

      // 3. Mark success (guarantees US-001 AC 5: zero session tokens or cookies issued)
      setStatus('success');
    } catch (err: unknown) {
      const errCode =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code: unknown }).code)
          : '';

      if (errCode === 'auth/expired-action-code') {
        setStatus('expired');
        setErrorMessage(translateAuthError(err));
      } else if (errCode === 'auth/network-request-failed') {
        setStatus('network_error');
        setErrorMessage(translateAuthError(err));
      } else {
        setStatus('invalid');
        setErrorMessage(translateAuthError(err));
      }
    }
  }, []);

  useEffect(() => {
    // If code has already been executed, skip to prevent double execution in StrictMode
    if (hasExecutedRef.current) {
      return;
    }

    // Scrub oobCode parameter from browser address bar immediately upon extraction to prevent leaks
    if (typeof window !== 'undefined' && window.location.search) {
      try {
        const url = new URL(window.location.href);
        if (url.searchParams.has('oobCode')) {
          url.searchParams.delete('oobCode');
          window.history.replaceState(
            {},
            document.title,
            url.pathname + (url.search ? url.search : '')
          );
        }
      } catch {
        // Fallback if URL or history is restricted
      }
    }

    // 1. If action code is present, verify code directly
    if (resolvedCode) {
      if (resolvedMode && resolvedMode !== 'verifyEmail') {
        setStatus('invalid');
        setErrorMessage('Invalid action mode for email verification.');
        return;
      }
      hasExecutedRef.current = true;
      void handleVerify(resolvedCode);
      return;
    }

    // 2. Mode mismatch: if mode is present and is not verifyEmail, treat as invalid
    if (resolvedMode && resolvedMode !== 'verifyEmail') {
      setStatus('invalid');
      setErrorMessage('Invalid action mode for email verification.');
      return;
    }

    // 3. If no action code, but mode === 'verifyEmail' and resolvedEmail is available:
    // Reconcile with backend in case user was verified on Firebase-hosted page
    if (resolvedMode === 'verifyEmail' && resolvedEmail) {
      hasExecutedRef.current = true;
      void (async () => {
        setStatus('loading');
        try {
          const response = await fetch('/api/auth/verify-email', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email: resolvedEmail }),
          });

          const data = (await response.json().catch(() => null)) as { isVerified?: boolean } | null;
          if (response.ok && data?.isVerified) {
            setUserEmail(resolvedEmail);
            setStatus('success');
            return;
          }
        } catch {
          // If network sync fails, fall back to empty_code
        }
        setUserEmail(resolvedEmail);
        setStatus('empty_code');
      })();
      return;
    }

    // 4. Missing action code state
    setStatus('empty_code');
  }, [resolvedCode, resolvedMode, resolvedEmail, handleVerify]);

  const handleRetry = () => {
    if (resolvedCode) {
      hasExecutedRef.current = true;
      void handleVerify(resolvedCode);
    }
  };

  return (
    <div className="max-w-lg w-full mx-auto p-6 bg-white rounded-xl border border-cream-200 shadow-sm">
      {/* 1. Loading State */}
      {status === 'loading' && (
        <div
          role="status"
          aria-live="polite"
          className="flex flex-col items-center justify-center py-12 text-center"
        >
          <div className="w-12 h-12 border-4 border-forest border-t-transparent rounded-full animate-spin mb-4" />
          <h2 className="font-display text-xl font-semibold text-forest-900 mb-2">
            Verifying Email Address
          </h2>
          <p className="text-sm text-ink-muted">
            Please wait while we verify your email address...
          </p>
        </div>
      )}

      {/* 2. Success State (US-001-T3, AC 3, AC 5) */}
      {status === 'success' && (
        <div
          role="status"
          aria-live="polite"
          className="flex flex-col items-center text-center py-6"
        >
          <div className="w-14 h-14 bg-forest-50 rounded-full flex items-center justify-center text-forest-700 text-3xl font-bold mb-4">
            ✓
          </div>
          <h2 className="font-display text-2xl font-semibold text-forest-900 mb-2">
            Email Verified Successfully
          </h2>
          <p className="text-sm text-ink-muted max-w-sm mb-6">
            Your email address has been verified. You can now sign in to your HackMatch account.
          </p>

          <div className="w-full p-4 bg-forest-50 border border-forest-100 text-forest-900 text-xs rounded-md text-left mb-6">
            <p className="font-semibold mb-1">Security Policy Notice:</p>
            <p>
              In accordance with our security policy (US-001 AC 5), email verification does not automatically create an active session. You must sign in with your credentials and complete multi-factor authentication (MFA).
            </p>
          </div>

          <button
            type="button"
            onClick={onNavigateToSignIn}
            className="w-full py-2.5 px-4 border border-transparent rounded-md shadow-sm text-sm font-semibold text-white bg-forest hover:bg-forest-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-forest"
          >
            Proceed to Sign In
          </button>
        </div>
      )}

      {/* 3. Expired Link State (US-001-T4) */}
      {status === 'expired' && (
        <div className="py-4">
          <div
            role="alert"
            className="mb-6 p-4 bg-amber-50 border border-amber-200 text-amber-900 rounded-md"
          >
            <div className="flex items-center space-x-3 mb-1">
              <span className="text-amber-600 text-xl font-bold" aria-hidden="true">
                ⚠
              </span>
              <h2 className="text-lg font-semibold text-amber-900">
                Verification Link Expired
              </h2>
            </div>
            <p className="text-sm text-amber-800">
              {errorMessage || 'Your verification link has expired. Verification links are valid for 24 hours.'}
            </p>
          </div>

          <ReplacementLinkForm initialEmail={userEmail || ''} />
        </div>
      )}

      {/* 4. Invalid or Consumed Link State (US-001-T4) */}
      {status === 'invalid' && (
        <div className="py-4">
          <div
            role="alert"
            className="mb-6 p-4 bg-red-50 border border-red-200 text-red-900 rounded-md"
          >
            <div className="flex items-center space-x-3 mb-1">
              <span className="text-red-600 text-xl font-bold" aria-hidden="true">
                ✕
              </span>
              <h2 className="text-lg font-semibold text-red-900">
                Verification Link Invalid
              </h2>
            </div>
            <p className="text-sm text-red-800">
              {errorMessage || 'This verification link is invalid or has already been used.'}
            </p>
          </div>

          <ReplacementLinkForm initialEmail={userEmail || ''} />
        </div>
      )}

      {/* 5. Empty / Missing Code State */}
      {status === 'empty_code' && (
        <div className="py-4">
          <div className="mb-6 p-4 bg-forest-50 border border-forest-100 text-forest-900 rounded-md">
            <div className="flex items-center space-x-3 mb-1">
              <span className="text-forest-700 text-xl font-bold" aria-hidden="true">
                ℹ
              </span>
              <h2 className="text-lg font-semibold text-forest-900">
                Email Verification
              </h2>
            </div>
            <p className="text-sm text-forest-800">
              No verification code was detected. If you arrived here directly, please check the link sent to your email or request a new verification link below.
            </p>
          </div>

          <ReplacementLinkForm initialEmail={initialEmail || userEmail || ''} />

          {onNavigateToRegister && (
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={onNavigateToRegister}
                className="text-sm font-medium text-forest-700 hover:text-forest-900 underline focus:outline-none"
              >
                Back to Registration
              </button>
            </div>
          )}
        </div>
      )}

      {/* 6. Transient Network Error State */}
      {status === 'network_error' && (
        <div className="py-6 text-center">
          <div
            role="alert"
            className="mb-6 p-4 bg-amber-50 border border-amber-200 text-amber-900 rounded-md text-left"
          >
            <div className="flex items-center space-x-3 mb-1">
              <span className="text-amber-600 text-xl font-bold" aria-hidden="true">
                ⚡
              </span>
              <h2 className="text-lg font-semibold text-amber-900">
                Connection Issue
              </h2>
            </div>
            <p className="text-sm text-amber-800">
              {errorMessage || 'Network error. Please check your internet connection and try again.'}
            </p>
          </div>

          <button
            type="button"
            onClick={handleRetry}
            className="w-full py-2.5 px-4 border border-transparent rounded-md shadow-sm text-sm font-semibold text-white bg-forest hover:bg-forest-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-forest mb-3"
          >
            Retry Verification
          </button>

          {onNavigateToRegister && (
            <button
              type="button"
              onClick={onNavigateToRegister}
              className="text-sm font-medium text-ink-muted hover:text-ink underline focus:outline-none"
            >
              Back to Registration
            </button>
          )}
        </div>
      )}
    </div>
  );
}
