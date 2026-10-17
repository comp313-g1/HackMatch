import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AuthSplitLayout } from './AuthSplitLayout';
import {
  completePasswordReset,
  describePasswordResetLinkError,
  validatePasswordResetLink,
  type PasswordResetLinkError,
} from './passwordResetConfirm';
import {
  PASSWORD_POLICY_MESSAGE,
  validatePassword,
  validatePasswordConfirmation,
} from './validation';

export type PasswordResetFormStatus =
  | 'loading'
  | 'empty'
  | 'ready'
  | 'submitting'
  | 'success'
  | 'error';

export interface PasswordResetFormProps {
  /** Override oobCode (defaults to URL `oobCode` query param). */
  actionCode?: string | null;
  /** Override mode (defaults to URL `mode` query param). */
  mode?: string | null;
  onNavigateToSignIn?: () => void;
  onNavigateToRecover?: () => void;
}

const inputClass =
  'w-full px-3 py-2 border rounded-md shadow-sm text-sm bg-white focus:outline-none focus:ring-2 focus:ring-forest focus:border-forest disabled:bg-cream-100 disabled:text-ink-muted';
const primaryBtnClass =
  'w-full mt-2 py-2.5 px-4 border border-transparent rounded-md shadow-sm text-sm font-semibold text-white bg-forest hover:bg-forest-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-forest disabled:opacity-50';
const secondaryBtnClass =
  'w-full py-2 px-4 border border-cream-200 rounded-md shadow-sm text-sm font-medium text-ink bg-white hover:bg-cream-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-forest';

function readQueryParam(name: string): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get(name);
}

function scrubOobCodeFromUrl(): void {
  if (typeof window === 'undefined' || !window.location.search) return;
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
    // History may be restricted in some test environments
  }
}

