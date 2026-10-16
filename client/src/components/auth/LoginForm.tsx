import React, { useState } from 'react';
import { signInWithEmailAndPassword, type User } from 'firebase/auth';
import { auth } from '../../config/firebase';
import {
  validateLoginInput,
  describeLoginError,
  type LoginError,
  type LoginValidationErrors,
} from './loginErrors';
import { assertAccountActive } from './accountStatus';
import { requestMfaChallenge } from './mfaChallenge';
import { AuthSplitLayout } from './AuthSplitLayout';

export interface PrimaryAuthResult {
  email: string;
  user: User;
}

export interface LoginFormProps {
  /** Called after Firebase accepts the password; the email OTP step (US-004) must follow. */
  onPrimaryAuthSuccess?: (result: PrimaryAuthResult) => void;
  onNavigateToRegister?: () => void;
}

const inputClass =
  'w-full px-3 py-2 border rounded-md shadow-sm text-sm bg-white focus:outline-none focus:ring-2 focus:ring-forest focus:border-forest disabled:bg-cream-100 disabled:text-ink-muted';
const primaryBtnClass =
  'w-full mt-2 py-2.5 px-4 border border-transparent rounded-md shadow-sm text-sm font-semibold text-white bg-forest hover:bg-forest-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-forest disabled:opacity-50';
const secondaryBtnClass =
  'w-full py-2 px-4 border border-cream-200 rounded-md shadow-sm text-sm font-medium text-ink bg-white hover:bg-cream-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-forest';

export function LoginForm({
  onPrimaryAuthSuccess,
  onNavigateToRegister,
}: LoginFormProps): React.JSX.Element {
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [fieldErrors, setFieldErrors] = useState<LoginValidationErrors>({});
  const [formError, setFormError] = useState<LoginError | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (loading) return;
    setFormError(null);

    const errors = validateLoginInput(email, password);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    setLoading(true);
    const normalizedEmail = email.trim().toLowerCase();

    try {
      const credential = await signInWithEmailAndPassword(auth, normalizedEmail, password);
      // Block suspended / Firebase-disabled accounts before any MFA or session step (US-003-T4).
      await assertAccountActive(credential.user);
      // US-004 AC 1 / FR-009: generate + email a cryptographically random 6-digit OTP.
      await requestMfaChallenge(credential.user);
      setPassword('');
      setSignedInEmail(normalizedEmail);
      onPrimaryAuthSuccess?.({ email: normalizedEmail, user: credential.user });
    } catch (err: unknown) {
      const loginError = describeLoginError(err);
      setFormError(loginError);
      if (
        loginError.kind === 'credentials' ||
        loginError.kind === 'suspended' ||
        loginError.kind === 'disabled'
      ) {
        setPassword('');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleUseDifferentAccount = () => {
    setSignedInEmail(null);
    setEmail('');
    setPassword('');
    setFieldErrors({});
    setFormError(null);
  };

  if (signedInEmail) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="max-w-md w-full mx-auto p-6 bg-white rounded-xl border border-cream-200 shadow-sm"
      >
        <h3 className="font-display text-xl font-semibold text-center text-forest-900 mb-2">
          Password Accepted
        </h3>
        <p className="text-sm text-ink-muted text-center mb-4">
          Signed in as <span className="font-semibold text-ink">{signedInEmail}</span>.
        </p>
        <div className="p-3 bg-forest-50 border border-forest-100 text-forest-900 text-xs rounded-md mb-6">
          <p className="font-medium mb-1">One more step:</p>
          <p>
            For your security, you must enter the one-time code sent to your email before you can
            use your account.
          </p>
        </div>
        <button type="button" onClick={handleUseDifferentAccount} className={secondaryBtnClass}>
          Use a different account
        </button>
      </div>
    );
  }

  return (
    <AuthSplitLayout
      title="Sign In"
      description="Sign in with your HackMatch email and password."
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
          <label htmlFor="login-email" className="block text-sm font-medium text-ink mb-1">
            Email Address
          </label>
          <input
            id="login-email"
            name="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (fieldErrors.email) {
                setFieldErrors((prev) => ({ ...prev, email: undefined }));
              }
            }}
            disabled={loading}
            aria-invalid={Boolean(fieldErrors.email)}
            aria-describedby={fieldErrors.email ? 'login-email-error' : undefined}
            className={`${inputClass} ${
              fieldErrors.email ? 'border-red-300 text-red-900' : 'border-cream-200'
            }`}
            placeholder="jane@example.com"
          />
          {fieldErrors.email && (
            <p id="login-email-error" role="alert" className="mt-1 text-xs text-red-600">
              {fieldErrors.email}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="login-password" className="block text-sm font-medium text-ink mb-1">
            Password
          </label>
          <input
            id="login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (fieldErrors.password) {
                setFieldErrors((prev) => ({ ...prev, password: undefined }));
              }
            }}
            disabled={loading}
            aria-invalid={Boolean(fieldErrors.password)}
            aria-describedby={fieldErrors.password ? 'login-password-error' : undefined}
            className={`${inputClass} ${
              fieldErrors.password ? 'border-red-300 text-red-900' : 'border-cream-200'
            }`}
            placeholder="••••••••"
          />
          {fieldErrors.password && (
            <p id="login-password-error" role="alert" className="mt-1 text-xs text-red-600">
              {fieldErrors.password}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={loading}
          aria-busy={loading}
          className={primaryBtnClass}
        >
          {loading ? 'Signing In...' : 'Sign In'}
        </button>
      </form>

      {onNavigateToRegister && (
        <p className="mt-4 text-sm text-center text-ink-muted">
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
    </AuthSplitLayout>
  );
}

export default LoginForm;
