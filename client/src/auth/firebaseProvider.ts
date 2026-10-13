import { getApps, initializeApp } from 'firebase/app';
import {
  browserPopupRedirectResolver,
  getAuth,
  GithubAuthProvider,
  GoogleAuthProvider,
  initializeAuth,
  inMemoryPersistence,
  signInWithPopup,
  signOut,
} from 'firebase/auth';

import type { Provider } from './providerAuthService.ts';

const configuration = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
};

export function providerConfigurationError(): string | null {
  const missingConfiguration = Object.values(configuration).some(
    value => !value?.trim() || value.startsWith('your-'),
  );

  return missingConfiguration
    ? 'Provider sign-in is not configured yet. Please contact the HackMatch team.'
    : null;
}

// Keep provider authentication separate from other Firebase features.
// This temporary Firebase identity is NOT a full HackMatch session.
function providerAuth() {
  const name = 'hackmatch-provider-sign-in';
  const existing = getApps().find(app => app.name === name);

  if (existing) {
    return getAuth(existing);
  }

  return initializeAuth(initializeApp(configuration, name), {
    persistence: inMemoryPersistence,
    popupRedirectResolver: browserPopupRedirectResolver,
  });
}

export async function getProviderIdToken(
  provider: Provider,
): Promise<string> {
  if (providerConfigurationError()) {
    throw { code: 'CONFIGURATION' };
  }

  const auth = providerAuth();

  const oauthProvider =
    provider === 'google'
      ? new GoogleAuthProvider()
      : new GithubAuthProvider();

  if (provider === 'github') {
    oauthProvider.addScope('user:email');
  }

  try {
    // Firebase handles the provider popup and OAuth callback.
    const result = await signInWithPopup(auth, oauthProvider);

    // This token proves primary authentication to our backend.
    return await result.user.getIdToken();
  } finally {
    // Clear temporary Firebase authentication on success or failure.
    // The backend must still require email OTP.
    await signOut(auth);
  }
}