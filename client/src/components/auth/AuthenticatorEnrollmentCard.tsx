import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  AuthenticatorEnrollmentApiError,
  beginAuthenticatorEnrollment,
  confirmAuthenticatorEnrollment,
  getAuthenticatorEnrollmentStatus,
  restartAuthenticatorEnrollment,
  type PendingAuthenticatorEnrollment,
} from './authenticatorEnrollmentApi';

type Phase =
  | 'checking'
  | 'status-error'
  | 'idle'
  | 'starting'
  | 'restarting'
  | 'pending-existing'
  | 'setup'
  | 'confirming'
  | 'active';

export interface AuthenticatorEnrollmentCardProps {
  /** Changing this value clears all owner-specific setup material from memory. */
  identityKey: string;
}

const primaryButton =
  'w-full py-2.5 px-4 rounded-md text-sm font-semibold text-white bg-forest hover:bg-forest-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-forest disabled:opacity-50';
const secondaryButton =
  'w-full py-2 px-4 border border-cream-300 rounded-md text-sm font-medium text-ink bg-white hover:bg-cream-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-forest disabled:opacity-50';

const CLEAR_SETUP_CODES = new Set([
  'AUTHENTICATOR_ENROLLMENT_EXPIRED',
  'AUTHENTICATOR_ENROLLMENT_STALE',
  'AUTHENTICATOR_ENROLLMENT_NOT_PENDING',
  'AUTH_REQUIRED',
  'UNAUTHORIZED',
  'TOKEN_EXPIRED',
  'TOKEN_REVOKED',
  'MFA_REQUIRED',
  'REAUTHENTICATION_REQUIRED',
  'AUTHENTICATOR_ENROLLMENT_FORBIDDEN',
]);

function friendlyError(error: unknown): { code: string; message: string } {
  if (!(error instanceof AuthenticatorEnrollmentApiError)) {
    return { code: 'UNKNOWN_ERROR', message: 'Authenticator setup failed. Please try again.' };
  }
  if (error.code === 'REAUTHENTICATION_REQUIRED') {
    return {
      code: error.code,
      message: 'For your security, sign out and sign in again before changing authenticator settings.',
    };
  }
  if (error.code === 'MFA_REQUIRED') {
    return {
      code: error.code,
      message: 'Complete the email verification-code step for this session, then try again.',
    };
  }
  if (error.code === 'AUTH_REQUIRED' || error.code === 'UNAUTHORIZED') {
    return { code: error.code, message: 'Your session has ended. Sign in again to continue.' };
  }
  return { code: error.code, message: error.message };
}

