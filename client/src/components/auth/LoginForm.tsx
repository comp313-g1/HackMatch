import React, { useState } from 'react';
import { signInWithEmailAndPassword, type User } from 'firebase/auth';
import { auth } from '../../config/firebase';
import {
  validateLoginInput,
  describeLoginError,
  type LoginError,
  type LoginValidationErrors,
} from './loginErrors';

export interface PrimaryAuthResult {
  email: string;
  user: User;
}

export interface LoginFormProps {
  /** Called after Firebase accepts the password; the email OTP step (US-004) must follow. */
  onPrimaryAuthSuccess?: (result: PrimaryAuthResult) => void;
  onNavigateToRegister?: () => void;
}

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
      setPassword('');
      setSignedInEmail(normalizedEmail);
      onPrimaryAuthSuccess?.({ email: normalizedEmail, user: credential.user });
    } catch (err: unknown) {
      const loginError = describeLoginError(err);
      setFormError(loginError);
      if (loginError.kind === 'credentials') {
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
        className="max-w-md w-full mx-auto p-6 bg-white rounded-lg border border-gray-200 shadow-sm"
      >
        <h3 className="text-xl font-bold text-center text-gray-900 mb-2">Password Accepted</h3>
        <p className="text-sm text-gray-600 text-center mb-4">
          Signed in as <span className="font-semibold text-gray-900">{signedInEmail}</span>.
        </p>
        <div className="p-3 bg-blue-50 border border-blue-200 text-blue-800 text-xs rounded-md mb-6">
          <p className="font-medium mb-1">One more step:</p>
          <p>
            For your security, you must enter the one-time code sent to your email before you can
            use your account.
          </p>
        </div>
        <button
          type="button"
          onClick={handleUseDifferentAccount}
          className="w-full py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        >
          Use a different account
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-md w-full mx-auto p-6 bg-white rounded-lg border border-gray-200 shadow-sm">
      <h2 className="text-xl font-bold text-gray-900 mb-1">Sign In</h2>
      <p className="text-sm text-gray-600 mb-6">
        Sign in with your HackMatch email and password.
      </p>

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
          <label htmlFor="login-email" className="block text-sm font-medium text-gray-700 mb-1">
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
            className={`w-full px-3 py-2 border rounded-md shadow-sm text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500 ${
              fieldErrors.email ? 'border-red-300 text-red-900' : 'border-gray-300'
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
          <label htmlFor="login-password" className="block text-sm font-medium text-gray-700 mb-1">
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
            className={`w-full px-3 py-2 border rounded-md shadow-sm text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500 ${
              fieldErrors.password ? 'border-red-300 text-red-900' : 'border-gray-300'
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
          className="w-full mt-2 py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
        >
          {loading ? 'Signing In...' : 'Sign In'}
        </button>
      </form>

      {onNavigateToRegister && (
        <p className="mt-4 text-sm text-center text-gray-600">
          New to HackMatch?{' '}
          <button
            type="button"
            onClick={onNavigateToRegister}
            className="font-medium text-blue-700 underline hover:text-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
          >
            Create an account
          </button>
        </p>
      )}
    </div>
  );
}

export default LoginForm;
