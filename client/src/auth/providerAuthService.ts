import {
  getProviderIdToken,
  providerConfigurationError,
} from './firebaseProvider.js';

export type Provider = 'google' | 'github';

export interface PendingOtp {
  status: 'OTP_REQUIRED';
  maskedEmail: string;
}

export interface SignInOptions {
  importProfile: boolean;
}

export class AuthFlowError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'AuthFlowError';
  }
}

export function signInError(
  error: unknown,
): { message: string; needsEmail: boolean } {
  const code =
    typeof error === 'object' &&
    error !== null &&
    'code' in error
      ? String(error.code)
      : '';

  const messages: Record<string, string> = {
    'auth/popup-closed-by-user':
      'Sign-in was cancelled. Choose a provider to try again.',

    'auth/cancelled-popup-request':
      'Sign-in was interrupted. Please try again.',

    'auth/popup-blocked':
      'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.',

    'auth/network-request-failed':
      'Could not reach the sign-in provider. Check your connection and try again.',

    'auth/account-exists-with-different-credential':
      'Sign in with your existing method first. Linking a provider requires reauthentication and email verification.',

    'auth/operation-not-allowed':
      'This provider is not enabled yet. Please try another sign-in method.',

    'auth/unauthorized-domain':
      'Sign-in is not configured for this website. Please contact the HackMatch team.',

    'auth/too-many-requests':
      'Too many attempts. Please wait before trying again.',

    CONFIGURATION:
      'Provider sign-in is not configured yet. Please contact the HackMatch team.',

    EMAIL_VERIFICATION_REQUIRED:
      'This provider did not supply a verified email. Continue with email registration or verification.',

    REAUTHENTICATION_REQUIRED:
      'Sign in with your existing method first. Linking a provider requires reauthentication and email verification.',

    ACCOUNT_NOT_ELIGIBLE:
      'This account cannot use participant provider sign-in. Please use your existing sign-in method.',

    INVALID_PROVIDER_RESPONSE:
      'We could not verify the provider response. Please start sign-in again.',

    RATE_LIMITED:
      'Too many attempts. Please wait before trying again.',

    SERVICE_UNAVAILABLE:
      'Sign-in could not be completed. Please try again shortly.',

    NETWORK:
      'Could not reach HackMatch. Check your connection and try again.',

    TIMEOUT:
      'HackMatch took too long to respond. Please try again.',
  };

  return {
    message:
      messages[code] ??
      'Sign-in could not be completed. Please try again.',
    needsEmail: code === 'EMAIL_VERIFICATION_REQUIRED',
  };
}

// Proposed endpoint: agree on this contract with the backend team.
// The server decides whether identity/email/role validation succeeds.
export async function exchangeProviderToken(
  provider: Provider,
  idToken: string,
  options: SignInOptions,
): Promise<PendingOtp> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch('/api/auth/provider', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        provider,
        importProfile: options.importProfile,
      }),
      signal: controller.signal,
    });

    if (response.status === 429) {
      throw new AuthFlowError('RATE_LIMITED');
    }

    if (response.status >= 500 || response.status === 404) {
      throw new AuthFlowError('SERVICE_UNAVAILABLE');
    }

    const data: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const code =
        typeof data === 'object' &&
        data !== null &&
        'code' in data &&
        typeof data.code === 'string'
          ? data.code
          : 'INVALID_PROVIDER_RESPONSE';

      throw new AuthFlowError(code);
    }

    // Fail safely if the response is empty, malformed or skips OTP.
    if (
      typeof data !== 'object' ||
      data === null ||
      !('status' in data) ||
      data.status !== 'OTP_REQUIRED' ||
      !('maskedEmail' in data) ||
      typeof data.maskedEmail !== 'string' ||
      !data.maskedEmail.trim() ||
      data.maskedEmail.length > 254
    ) {
      throw new AuthFlowError('INVALID_PROVIDER_RESPONSE');
    }

    return {
      status: 'OTP_REQUIRED',
      maskedEmail: data.maskedEmail,
    };
  } catch (error) {
    if (error instanceof AuthFlowError) {
      throw error;
    }

    throw new AuthFlowError(
      controller.signal.aborted ? 'TIMEOUT' : 'NETWORK',
    );
  } finally {
    clearTimeout(timeout);
  }
}

export { providerConfigurationError };

export async function startProviderSignIn(
  provider: Provider,
  options: SignInOptions,
): Promise<PendingOtp> {
  const token = await getProviderIdToken(provider);

  return exchangeProviderToken(provider, token, options);
}