export function AuthenticatorEnrollmentCard({
  identityKey,
}: AuthenticatorEnrollmentCardProps): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>('checking');
  const [pending, setPending] = useState<PendingAuthenticatorEnrollment | null>(null);
  const [code, setCode] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [activatedAt, setActivatedAt] = useState<string | null>(null);
  const [pendingExpiresAt, setPendingExpiresAt] = useState<string | null>(null);
  const codeInputId = useId();
  const codeInputRef = useRef<HTMLInputElement>(null);
  const statusRequestId = useRef(0);
  const busy = phase === 'starting' || phase === 'restarting' || phase === 'confirming';

  const clearSensitiveState = useCallback(() => {
    setPending(null);
    setCode('');
    setFieldError(null);
  }, []);

  const loadStatus = useCallback(async () => {
    const requestId = ++statusRequestId.current;
    setPhase('checking');
    setError(null);
    try {
      const result = await getAuthenticatorEnrollmentStatus();
      if (requestId !== statusRequestId.current) return;
      if (result.authenticator.status === 'active') {
        setActivatedAt(result.authenticator.activatedAt);
        setPendingExpiresAt(null);
        setPhase('active');
      } else if (result.authenticator.status === 'pending') {
        setActivatedAt(null);
        setPendingExpiresAt(result.authenticator.expiresAt);
        setPhase('pending-existing');
      } else {
        setActivatedAt(null);
        setPendingExpiresAt(null);
        setPhase('idle');
      }
    } catch (caught: unknown) {
      if (requestId !== statusRequestId.current) return;
      setError(friendlyError(caught));
      setPhase('status-error');
    }
  }, []);

  useEffect(() => {
    statusRequestId.current += 1;
    clearSensitiveState();
    setError(null);
    setActivatedAt(null);
    setPendingExpiresAt(null);
    void loadStatus();
    return () => {
      statusRequestId.current += 1;
    };
  }, [identityKey, clearSensitiveState, loadStatus]);

  const start = async () => {
    if (busy) return;
    clearSensitiveState();
    setError(null);
    setActivatedAt(null);
    setPendingExpiresAt(null);
    setPhase('starting');
    try {
      const enrollment = await beginAuthenticatorEnrollment();
      setPending(enrollment);
      setPhase('setup');
      requestAnimationFrame(() => codeInputRef.current?.focus());
    } catch (caught: unknown) {
      const safe = friendlyError(caught);
      if (safe.code === 'AUTHENTICATOR_ALREADY_ACTIVE') {
        setPhase('active');
        setError(null);
      } else if (safe.code === 'AUTHENTICATOR_ENROLLMENT_PENDING') {
        setPhase('pending-existing');
        setPendingExpiresAt(null);
        setError(safe);
      } else {
        setPhase('idle');
        setError(safe);
      }
    }
  };

  const confirm = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!pending || busy) return;
    const normalizedCode = code.trim();
    if (!/^\d{6}$/.test(normalizedCode)) {
      setFieldError('Enter exactly 6 digits from your authenticator app.');
      codeInputRef.current?.focus();
      return;
    }

    setFieldError(null);
    setError(null);
    setPhase('confirming');
    try {
      const result = await confirmAuthenticatorEnrollment(
        pending.authenticator.enrollmentId,
        normalizedCode
      );
      clearSensitiveState();
      setActivatedAt(result.authenticator.activatedAt);
      setPhase('active');
    } catch (caught: unknown) {
      const safe = friendlyError(caught);
      if (safe.code === 'AUTHENTICATOR_ALREADY_ACTIVE') {
        clearSensitiveState();
        setPhase('active');
        setError(null);
        return;
      }
      if (CLEAR_SETUP_CODES.has(safe.code)) {
        clearSensitiveState();
        setPhase('idle');
      } else {
        setPhase('setup');
        requestAnimationFrame(() => codeInputRef.current?.focus());
      }
      setError(safe);
    }
  };

  const restart = async () => {
    if (busy) return;
    clearSensitiveState();
    setError(null);
    setPendingExpiresAt(null);
    setPhase('restarting');
    try {
      const enrollment = await restartAuthenticatorEnrollment();
      setPending(enrollment);
      setPhase('setup');
      requestAnimationFrame(() => codeInputRef.current?.focus());
    } catch (caught: unknown) {
      const safe = friendlyError(caught);
      if (safe.code === 'AUTHENTICATOR_ALREADY_ACTIVE') {
        setPhase('active');
        setError(null);
      } else if (safe.code === 'AUTHENTICATOR_ENROLLMENT_NOT_PENDING') {
        setPhase('idle');
        setError(safe);
      } else {
        setPhase('pending-existing');
        setError(safe);
      }
    }
  };

  const cancel = () => {
    clearSensitiveState();
    setError(null);
    setPhase('idle');
  };

  const confirmationRequired =
    phase === 'setup' || phase === 'confirming' || phase === 'pending-existing';

  return (
    <section
      aria-labelledby="authenticator-enrollment-heading"
      className="max-w-md w-full mx-auto p-6 bg-white rounded-xl border border-cream-200 shadow-sm"
      data-testid="authenticator-enrollment-card"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3
            id="authenticator-enrollment-heading"
            className="font-display text-xl font-semibold text-forest-900"
          >
            Authenticator app
          </h3>
          <p className="mt-1 text-sm text-ink-muted">
            Use a standards-compatible app to generate instant 6-digit verification codes.
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
            phase === 'active'
              ? 'bg-green-100 text-green-800'
              : confirmationRequired
                ? 'bg-amber-100 text-amber-800'
                : 'bg-cream-100 text-ink-muted'
          }`}
        >
          {phase === 'active'
            ? 'Active'
            : confirmationRequired
              ? 'Confirmation required'
              : phase === 'checking'
                ? 'Checking'
                : 'Not set up'}
        </span>
      </div>

      <div className="mt-4 rounded-md border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900">
        Email verification codes remain available as a fallback after setup.
      </div>

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          data-testid="authenticator-enrollment-error"
        >
          {error.message}
        </div>
      )}

      {phase === 'active' ? (
        <div className="mt-5" role="status" aria-live="polite">
          <p className="font-semibold text-green-800">Your authenticator app is active.</p>
          <p className="mt-1 text-sm text-ink-muted">
            You can use authenticator codes when supported, and email codes remain available.
          </p>
          {activatedAt && (
            <p className="mt-2 text-xs text-ink-muted">
              Activated {new Date(activatedAt).toLocaleString()}.
            </p>
          )}
        </div>
      ) : phase === 'pending-existing' ? (
        <div className="mt-5" role="status" aria-live="polite">
          <p className="font-semibold text-amber-800">Authenticator setup is pending.</p>
          <p className="mt-1 text-sm text-ink-muted">
            For security, setup keys are shown only when enrollment starts. Restart setup to
            invalidate the previous key and receive new setup material.
          </p>
          {pendingExpiresAt && (
            <p className="mt-2 text-xs text-ink-muted">
              Pending setup expires {new Date(pendingExpiresAt).toLocaleString()}.
            </p>
          )}
          <div className="mt-4 space-y-2">
            <button type="button" onClick={() => void restart()} className={primaryButton}>
              Restart authenticator setup
            </button>
            <button type="button" onClick={() => void loadStatus()} className={secondaryButton}>
              Check status again
            </button>
          </div>
        </div>
      ) : pending && (phase === 'setup' || phase === 'confirming') ? (
        <div className="mt-5 space-y-5">
          <div className="text-center">
            <p className="text-sm font-semibold text-ink">
              Scan this QR code with your authenticator app
            </p>
            <div
              className="mx-auto mt-3 inline-flex max-w-full rounded-lg border border-cream-200 bg-white p-3"
              data-testid="authenticator-qr-code"
            >
              <QRCodeSVG
                value={pending.setup.otpauthUri}
                title="Authenticator enrollment QR code"
                size={192}
                level="M"
                marginSize={1}
              />
            </div>
            <p className="mt-2 text-xs text-ink-muted">
              The QR code contains the same sensitive setup key shown below.
            </p>
          </div>

          <div>
            <p className="text-sm font-semibold text-ink">Cannot scan the QR code?</p>
            <p className="mt-1 text-sm text-ink-muted">
              Choose manual setup in your app and enter this key:
            </p>
            <div
              className="mt-2 overflow-wrap-anywhere break-all rounded-md border border-cream-300 bg-cream-50 p-3 font-mono text-sm tracking-wider text-ink"
              data-testid="authenticator-manual-key"
            >
              {pending.setup.manualEntryKey}
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-ink-muted">
              <dt>Issuer</dt>
              <dd className="text-right text-ink">{pending.authenticator.issuer}</dd>
              <dt>Account</dt>
              <dd className="text-right text-ink">{pending.authenticator.accountLabel}</dd>
              <dt>Code settings</dt>
              <dd className="text-right text-ink">
                {pending.authenticator.digits} digits every {pending.authenticator.periodSeconds}s
              </dd>
            </dl>
          </div>

          <form onSubmit={confirm} noValidate>
            <label htmlFor={codeInputId} className="block text-sm font-semibold text-ink">
              Authenticator code
            </label>
            <p id={`${codeInputId}-hint`} className="mt-1 text-xs text-ink-muted">
              Enter the current 6-digit code from your authenticator app.
            </p>
            <input
              ref={codeInputRef}
              id={codeInputId}
              name="authenticatorCode"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(event) => {
                setCode(event.target.value);
                if (fieldError) setFieldError(null);
              }}
              disabled={phase === 'confirming'}
              aria-invalid={Boolean(fieldError)}
              aria-describedby={
                fieldError ? `${codeInputId}-hint ${codeInputId}-error` : `${codeInputId}-hint`
              }
              className="mt-2 block w-full rounded-md border border-cream-300 px-3 py-2 text-center font-mono text-lg tracking-[0.35em] focus:border-forest focus:outline-none focus:ring-2 focus:ring-forest/30 disabled:bg-cream-50"
            />
            {fieldError && (
              <p id={`${codeInputId}-error`} role="alert" className="mt-1 text-xs text-red-700">
                {fieldError}
              </p>
            )}
            <div className="mt-4 space-y-2">
              <button
                type="submit"
                disabled={phase === 'confirming'}
                aria-busy={phase === 'confirming'}
                className={primaryButton}
              >
                {phase === 'confirming' ? 'Confirming...' : 'Confirm authenticator'}
              </button>
              <button
                type="button"
                onClick={cancel}
                disabled={phase === 'confirming'}
                className={secondaryButton}
              >
                Cancel setup
              </button>
            </div>
          </form>
        </div>
      ) : phase === 'checking' || phase === 'restarting' ? (
        <div role="status" aria-live="polite" aria-busy="true" className="mt-5 text-center">
          <div
            className="mx-auto mb-2 h-7 w-7 rounded-full border-4 border-forest-100 border-t-forest animate-spin"
            aria-hidden="true"
          />
          <p className="text-sm text-ink-muted">
            {phase === 'restarting' ? 'Restarting authenticator setup...' : 'Checking authenticator status...'}
          </p>
        </div>
      ) : phase === 'status-error' ? (
        <div className="mt-5">
          <button type="button" onClick={() => void loadStatus()} className={secondaryButton}>
            Check authenticator status again
          </button>
        </div>
      ) : (
        <div className="mt-5">
          <button
            type="button"
            onClick={() => void start()}
            disabled={phase === 'starting'}
            aria-busy={phase === 'starting'}
            className={primaryButton}
          >
            {phase === 'starting' ? 'Starting setup...' : 'Set up authenticator app'}
          </button>
        </div>
      )}
    </section>
  );
}

export default AuthenticatorEnrollmentCard;
