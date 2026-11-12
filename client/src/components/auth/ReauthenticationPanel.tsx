import React, { useEffect, useId, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { auth } from '../../config/firebase';
import { OtpEntryForm } from './OtpEntryForm';
import {
  describeReauthError,
  primaryReauthMethods,
  reauthenticateWithPassword,
  reauthenticateWithProvider,
  type PrimaryReauthMethod,
  type ReauthError,
} from './reauthentication';

export interface ReauthenticationPanelProps {
  /** Plain-language description of the protected action, e.g. "turn off your authenticator app". */
  purpose: string;
  /** Called only after Firebase reauthentication and the email code both succeed. */
  onReauthenticated: () => void;
  /** Called when the user leaves before primary reauthentication succeeds. */
  onCancel: () => void;
}

type Step = 'primary' | 'email-otp' | 'session-ended';

const primaryButton =
  'w-full py-2.5 px-4 rounded-md text-sm font-semibold text-white bg-forest hover:bg-forest-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-forest disabled:opacity-50';
const secondaryButton =
  'w-full py-2 px-4 border border-cream-300 rounded-md text-sm font-medium text-ink bg-white hover:bg-cream-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-forest disabled:opacity-50';

const PROVIDER_LABEL: Record<Exclude<PrimaryReauthMethod, 'password'>, string> = {
  google: 'Google',
  github: 'GitHub',
};

/**
 * US-029 / #269 in-place reauthentication for sensitive authenticator changes.
 *
 * Step 1 proves the primary Firebase credential again (password or the linked
 * Google/GitHub provider). Step 2 reuses the US-004 email OTP form unchanged,
 * so the five-attempt / 15-minute lock and resend limits still apply. Only
 * after both does the server see a recent `auth_time` with a matching
 * `mfa_auth_time`. The password lives only in this component's memory and is
 * cleared after every attempt.
 */
export function ReauthenticationPanel({
  purpose,
  onReauthenticated,
  onCancel,
}: ReauthenticationPanelProps): React.JSX.Element {
  // Capture the owner once; a different user at completion means the account changed.
  const [owner] = useState<User | null>(() => auth.currentUser);
  const [step, setStep] = useState<Step>(owner ? 'primary' : 'session-ended');
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<ReauthError | null>(null);
  const [busy, setBusy] = useState<PrimaryReauthMethod | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);
  const passwordId = useId();
  const methods = owner ? primaryReauthMethods(owner) : [];
  const providerMethods = methods.filter(
    (method): method is Exclude<PrimaryReauthMethod, 'password'> => method !== 'password'
  );

  useEffect(() => {
    mountedRef.current = true;
    headingRef.current?.focus();
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (step === 'email-otp' || step === 'session-ended') headingRef.current?.focus();
  }, [step]);

  const ownerStillSignedIn = () => Boolean(owner) && auth.currentUser?.uid === owner?.uid;

  const fail = (next: ReauthError) => {
    setError(next);
    if (next.kind === 'session') setStep('session-ended');
    requestAnimationFrame(() => {
      if (next.kind === 'credentials' && passwordRef.current) passwordRef.current.focus();
      else errorRef.current?.focus();
    });
  };

  const afterPrimarySuccess = () => {
    if (!ownerStillSignedIn()) {
      fail({
        kind: 'session',
        message: 'The signed-in account changed. Sign in again to continue.',
      });
      return;
    }
    setError(null);
    setStep('email-otp');
  };

  const submitPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!owner || busy) return;
    if (!password) {
      setFieldError('Enter your current password.');
      passwordRef.current?.focus();
      return;
    }
    setFieldError(null);
    setError(null);
    setBusy('password');
    const attempt = password;
    // Never keep the credential longer than the request that needs it.
    setPassword('');
    try {
      await reauthenticateWithPassword(owner, attempt);
      if (!mountedRef.current) return;
      afterPrimarySuccess();
    } catch (caught: unknown) {
      if (!mountedRef.current) return;
      fail(describeReauthError(caught));
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  };

  const verifyWithProvider = async (method: Exclude<PrimaryReauthMethod, 'password'>) => {
    if (!owner || busy) return;
    setError(null);
    setFieldError(null);
    setBusy(method);
    try {
      await reauthenticateWithProvider(owner, method);
      if (!mountedRef.current) return;
      afterPrimarySuccess();
    } catch (caught: unknown) {
      if (!mountedRef.current) return;
      fail(describeReauthError(caught));
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  };

  const handleOtpVerified = () => {
    // OtpEntryForm has already force-refreshed the ID token with the new claim.
    if (!ownerStillSignedIn()) {
      setError({
        kind: 'session',
        message: 'The signed-in account changed. Sign in again to continue.',
      });
      setStep('session-ended');
      return;
    }
    onReauthenticated();
  };

  return (
    <div
      className="mt-5 rounded-lg border border-amber-200 bg-amber-50/40 p-4"
      data-testid="reauthentication-panel"
    >
      <h4
        ref={headingRef}
        tabIndex={-1}
        className="font-display text-lg font-semibold text-forest-900 focus:outline-none"
      >
        {step === 'email-otp' ? 'Step 2 of 2: Enter your email code' : 'Verify it’s you'}
      </h4>

      {step === 'primary' && (
        <p className="mt-1 text-sm text-ink-muted">
          For your security, confirm your identity before you {purpose}. Step 1 of 2: confirm your
          sign-in. Step 2 of 2: enter the code we email you. Nothing changes until both succeed.
        </p>
      )}
      {step === 'email-otp' && (
        <p className="mt-1 text-sm text-ink-muted">
          Your sign-in was confirmed. Your current session now needs a fresh email verification
          code before it can continue, then we’ll return you to {purpose}.
        </p>
      )}

      {error && (
        <div
          ref={errorRef}
          tabIndex={-1}
          role="alert"
          className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          data-testid="reauthentication-error"
        >
          {error.message}
        </div>
      )}

      {step === 'primary' && (
        <div className="mt-4 space-y-4">
          {methods.includes('password') && (
            <form onSubmit={submitPassword} noValidate className="space-y-2">
              <label htmlFor={passwordId} className="block text-sm font-semibold text-ink">
                Current password
              </label>
              <input
                ref={passwordRef}
                id={passwordId}
                name="current-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  if (fieldError) setFieldError(null);
                }}
                disabled={busy !== null}
                aria-invalid={Boolean(fieldError)}
                aria-describedby={fieldError ? `${passwordId}-error` : undefined}
                className="block w-full rounded-md border border-cream-300 px-3 py-2 text-sm focus:border-forest focus:outline-none focus:ring-2 focus:ring-forest/30 disabled:bg-cream-50"
              />
              {fieldError && (
                <p id={`${passwordId}-error`} role="alert" className="text-xs text-red-700">
                  {fieldError}
                </p>
              )}
              <button
                type="submit"
                disabled={busy !== null}
                aria-busy={busy === 'password'}
                className={primaryButton}
              >
                {busy === 'password' ? 'Verifying password...' : 'Verify password'}
              </button>
            </form>
          )}

          {providerMethods.map((method) => (
            <button
              key={method}
              type="button"
              onClick={() => void verifyWithProvider(method)}
              disabled={busy !== null}
              aria-busy={busy === method}
              className={methods.includes('password') ? secondaryButton : primaryButton}
            >
              {busy === method
                ? `Waiting for ${PROVIDER_LABEL[method]}...`
                : `Verify with ${PROVIDER_LABEL[method]}`}
            </button>
          ))}

          {methods.length === 0 && (
            <p className="text-sm text-ink-muted">
              This account’s sign-in method can’t be confirmed here. Sign out and sign in again to
              continue.
            </p>
          )}

          <button
            type="button"
            onClick={onCancel}
            disabled={busy !== null}
            className={secondaryButton}
          >
            Cancel
          </button>
        </div>
      )}

      {step === 'email-otp' && owner && (
        <div className="mt-4">
          <OtpEntryForm user={owner} onVerified={handleOtpVerified} />
        </div>
      )}

      {step === 'session-ended' && (
        <div className="mt-4 space-y-2">
          {!error && (
            <p className="text-sm text-ink-muted" role="alert">
              Your session has ended. Sign in again to continue.
            </p>
          )}
          <button type="button" onClick={onCancel} className={secondaryButton}>
            Close
          </button>
        </div>
      )}
    </div>
  );
}

export default ReauthenticationPanel;
