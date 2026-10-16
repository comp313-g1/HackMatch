import React, { useEffect, useState } from 'react';
import { getIdToken, type User } from 'firebase/auth';
import type { OtpChallenge } from './providerSignIn';
import { requestMfaChallenge } from './mfaChallenge';
import { verifyMfaCode } from './mfaVerify';
import { logout } from './logout';
import { translateOAuthServerError } from './oauthErrors';

export interface OtpEntryFormProps {
  user: User;
  /** Challenge from primary auth; if omitted, a new challenge is requested on mount. */
  initialChallenge?: OtpChallenge | null;
  onVerified: () => void;
  onSignedOut?: () => void;
}

type FormStatus = 'ready' | 'loading' | 'submitting' | 'resending' | 'success' | 'error';

const cardClass =
  'max-w-md w-full mx-auto p-6 bg-white rounded-xl border border-cream-200 shadow-sm';
const primaryBtnClass =
  'w-full py-2.5 px-4 border border-transparent rounded-md shadow-sm text-sm font-semibold text-white bg-forest hover:bg-forest-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-forest disabled:opacity-50';
const secondaryBtnClass =
  'w-full py-2 px-4 border border-cream-200 rounded-md shadow-sm text-sm font-medium text-ink bg-white hover:bg-cream-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-forest disabled:opacity-50';
const inputClass =
  'w-full px-3 py-2 border rounded-md shadow-sm text-sm tracking-[0.35em] text-center font-semibold bg-white focus:outline-none focus:ring-2 focus:ring-forest focus:border-forest disabled:bg-cream-100 disabled:text-ink-muted';

/** Default lock window (FR-010) when the API omits retryAfter. */
const DEFAULT_LOCK_SECONDS = 15 * 60;

