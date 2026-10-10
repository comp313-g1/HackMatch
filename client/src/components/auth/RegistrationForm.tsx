import React, { useState } from 'react';
import {
  createUserWithEmailAndPassword,
  updateProfile,
  sendEmailVerification,
  signOut,
} from 'firebase/auth';
import { auth, translateAuthError } from '../../config/firebase';
import { validateRegistrationInput, type ValidationErrors } from './validation';

export interface RegistrationFormProps {
  onSuccess?: (email: string) => void;
}

export function RegistrationForm({ onSuccess }: RegistrationFormProps): React.JSX.Element {
  const [fullName, setFullName] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [fieldErrors, setFieldErrors] = useState<ValidationErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [isSuccess, setIsSuccess] = useState<boolean>(false);
  const [registeredEmail, setRegisteredEmail] = useState<string>('');

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

    let userCreated = false;
    try {
      // 2. Create user with Firebase Auth Client SDK
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        email.trim().toLowerCase(),
        password
      );
      userCreated = true;

      try {
        // 3. Update profile with full name as display name
        await updateProfile(userCredential.user, {
          displayName: fullName.trim(),
        });

        // 4. Send email verification link
        await sendEmailVerification(userCredential.user);

        setRegisteredEmail(email.trim().toLowerCase());
        setIsSuccess(true);
        if (onSuccess) {
          onSuccess(email.trim().toLowerCase());
        }
      } finally {
        // 5. Enforce security invariant: Guaranteed immediate signout
        // so no unverified, non-OTP session lingers in browser storage (FR-007, US-001 AC 5)
        await signOut(auth);
      }
    } catch (err: unknown) {
      if (userCreated) {
        setFormError(
          'Account created, but failed to send verification email. Please try signing in or requesting a replacement verification link.'
        );
      } else {
        const errorCode = (err && typeof err === 'object' && 'code' in err)
          ? String((err as { code: unknown }).code)
          : '';

        // Field-specific error mappings
        if (errorCode === 'auth/email-already-in-use') {
          setFieldErrors((prev) => ({
            ...prev,
            email: 'An account with this email already exists.',
          }));
        } else if (errorCode === 'auth/invalid-email') {
          setFieldErrors((prev) => ({
            ...prev,
            email: 'Please provide a valid email address.',
          }));
        } else if (errorCode === 'auth/weak-password') {
          setFieldErrors((prev) => ({
            ...prev,
            password: 'Password does not meet security requirements.',
          }));
        } else {
          setFormError(translateAuthError(err));
        }
      }
      // Note: fullName and email are preserved in state per NR-017
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
            disabled={loading}
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
            disabled={loading}
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
            disabled={loading}
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
          disabled={loading}
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
