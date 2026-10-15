import React, { useState } from 'react';
import {
  validateRegistrationInput,
  assertNoPrivilegeEscalation,
  type ValidationErrors,
} from './validation';
import { ProviderSignInButtons } from './ProviderSignInButtons';
import type { OtpChallenge } from './providerSignIn';

export interface RegistrationFormProps {
  onSuccess?: (email: string) => void;
  onNavigateToVerification?: (email?: string) => void;
  onRequiresOtp?: (challenge: OtpChallenge) => void;
}

export function RegistrationForm({
  onSuccess,
  onNavigateToVerification,
  onRequiresOtp,
}: RegistrationFormProps): React.JSX.Element {
  const [fullName, setFullName] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [fieldErrors, setFieldErrors] = useState<ValidationErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [isSuccess, setIsSuccess] = useState<boolean>(false);
  const [registeredEmail, setRegisteredEmail] = useState<string>('');
  const [diversionNotice, setDiversionNotice] = useState<string | null>(null);
  const [oauthLoading, setOauthLoading] = useState<boolean>(false);

  const handleUnverifiedEmail = (providerEmail: string | null) => {
    if (providerEmail) {
      setEmail(providerEmail);
    }
    setFieldErrors({});
    setFormError(null);
    setDiversionNotice(
      'Your provider account email is unverified. Please create a password below to register and verify your email.'
    );
    setTimeout(() => {
      const passwordInput = document.getElementById('password');
      if (passwordInput) passwordInput.focus();
    }, 0);
  };

  const handleEmptyEmail = () => {
    setFieldErrors({});
    setFormError(null);
    setDiversionNotice(
      'Your provider account did not share an email address. Please enter your email below to register.'
    );
    setTimeout(() => {
      const emailInput = document.getElementById('email');
      if (emailInput) emailInput.focus();
    }, 0);
  };

  const handleRequiresOtp = (challenge: OtpChallenge) => {
    if (onRequiresOtp) {
      onRequiresOtp(challenge);
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormError(null);

    // 1. Client-side input validation
    const errors = validateRegistrationInput(fullName, email, password);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      // Valid input values (fullName, email, password) are preserved in state
      return;
    }

    setFieldErrors({});
    setLoading(true);

    const normalizedEmail = email.trim().toLowerCase();
    const trimmedFullName = fullName.trim();

    try {
      const payload: Record<string, unknown> = {
        fullName: trimmedFullName,
        email: normalizedEmail,
        password,
      };

      if (!assertNoPrivilegeEscalation(payload)) {
        setFormError('Public registration cannot grant administrative privileges.');
        setLoading(false);
        return;
      }

      // 2. Call backend registration endpoint (POST /api/auth/register)
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => null);

      if (response.ok) {
        setRegisteredEmail(normalizedEmail);
        setIsSuccess(true);
        try {
          sessionStorage.setItem('hackmatch_last_registered_email', normalizedEmail);
        } catch {
          // Ignore storage restrictions
        }
        if (onSuccess) {
          onSuccess(normalizedEmail);
        }
      } else if (response.status === 409 || data?.code === 'EMAIL_ALREADY_IN_USE') {
        setFieldErrors((prev) => ({
          ...prev,
          email: data?.error || 'An account with this email already exists.',
        }));
      } else if (response.status === 400 && data?.errors) {
        setFieldErrors(data.errors);
      } else if (
        response.status === 400 &&
        (data?.code === 'INVALID_EMAIL' || data?.code === 'WEAK_PASSWORD')
      ) {
        if (data.code === 'INVALID_EMAIL') {
          setFieldErrors((prev) => ({
            ...prev,
            email: data.error || 'Please provide a valid email address.',
          }));
        } else {
          setFieldErrors((prev) => ({
            ...prev,
            password: data.error || 'Password does not meet security requirements.',
          }));
        }
      } else if (response.status === 403) {
        setFormError(
          data?.error || 'Public registration cannot grant administrative privileges.'
        );
      } else {
        setFormError(
          data?.error || 'Registration failed. Please try again later.'
        );
      }
    } catch {
      setFormError('Network error. Please check your internet connection.');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setFullName('');
    setEmail('');
    setPassword('');
    setFieldErrors({});
    setFormError(null);
    setIsSuccess(false);
    setRegisteredEmail('');
    setDiversionNotice(null);
  };

  if (isSuccess) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="max-w-md w-full mx-auto p-6 bg-white rounded-lg border border-gray-200 shadow-sm"
      >
        <div className="w-12 h-12 mx-auto mb-4 bg-green-100 rounded-full flex items-center justify-center text-green-600 text-2xl font-bold">
          ✓
        </div>
        <h3 className="text-xl font-bold text-center text-gray-900 mb-2">
          Verify Your Email
        </h3>
        <p className="text-sm text-gray-600 text-center mb-4">
          A verification link has been sent to{' '}
          <span className="font-semibold text-gray-900">{registeredEmail}</span>.
        </p>
        <div className="p-3 bg-blue-50 border border-blue-200 text-blue-800 text-xs rounded-md mb-6">
          <p className="font-medium mb-1">Important Security Note:</p>
          <p>
            You must verify your email before accessing team formation features.
            Logging in also requires one-time passcode (OTP) verification sent to this address.
          </p>
        </div>
        {onNavigateToVerification && (
          <button
            type="button"
            onClick={() => onNavigateToVerification(registeredEmail)}
            className="w-full mb-3 py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Didn't receive the email? Request a replacement link
          </button>
        )}
        <button
          type="button"
          onClick={handleReset}
          className="w-full py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        >
          Register Another Account
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-md w-full mx-auto p-6 bg-white rounded-lg border border-gray-200 shadow-sm">
      <h2 className="text-xl font-bold text-gray-900 mb-1">Create an Account</h2>
      <p className="text-sm text-gray-600 mb-6">
        Sign up as a participant to discover hackathons and join teams.
      </p>

      {formError && (
        <div
          role="alert"
          className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-md"
        >
          {formError}
        </div>
      )}

      {diversionNotice && (
        <div
          role="status"
          aria-live="polite"
          className="mb-4 p-3 bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-md"
        >
          {diversionNotice}
        </div>
      )}

      <ProviderSignInButtons
        variant="embedded"
        onRequiresOtp={handleRequiresOtp}
        onUnverifiedEmail={handleUnverifiedEmail}
        onEmptyEmail={handleEmptyEmail}
        onLoadingChange={setOauthLoading}
      />

      <div className="relative my-6">
        <div className="absolute inset-0 flex items-center" aria-hidden="true">
          <div className="w-full border-t border-gray-200" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-white px-2 text-gray-500 font-medium">Or register with email</span>
        </div>
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div>
          <label htmlFor="fullName" className="block text-sm font-medium text-gray-700 mb-1">
            Full Name
          </label>
          <input
            id="fullName"
            name="fullName"
            type="text"
            autoComplete="name"
            value={fullName}
            onChange={(e) => {
              setFullName(e.target.value);
              if (fieldErrors.fullName) {
                setFieldErrors((prev) => ({ ...prev, fullName: undefined }));
              }
            }}
            disabled={loading || oauthLoading}
            aria-invalid={Boolean(fieldErrors.fullName)}
            aria-describedby={fieldErrors.fullName ? 'fullName-error' : undefined}
            className={`w-full px-3 py-2 border rounded-md shadow-sm text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500 ${
              fieldErrors.fullName ? 'border-red-300 text-red-900' : 'border-gray-300'
            }`}
            placeholder="Jane Doe"
          />
          {fieldErrors.fullName && (
            <p id="fullName-error" role="alert" className="mt-1 text-xs text-red-600">
              {fieldErrors.fullName}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
            Email Address
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (fieldErrors.email) {
                setFieldErrors((prev) => ({ ...prev, email: undefined }));
              }
            }}
            disabled={loading || oauthLoading}
            aria-invalid={Boolean(fieldErrors.email)}
            aria-describedby={fieldErrors.email ? 'email-error' : undefined}
            className={`w-full px-3 py-2 border rounded-md shadow-sm text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500 ${
              fieldErrors.email ? 'border-red-300 text-red-900' : 'border-gray-300'
            }`}
            placeholder="jane@example.com"
          />
          {fieldErrors.email && (
            <p id="email-error" role="alert" className="mt-1 text-xs text-red-600">
              {fieldErrors.email}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (fieldErrors.password) {
                setFieldErrors((prev) => ({ ...prev, password: undefined }));
              }
            }}
            disabled={loading || oauthLoading}
            aria-invalid={Boolean(fieldErrors.password)}
            aria-describedby={
              fieldErrors.password ? 'password-error password-hint' : 'password-hint'
            }
            className={`w-full px-3 py-2 border rounded-md shadow-sm text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500 ${
              fieldErrors.password ? 'border-red-300 text-red-900' : 'border-gray-300'
            }`}
            placeholder="••••••••"
          />
          <p id="password-hint" className="mt-1 text-xs text-gray-500">
            Must be at least 8 characters with uppercase, lowercase, a number, and a special character.
          </p>
          {fieldErrors.password && (
            <p id="password-error" role="alert" className="mt-1 text-xs text-red-600">
              {fieldErrors.password}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={loading || oauthLoading}
          aria-busy={loading}
          className="w-full mt-2 py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
        >
          {loading ? 'Creating Account...' : 'Create Account'}
        </button>
      </form>
    </div>
  );
}

export default RegistrationForm;
