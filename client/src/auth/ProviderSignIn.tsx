import React, { useRef, useState } from 'react';

import {
  providerConfigurationError,
  signInError,
  startProviderSignIn,
  type PendingOtp,
  type Provider,
  type SignInOptions,
} from './providerAuthService';

interface Props {
  onOtpRequired: (pending: PendingOtp) => void;
  onEmailRegistration?: () => void;

  // Allow offline tests to supply a mock sign-in function.
  signIn?: (
    provider: Provider,
    options: SignInOptions,
  ) => Promise<PendingOtp>;

  configurationError?: string | null;
}

export function ProviderSignIn({
  onOtpRequired,
  onEmailRegistration,
  signIn = startProviderSignIn,
  configurationError = providerConfigurationError(),
}: Props): React.JSX.Element {
  const [importProfile, setImportProfile] = useState(false);
  const [busy, setBusy] = useState<Provider | null>(null);
  const [error, setError] =
    useState<ReturnType<typeof signInError> | null>(null);
  const [complete, setComplete] = useState(false);

  const inFlight = useRef(false);

  const begin = async (provider: Provider) => {
    if (inFlight.current || complete || configurationError) {
      return;
    }

    inFlight.current = true;
    setBusy(provider);
    setError(null);

    try {
      const pending = await signIn(provider, { importProfile });

      // Hand off to email OTP; do not unlock the application here.
      onOtpRequired(pending);
      setComplete(true);
    } catch (failure) {
      setError(signInError(failure));
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };

  return (
    <section
      aria-labelledby="provider-heading"
      aria-busy={busy !== null}
      className="my-6 rounded-lg border border-gray-200 bg-white p-6"
    >
      <h2
        id="provider-heading"
        className="text-xl font-semibold"
      >
        Sign in to HackMatch
      </h2>

      <p className="mt-2 text-gray-600">
        Choose Google or GitHub, then verify your email with a
        one-time code.
      </p>

      <label className="my-4 flex items-start gap-2">
        <input
          type="checkbox"
          checked={importProfile}
          disabled={busy !== null || complete}
          onChange={event =>
            setImportProfile(event.target.checked)
          }
          className="mt-1"
        />

        <span>
          Use my provider handle and avatar for my profile
          (optional).
        </span>
      </label>

      <p className="mb-4 text-sm text-gray-600">
        Provider sign-in does not verify skills or portfolio claims.
      </p>

      {configurationError && (
        <p role="status" className="mb-4 text-gray-700">
          {configurationError}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        {(['google', 'github'] as const).map(provider => (
          <button
            key={provider}
            type="button"
            onClick={() => void begin(provider)}
            disabled={
              busy !== null ||
              complete ||
              Boolean(configurationError)
            }
            className="rounded-md bg-blue-700 px-4 py-2 text-white hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
          >
            {busy === provider
              ? 'Signing in…'
              : `Continue with ${
                  provider === 'google' ? 'Google' : 'GitHub'
                }`}
          </button>
        ))}
      </div>

      <div
        role="status"
        aria-live="polite"
        className="mt-4"
      >
        {busy &&
          'Complete sign-in in the provider window. Waiting for verification…'}

        {complete &&
          'Provider verified. Email verification is still required before you can access HackMatch.'}
      </div>

      {error && (
        <div role="alert" className="mt-4 text-red-700">
          <p>{error.message}</p>

          {error.needsEmail &&
            (onEmailRegistration ? (
              <button
                type="button"
                onClick={onEmailRegistration}
                className="mt-2 underline"
              >
                Continue with email
              </button>
            ) : (
              <p>
                Email registration is not connected on this page
                yet. Try a provider account with a verified email.
              </p>
            ))}
        </div>
      )}
    </section>
  );
}