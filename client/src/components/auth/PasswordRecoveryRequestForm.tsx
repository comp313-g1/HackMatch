import React, { useState } from 'react';
import { validateEmail } from './validation';
import { AuthSplitLayout } from './AuthSplitLayout';
import {
  GENERIC_PASSWORD_RECOVERY_CONFIRMATION,
  describePasswordRecoveryRequestError,
  requestPasswordReset,
  type PasswordRecoveryRequestError,
} from './passwordRecoveryRequest';

export interface PasswordRecoveryRequestFormProps {
  /** Prefill when navigating from sign-in with an email already typed. */
  initialEmail?: string;
  onNavigateToSignIn?: () => void;
  onNavigateToRegister?: () => void;
}

const inputClass =
  'w-full px-3 py-2 border rounded-md shadow-sm text-sm bg-white focus:outline-none focus:ring-2 focus:ring-forest focus:border-forest disabled:bg-cream-100 disabled:text-ink-muted';
const primaryBtnClass =
  'w-full mt-2 py-2.5 px-4 border border-transparent rounded-md shadow-sm text-sm font-semibold text-white bg-forest hover:bg-forest-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-forest disabled:opacity-50';
const secondaryBtnClass =
  'w-full py-2 px-4 border border-cream-200 rounded-md shadow-sm text-sm font-medium text-ink bg-white hover:bg-cream-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-forest';

type FormStatus = 'empty' | 'ready' | 'loading' | 'success' | 'error';

export function PasswordRecoveryRequestForm({
  initialEmail = '',
  onNavigateToSignIn,
  onNavigateToRegister,
}: PasswordRecoveryRequestFormProps): React.JSX.Element {
  const [email, setEmail] = useState(initialEmail);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<PasswordRecoveryRequestError | null>(null);
  const [status, setStatus] = useState<FormStatus>(initialEmail.trim() ? 'ready' : 'empty');

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (status === 'loading') return;
    setFormError(null);

    const emailError = validateEmail(email);
    if (emailError) {
      setFieldError(emailError);
      setStatus(email.trim() ? 'ready' : 'empty');
      return;
    }

    setFieldError(null);
    setStatus('loading');
    const normalized = email.trim().toLowerCase();

    try {
      await requestPasswordReset(normalized);
      setEmail(normalized);
      setStatus('success');
    } catch (err: unknown) {
      const described = describePasswordRecoveryRequestError(err);
      setFormError(described);
      // Preserve entered email on failure (US-005 / FR-084-style retention of nonsensitive data).
      setStatus('error');
    }
  };

  if (status === 'success') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="max-w-md w-full mx-auto p-6 bg-white rounded-xl border border-cream-200 shadow-sm"
      >
        <h3 className="font-display text-xl font-semibold text-center text-forest-900 mb-2">
          Check your email
        </h3>
        <p className="text-sm text-ink-muted text-center mb-4">{GENERIC_PASSWORD_RECOVERY_CONFIRMATION}</p>
        <p className="text-xs text-ink-muted text-center mb-6">
          We sent this confirmation for{' '}
          <span className="font-semibold text-ink">{email}</span> without confirming whether that
          address is registered.
        </p>
        {onNavigateToSignIn && (
          <button type="button" onClick={onNavigateToSignIn} className={primaryBtnClass}>
            Back to sign in
          </button>
        )}
      </div>
    );
  }

  const loading = status === 'loading';

  return (
    <AuthSplitLayout
      title="Reset password"
      description="Enter the email for your HackMatch account. We will send reset instructions when an eligible credential account exists — the confirmation looks the same either way."
    >
      {formError && (
        <div
          role="alert"
          className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-md"
        >
          {formError.message}
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div>
          <label htmlFor="recovery-email" className="block text-sm font-medium text-ink mb-1">
            Email Address
          </label>
          <input
            id="recovery-email"
            name="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => {
              const next = e.target.value;
              setEmail(next);
              if (fieldError) setFieldError(null);
              if (formError) setFormError(null);
              setStatus(next.trim() ? 'ready' : 'empty');
            }}
            disabled={loading}
            aria-invalid={Boolean(fieldError)}
            aria-describedby={
              fieldError
                ? 'recovery-email-error'
                : !email.trim()
                  ? 'recovery-email-hint'
                  : undefined
            }
            className={`${inputClass} ${
              fieldError ? 'border-red-300 text-red-900' : 'border-cream-200'
            }`}
            placeholder="jane@example.com"
          />
          {fieldError && (
            <p id="recovery-email-error" role="alert" className="mt-1 text-xs text-red-600">
              {fieldError}
            </p>
          )}
          {!email.trim() && !fieldError && (
            <p id="recovery-email-hint" className="mt-1 text-xs text-ink-muted">
              Enter the email you use to sign in with a password.
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={loading}
          aria-busy={loading}
          className={primaryBtnClass}
        >
          {loading ? 'Sending...' : 'Send reset link'}
        </button>
      </form>

      <div className="mt-4 space-y-2 text-sm text-center text-ink-muted">
        {onNavigateToSignIn && (
          <p>
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
        {onNavigateToRegister && (
          <p>
            New to HackMatch?{' '}
            <button
              type="button"
              onClick={onNavigateToRegister}
              className="font-medium text-forest-700 underline hover:text-forest-900 focus:outline-none focus:ring-2 focus:ring-forest rounded"
            >
              Create an account
            </button>
          </p>
        )}
      </div>

      {!loading && status === 'error' && (
        <button
          type="button"
          onClick={() => {
            setFormError(null);
            setStatus(email.trim() ? 'ready' : 'empty');
          }}
          className={`${secondaryBtnClass} mt-4`}
        >
          Try again
        </button>
      )}
    </AuthSplitLayout>
  );
}

export default PasswordRecoveryRequestForm;