export function PasswordResetForm({
  actionCode: propActionCode,
  mode: propMode,
  onNavigateToSignIn,
  onNavigateToRecover,
}: PasswordResetFormProps): React.JSX.Element {
  const [status, setStatus] = useState<PasswordResetFormStatus>('loading');
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [oobCode, setOobCode] = useState<string>('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{
    password?: string;
    confirmPassword?: string;
  }>({});
  const [linkError, setLinkError] = useState<PasswordResetLinkError | null>(null);
  const [submitError, setSubmitError] = useState<PasswordResetLinkError | null>(null);

  const hasValidatedRef = useRef(false);

  const resolvedCode =
    propActionCode !== undefined ? propActionCode : readQueryParam('oobCode');
  const resolvedMode = propMode !== undefined ? propMode : readQueryParam('mode');

  const validateLink = useCallback(async (code: string) => {
    setStatus('loading');
    setLinkError(null);
    try {
      const email = await validatePasswordResetLink(code);
      setAccountEmail(email);
      setOobCode(code);
      setStatus('ready');
    } catch (err: unknown) {
      setLinkError(describePasswordResetLinkError(err));
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    if (hasValidatedRef.current) return;
    scrubOobCodeFromUrl();

    if (resolvedMode && resolvedMode !== 'resetPassword') {
      hasValidatedRef.current = true;
      setLinkError({
        kind: 'invalid',
        message: 'Invalid action mode for password reset.',
      });
      setStatus('error');
      return;
    }

    const code = resolvedCode?.trim() || '';
    if (!code) {
      hasValidatedRef.current = true;
      setStatus('empty');
      return;
    }

    hasValidatedRef.current = true;
    void validateLink(code);
  }, [resolvedCode, resolvedMode, validateLink]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (status === 'submitting' || status === 'loading') return;

    setSubmitError(null);
    const nextErrors: { password?: string; confirmPassword?: string } = {};
    const passwordError = validatePassword(password);
    if (passwordError) nextErrors.password = passwordError;
    const confirmError = validatePasswordConfirmation(password, confirmPassword);
    if (confirmError) nextErrors.confirmPassword = confirmError;

    if (Object.keys(nextErrors).length > 0) {
      // Preserve password + confirm values (NR-017 / task requirement).
      setFieldErrors(nextErrors);
      setStatus('ready');
      return;
    }

    setFieldErrors({});
    setStatus('submitting');

    try {
      await completePasswordReset(oobCode, password);
      setPassword('');
      setConfirmPassword('');
      setStatus('success');
    } catch (err: unknown) {
      const described = describePasswordResetLinkError(err);
      if (described.kind === 'expired' || described.kind === 'invalid') {
        setLinkError(described);
        setStatus('error');
        return;
      }
      if (described.kind === 'weak_password') {
        setFieldErrors({ password: described.message });
      } else {
        setSubmitError(described);
      }
      // Preserve entered passwords on non-link failures.
      setStatus('ready');
    }
  };

  if (status === 'loading') {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-busy="true"
        className="max-w-md w-full mx-auto p-6 bg-white rounded-xl border border-cream-200 shadow-sm text-center"
      >
        <h2 className="font-display text-xl font-semibold text-forest-900 mb-2">
          Checking reset link
        </h2>
        <p className="text-sm text-ink-muted">Validating your password reset link…</p>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="max-w-md w-full mx-auto p-6 bg-white rounded-xl border border-cream-200 shadow-sm"
      >
        <h2 className="font-display text-xl font-semibold text-center text-forest-900 mb-2">
          Password updated
        </h2>
        <p className="text-sm text-ink-muted text-center mb-4">
          Your password has been changed. Sign in with your new password — you will still need to
          complete email verification (OTP) before accessing your account.
        </p>
        {onNavigateToSignIn && (
          <button type="button" onClick={onNavigateToSignIn} className={primaryBtnClass}>
            Continue to sign in
          </button>
        )}
      </div>
    );
  }

  if (status === 'empty' || status === 'error') {
    const title = status === 'empty' ? 'Reset link required' : 'Reset link unavailable';
    const message =
      status === 'empty'
        ? 'Open the password reset link from your email, or request a new link below.'
        : linkError?.message ||
          'This password reset link is invalid or has already been used. Please request a new link.';

    return (
      <div
        role="alert"
        className="max-w-md w-full mx-auto p-6 bg-white rounded-xl border border-cream-200 shadow-sm"
      >
        <h2 className="font-display text-xl font-semibold text-center text-forest-900 mb-2">
          {title}
        </h2>
        <p className="text-sm text-ink-muted text-center mb-6">{message}</p>
        <div className="space-y-2">
          {onNavigateToRecover && (
            <button type="button" onClick={onNavigateToRecover} className={primaryBtnClass}>
              Request a new reset link
            </button>
          )}
          {onNavigateToSignIn && (
            <button type="button" onClick={onNavigateToSignIn} className={secondaryBtnClass}>
              Back to sign in
            </button>
          )}
        </div>
      </div>
    );
  }

  const busy = status === 'submitting';

  return (
    <AuthSplitLayout
      title="Choose a new password"
      description="Enter a new password that meets the HackMatch security policy. This link can only be used once."
    >
      {accountEmail && (
        <p className="mb-4 text-sm text-ink-muted">
          Resetting password for{' '}
          <span className="font-semibold text-ink">{accountEmail}</span>
        </p>
      )}

      {submitError && (
        <div
          role="alert"
          className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-md"
        >
          {submitError.message}
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div>
          <label htmlFor="reset-password" className="block text-sm font-medium text-ink mb-1">
            New password
          </label>
          <input
            id="reset-password"
            name="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (fieldErrors.password) {
                setFieldErrors((prev) => ({ ...prev, password: undefined }));
              }
              if (submitError) setSubmitError(null);
            }}
            disabled={busy}
            aria-invalid={Boolean(fieldErrors.password)}
            aria-describedby={
              fieldErrors.password ? 'reset-password-error reset-password-hint' : 'reset-password-hint'
            }
            className={`${inputClass} ${
              fieldErrors.password ? 'border-red-300 text-red-900' : 'border-cream-200'
            }`}
            placeholder="••••••••"
          />
          <p id="reset-password-hint" className="mt-1 text-xs text-ink-muted">
            {PASSWORD_POLICY_MESSAGE.replace('Password must be', 'Must be')}
          </p>
          {fieldErrors.password && (
            <p id="reset-password-error" role="alert" className="mt-1 text-xs text-red-600">
              {fieldErrors.password}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="reset-password-confirm"
            className="block text-sm font-medium text-ink mb-1"
          >
            Confirm new password
          </label>
          <input
            id="reset-password-confirm"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value);
              if (fieldErrors.confirmPassword) {
                setFieldErrors((prev) => ({ ...prev, confirmPassword: undefined }));
              }
              if (submitError) setSubmitError(null);
            }}
            disabled={busy}
            aria-invalid={Boolean(fieldErrors.confirmPassword)}
            aria-describedby={
              fieldErrors.confirmPassword ? 'reset-confirm-error' : undefined
            }
            className={`${inputClass} ${
              fieldErrors.confirmPassword ? 'border-red-300 text-red-900' : 'border-cream-200'
            }`}
            placeholder="••••••••"
          />
          {fieldErrors.confirmPassword && (
            <p id="reset-confirm-error" role="alert" className="mt-1 text-xs text-red-600">
              {fieldErrors.confirmPassword}
            </p>
          )}
        </div>

        <button type="submit" disabled={busy} aria-busy={busy} className={primaryBtnClass}>
          {busy ? 'Updating password…' : 'Update password'}
        </button>
      </form>

      {onNavigateToSignIn && (
        <p className="mt-4 text-sm text-center text-ink-muted">
          Remembered your password?{' '}
          <button
            type="button"
            onClick={onNavigateToSignIn}
            className="font-medium text-forest-700 underline hover:text-forest-900 focus:outline-none focus:ring-2 focus:ring-forest rounded"
          >
            Sign in
          </button>
        </p>
      )}
    </AuthSplitLayout>
  );
}

export default PasswordResetForm;