function formatRemaining(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function readErrorMeta(err: unknown): { code: string; message: string; retryAfter?: number } {
  const code =
    err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : '';
  const retryAfter =
    err && typeof err === 'object' && 'retryAfter' in err
      ? Number((err as { retryAfter: unknown }).retryAfter)
      : undefined;
  const message =
    err instanceof Error ? err.message : 'Something went wrong. Please try again.';
  return {
    code,
    message,
    retryAfter: Number.isFinite(retryAfter) ? retryAfter : undefined,
  };
}

export function OtpEntryForm({
  user,
  initialChallenge = null,
  onVerified,
  onSignedOut,
}: OtpEntryFormProps): React.JSX.Element {
  const [challenge, setChallenge] = useState<OtpChallenge | null>(initialChallenge);
  const [code, setCode] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState<FormStatus>(initialChallenge ? 'ready' : 'loading');
  const [secondsLeft, setSecondsLeft] = useState(initialChallenge?.expiresInSeconds ?? 0);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [lockSecondsLeft, setLockSecondsLeft] = useState(0);
  const [signingOut, setSigningOut] = useState(false);

  const applyAccountLock = (retryAfter?: number, fallbackMessage?: string) => {
    const seconds =
      typeof retryAfter === 'number' && retryAfter > 0 ? Math.ceil(retryAfter) : DEFAULT_LOCK_SECONDS;
    setLockSecondsLeft(seconds);
    setCode('');
    setFieldError(null);
    setFormError(
      fallbackMessage && fallbackMessage.trim()
        ? fallbackMessage
        : translateOAuthServerError('ACCOUNT_LOCKED', seconds)
    );
    setStatus('error');
  };

  /** FR-084: clear stale challenge after send failure; keep UI ready for controlled retry. */
  const applyDeliveryFailure = (fallbackMessage?: string) => {
    setChallenge(null);
    setSecondsLeft(0);
    setCode('');
    setFieldError(null);
    setFormError(
      fallbackMessage && fallbackMessage.trim()
        ? fallbackMessage
        : translateOAuthServerError('EMAIL_DELIVERY_FAILED')
    );
    setStatus('error');
  };

  useEffect(() => {
    if (initialChallenge) {
      setChallenge(initialChallenge);
      setSecondsLeft(initialChallenge.expiresInSeconds);
      setStatus('ready');
      return;
    }

    let cancelled = false;
    const bootstrap = async () => {
      setStatus('loading');
      setFormError(null);
      try {
        const next = await requestMfaChallenge(user);
        if (cancelled) return;
        setChallenge({
          challengeId: next.challengeId,
          email: next.email,
          expiresInSeconds: next.expiresInSeconds,
          message: next.message,
        });
        setSecondsLeft(next.expiresInSeconds);
        setStatus('ready');
      } catch (err: unknown) {
        if (cancelled) return;
        const meta = readErrorMeta(err);
        if (meta.code === 'ACCOUNT_LOCKED') {
          applyAccountLock(meta.retryAfter, meta.message);
          return;
        }
        if (meta.code === 'EMAIL_DELIVERY_FAILED' || meta.code === 'MFA_CHALLENGE_FAILED') {
          applyDeliveryFailure(meta.message);
          return;
        }
        setFormError(meta.message);
        setStatus('error');
      }
    };
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [initialChallenge, user]);

  useEffect(() => {
    if (secondsLeft <= 0 || status === 'success' || lockSecondsLeft > 0) return;
    const timer = window.setInterval(() => {
      setSecondsLeft((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [secondsLeft, status, lockSecondsLeft]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setInterval(() => {
      setResendCooldown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendCooldown]);

  useEffect(() => {
    if (lockSecondsLeft <= 0) return;
    const timer = window.setInterval(() => {
      setLockSecondsLeft((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [lockSecondsLeft]);

  const busy = status === 'loading' || status === 'submitting' || status === 'resending';
  const locked = lockSecondsLeft > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || locked || !challenge) return;
    setFormError(null);

    const trimmed = code.trim();
    if (!trimmed) {
      setFieldError('Enter the 6-digit verification code.');
      return;
    }
    if (!/^\d{6}$/.test(trimmed)) {
      setFieldError('Enter the 6-digit verification code.');
      return;
    }

    setFieldError(null);
    setStatus('submitting');
    try {
      await verifyMfaCode(user, challenge.challengeId, trimmed);
      await getIdToken(user, true);
      setStatus('success');
      onVerified();
    } catch (err: unknown) {
      const meta = readErrorMeta(err);
      if (meta.code === 'ACCOUNT_LOCKED') {
        applyAccountLock(meta.retryAfter, meta.message);
        return;
      }
      setFormError(meta.message);
      if (meta.code === 'INVALID_OTP' || meta.code === 'OTP_EXPIRED' || meta.code === 'OTP_CONSUMED') {
        setCode('');
      }
      setStatus('error');
    }
  };

  const handleResend = async () => {
    if (busy || locked || resendCooldown > 0) return;
    setFormError(null);
    setFieldError(null);
    setStatus('resending');
    try {
      const next = await requestMfaChallenge(user);
      setChallenge({
        challengeId: next.challengeId,
        email: next.email,
        expiresInSeconds: next.expiresInSeconds,
        message: next.message,
      });
      setSecondsLeft(next.expiresInSeconds);
      setResendCooldown(60);
      setCode('');
      setStatus('ready');
    } catch (err: unknown) {
      const meta = readErrorMeta(err);
      if (meta.code === 'ACCOUNT_LOCKED') {
        applyAccountLock(meta.retryAfter, meta.message);
        return;
      }
      if (meta.code === 'EMAIL_DELIVERY_FAILED' || meta.code === 'MFA_CHALLENGE_FAILED') {
        // Server invalidated the new challenge; drop any predecessor so retry is required.
        applyDeliveryFailure(meta.message);
        return;
      }
      setFormError(meta.message);
      if (meta.code === 'RATE_LIMITED') {
        setResendCooldown(meta.retryAfter && meta.retryAfter > 0 ? Math.ceil(meta.retryAfter) : 60);
      }
      setStatus('error');
    }
  };

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await logout(user);
      onSignedOut?.();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Sign-out failed. Please try again.';
      setFormError(message);
      setStatus('error');
    } finally {
      setSigningOut(false);
    }
  };

  if (status === 'loading') {
    return (
      <div role="status" aria-live="polite" aria-busy="true" className={`${cardClass} text-center`}>
        <div
          className="mx-auto mb-3 h-8 w-8 rounded-full border-4 border-forest-100 border-t-forest animate-spin"
          aria-hidden="true"
        />
        <p className="text-sm text-ink-muted">Sending a verification code to your email...</p>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div role="status" aria-live="polite" className={`${cardClass} text-center`}>
        <h2 className="font-display text-xl font-semibold text-forest-900 mb-2">Code accepted</h2>
        <p className="text-sm text-ink-muted">Continuing to your account...</p>
      </div>
    );
  }

  if (!challenge) {
    return (
      <div className={cardClass}>
        <h2 className="font-display text-xl font-semibold text-forest-900 mb-2">
          Enter verification code
        </h2>
        {locked && (
          <div
            role="alert"
            className="mb-4 p-3 bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-md"
          >
            Account locked. Try again in{' '}
            <span className="font-semibold">{formatRemaining(lockSecondsLeft)}</span>.
          </div>
        )}
        {formError && (
          <div
            role="alert"
            className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-md"
          >
            {formError}
          </div>
        )}
        {!locked && (
          <p className="mb-4 text-xs text-ink-muted">
            No session was created. You can try sending a new verification code.
          </p>
        )}
        <div className="space-y-3">
          <button
            type="button"
            onClick={handleResend}
            disabled={busy || locked || signingOut}
            aria-busy={status === 'resending'}
            className={primaryBtnClass}
          >
            {status === 'resending'
              ? 'Sending new code...'
              : formError
                ? 'Try sending again'
                : 'Send code'}
          </button>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut || busy}
            className={secondaryBtnClass}
          >
            {signingOut ? 'Signing out...' : 'Sign out'}
          </button>
        </div>
      </div>
    );
  }

  const expired = secondsLeft <= 0;

  return (
    <div className={cardClass}>
      <h2 className="font-display text-xl font-semibold text-forest-900 mb-2">Enter verification code</h2>
      <p className="text-sm text-ink-muted mb-4">
        {challenge.email ? (
          <>
            We sent a 6-digit code to <span className="font-semibold text-ink">{challenge.email}</span>.
          </>
        ) : (
          <>We sent a 6-digit code to your email.</>
        )}{' '}
        Enter it below to finish signing in.
      </p>

      {locked ? (
        <div
          role="alert"
          className="mb-4 p-3 bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-md"
        >
          Too many incorrect codes. Account locked for{' '}
          <span className="font-semibold">{formatRemaining(lockSecondsLeft)}</span>.
        </div>
      ) : expired ? (
        <div
          role="alert"
          className="mb-4 p-3 bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-md"
        >
          This code has expired. Request a new code to continue.
        </div>
      ) : (
        <p className="mb-4 text-xs text-ink-muted" aria-live="polite">
          Code expires in <span className="font-semibold text-ink">{formatRemaining(secondsLeft)}</span>
        </p>
      )}

      {formError && (
        <div
          role="alert"
          className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-md"
        >
          {formError}
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div>
          <label htmlFor="mfa-otp-code" className="block text-sm font-medium text-ink mb-1">
            6-digit code
          </label>
          <input
            id="mfa-otp-code"
            name="otp"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => {
              const next = e.target.value.replace(/\D/g, '').slice(0, 6);
              setCode(next);
              if (fieldError) setFieldError(null);
              if (status === 'error' && !locked) setStatus('ready');
            }}
            disabled={busy || expired || locked}
            aria-invalid={Boolean(fieldError)}
            aria-describedby={fieldError ? 'mfa-otp-code-error' : undefined}
            className={`${inputClass} ${fieldError ? 'border-red-300 text-red-900' : 'border-cream-200'}`}
            placeholder="••••••"
          />
          {fieldError && (
            <p id="mfa-otp-code-error" role="alert" className="mt-1 text-xs text-red-600">
              {fieldError}
            </p>
          )}
          {!code && !fieldError && !locked && (
            <p className="mt-1 text-xs text-ink-muted">Enter the code from your email.</p>
          )}
        </div>

        <button
          type="submit"
          disabled={busy || expired || locked || signingOut}
          aria-busy={status === 'submitting'}
          className={primaryBtnClass}
        >
          {status === 'submitting' ? 'Verifying...' : 'Verify code'}
        </button>
      </form>

      <div className="mt-3 space-y-3">
        <button
          type="button"
          onClick={handleResend}
          disabled={busy || locked || resendCooldown > 0 || signingOut}
          aria-busy={status === 'resending'}
          className={secondaryBtnClass}
        >
          {status === 'resending'
            ? 'Sending new code...'
            : locked
              ? `Locked (${formatRemaining(lockSecondsLeft)})`
              : resendCooldown > 0
                ? `Resend code (${resendCooldown}s)`
                : 'Resend code'}
        </button>
        <button
          type="button"
          onClick={handleSignOut}
          disabled={signingOut || busy}
          className={secondaryBtnClass}
        >
          {signingOut ? 'Signing out...' : 'Sign out'}
        </button>
      </div>
    </div>
  );
}

export default OtpEntryForm;
