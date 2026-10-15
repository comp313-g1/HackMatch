/**
 * Provider sign-in entry point (issue #30 / US-002 AC1, AC2, AC5).
 *
 * Renders the Google/GitHub buttons, the avatar-consent checkbox, and the five
 * UI states (loading / success / validation / empty / error) with WCAG-aligned
 * roles — mirroring the conventions in `RegistrationForm.tsx`.
 *
 * Scope boundaries (deliberate):
 *  - Success stops at the OTP hand-off via `onRequiresOtp`; this component never
 *    creates a session, renders a post-login view, or navigates.
 *  - Account linking (AC4) is out of scope; a 409 surfaces an actionable message.
 *  - Already-filled data (e.g. `consentHandleAvatar`) is preserved across errors.
 */

import React, { useState } from 'react';
import {
  signInWithProvider,
  type OtpChallenge,
  type ProviderKind,
} from './providerSignIn';

export interface ProviderSignInButtonsProps {
  /** Success hand-off. Receives the OTP challenge for US-004 to consume. */
  onRequiresOtp: (challenge: OtpChallenge) => void;
  /** Diversion: provider returned no verified email → route to email registration. */
  onUnverifiedEmail: (email: string | null) => void;
  /** Optional: provider returned no email at all. */
  onEmptyEmail?: () => void;
  /** Optional: any error outcome, with a retryability hint. */
  onError?: (message: string, retryable: boolean) => void;
  /** Optional variant: 'card' (standalone with border/shadow) or 'embedded' (flat inside a form). Defaults to 'card'. */
  variant?: 'card' | 'embedded';
  /** Optional callback fired when the loading state changes. */
  onLoadingChange?: (loading: boolean) => void;
}

type Status = 'idle' | 'loading' | 'success' | 'validation' | 'empty' | 'error';

const PROVIDER_LABEL: Record<ProviderKind, string> = {
  google: 'Google',
  github: 'GitHub',
};

const MESSAGE_ID = 'provider-signin-message';
const GROUP_ID = 'provider-signin-group';

export function ProviderSignInButtons({
  onRequiresOtp,
  onUnverifiedEmail,
  onEmptyEmail,
  onError,
  variant = 'card',
  onLoadingChange,
}: ProviderSignInButtonsProps): React.JSX.Element {
  // Preserved across every non-fatal outcome (validation/error) — never reset here.
  const [consentHandleAvatar, setConsentHandleAvatar] = useState<boolean>(false);
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [activeProvider, setActiveProvider] = useState<ProviderKind | null>(null);
  const [retryable, setRetryable] = useState<boolean>(true);

  const loading = status === 'loading';
  const isAlert = status === 'error' || status === 'validation';

  const handleSignIn = async (provider: ProviderKind) => {
    // Guard against re-entry while a flow is already in flight.
    if (loading) return;

    setActiveProvider(provider);
    setStatus('loading');
    setMessage(null);
    setRetryable(true);
    if (onLoadingChange) onLoadingChange(true);

    const outcome = await signInWithProvider(provider, { consentHandleAvatar });
    if (onLoadingChange) onLoadingChange(false);

    switch (outcome.status) {
      case 'requires_otp':
        // Success stops here: notify the caller, create no session.
        setStatus('success');
        setMessage(`A 6-digit verification code has been sent to ${outcome.challenge.email}.`);
        onRequiresOtp(outcome.challenge);
        break;

      case 'unverified_email':
        // AC2: divert to email registration, keeping the already-filled consent.
        setStatus('validation');
        setMessage(
          'This provider did not return a verified email. Please register with your email instead.'
        );
        onUnverifiedEmail(outcome.email);
        break;

      case 'empty_email':
        setStatus('empty');
        setMessage(
          'This provider did not return an email address. Please register with your email instead.'
        );
        if (onEmptyEmail) onEmptyEmail();
        break;

      case 'validation':
        setStatus('validation');
        setMessage(outcome.message);
        setRetryable(outcome.retryable);
        break;

      case 'error':
        setStatus('error');
        setMessage(outcome.message);
        setRetryable(outcome.retryable);
        if (onError) onError(outcome.message, outcome.retryable);
        break;
    }
  };

  const isEmbedded = variant === 'embedded';

  return (
    <div
      className={
        isEmbedded
          ? 'w-full'
          : 'max-w-md w-full mx-auto p-6 bg-white rounded-lg border border-gray-200 shadow-sm'
      }
    >
      {!isEmbedded && (
        <>
          <h2 id="provider-signin-heading" className="text-xl font-bold text-gray-900 mb-1">
            Continue with a provider
          </h2>
          <p className="text-sm text-gray-600 mb-6">
            Use your Google or GitHub account. Email verification is still required before you get
            access.
          </p>
        </>
      )}

      <div className="flex items-start mb-4">
        <input
          id="consentHandleAvatar"
          name="consentHandleAvatar"
          type="checkbox"
          checked={consentHandleAvatar}
          onChange={(e) => setConsentHandleAvatar(e.target.checked)}
          disabled={loading}
          className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
        />
        <label htmlFor="consentHandleAvatar" className="ml-2 text-sm text-gray-700">
          Allow HackMatch to use my provider display name and avatar on my profile.
        </label>
      </div>

      <div
        id={GROUP_ID}
        role="group"
        aria-labelledby={isEmbedded ? undefined : 'provider-signin-heading'}
        aria-label={isEmbedded ? 'Continue with a provider' : undefined}
        aria-busy={loading}
        aria-invalid={status === 'validation' ? true : undefined}
        aria-describedby={message ? MESSAGE_ID : undefined}
        className="space-y-3"
      >
        <button
          type="button"
          onClick={() => handleSignIn('google')}
          disabled={loading}
          aria-busy={loading && activeProvider === 'google'}
          className="w-full inline-flex items-center justify-center py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading && activeProvider === 'google'
            ? 'Signing in with Google…'
            : 'Continue with Google'}
        </button>

        <button
          type="button"
          onClick={() => handleSignIn('github')}
          disabled={loading}
          aria-busy={loading && activeProvider === 'github'}
          className="w-full inline-flex items-center justify-center py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading && activeProvider === 'github'
            ? 'Signing in with GitHub…'
            : 'Continue with GitHub'}
        </button>
      </div>

      {message && (
        <div
          id={MESSAGE_ID}
          role={isAlert ? 'alert' : 'status'}
          aria-live={isAlert ? 'assertive' : 'polite'}
          className={`mt-4 p-3 text-sm rounded-md border ${
            isAlert
              ? 'bg-red-50 border-red-200 text-red-700'
              : 'bg-blue-50 border-blue-200 text-blue-800'
          }`}
        >
          {message}
        </div>
      )}

      {(status === 'error' || status === 'validation') && retryable && activeProvider && (
        <button
          type="button"
          onClick={() => handleSignIn(activeProvider)}
          disabled={loading}
          className="w-full mt-3 py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
        >
          Try again with {PROVIDER_LABEL[activeProvider]}
        </button>
      )}
    </div>
  );
}

export default ProviderSignInButtons;
