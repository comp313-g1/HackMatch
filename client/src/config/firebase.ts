import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, GithubAuthProvider, Auth } from 'firebase/auth';

/**
 * Public Firebase client configuration.
 * Uses fallback placeholders in test or unconfigured offline environments
 * to prevent instant initialization crashes.
 */
export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'offline-dummy-api-key',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'offline-dummy-project.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'offline-dummy-project',
};

// Singleton App Initialization
export const app: FirebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

// Authentication Instance
export const auth: Auth = getAuth(app);

// Pre-configured Google OAuth Provider
export const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('email');
googleProvider.setCustomParameters({ prompt: 'select_account' });

// Pre-configured GitHub OAuth Provider
export const githubProvider = new GithubAuthProvider();
// US-002 AC #2 requires verified email; GitHub requires 'user:email' to fetch private verified addresses
githubProvider.addScope('user:email');

/**
 * Standardized mapping of Firebase Auth errors to user-actionable error messages.
 */
export function translateAuthError(error: unknown): string {
  const code = (error && typeof error === 'object' && 'code' in error) 
    ? String((error as { code: unknown }).code) 
    : '';

  switch (code) {
    case 'auth/popup-closed-by-user':
      return 'Sign-in was cancelled before completion.';
    case 'auth/cancelled-popup-request':
      return 'Sign-in request was cancelled due to another concurrent attempt.';
    case 'auth/account-exists-with-different-credential':
      return 'An account already exists with the same email using a different sign-in method.';
    case 'auth/popup-blocked':
      return 'The sign-in popup was blocked by your browser.';
    case 'auth/network-request-failed':
      return 'Network error. Please check your internet connection.';
    case 'auth/invalid-credential':
      return 'Invalid credentials provided.';
    default:
      return 'Authentication failed. Please try again.';
  }
}
