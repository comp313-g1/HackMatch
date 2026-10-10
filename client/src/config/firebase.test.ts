import { describe, it, expect } from 'vitest';
import {
  app,
  auth,
  googleProvider,
  githubProvider,
  translateAuthError,
  firebaseConfig,
} from './firebase';

describe('Firebase Client Configuration', () => {
  it('initializes the Firebase application with configuration', () => {
    expect(app).toBeDefined();
    expect(app.name).toBe('[DEFAULT]');
    expect(firebaseConfig).toHaveProperty('apiKey');
    expect(firebaseConfig).toHaveProperty('authDomain');
    expect(firebaseConfig).toHaveProperty('projectId');
  });

  it('exports an active auth instance', () => {
    expect(auth).toBeDefined();
    expect(auth.app).toBe(app);
  });

  it('configures GoogleAuthProvider with email scope and account prompt', () => {
    expect(googleProvider).toBeDefined();
    expect(googleProvider.providerId).toBe('google.com');
    const scopes = googleProvider.getScopes();
    expect(scopes).toContain('email');
    const customParams = googleProvider.getCustomParameters();
    expect(customParams).toEqual({ prompt: 'select_account' });
  });

  it('configures GithubAuthProvider with user:email scope to satisfy US-002 AC 2', () => {
    expect(githubProvider).toBeDefined();
    expect(githubProvider.providerId).toBe('github.com');
    const scopes = githubProvider.getScopes();
    expect(scopes).toContain('user:email');
  });

  describe('translateAuthError', () => {
    it('translates known Firebase OAuth error codes into user-actionable messages', () => {
      expect(translateAuthError({ code: 'auth/popup-closed-by-user' })).toBe(
        'Sign-in was cancelled before completion.'
      );
      expect(translateAuthError({ code: 'auth/cancelled-popup-request' })).toBe(
        'Sign-in request was cancelled due to another concurrent attempt.'
      );
      expect(translateAuthError({ code: 'auth/account-exists-with-different-credential' })).toBe(
        'An account already exists with the same email using a different sign-in method.'
      );
      expect(translateAuthError({ code: 'auth/popup-blocked' })).toBe(
        'The sign-in popup was blocked by your browser.'
      );
      expect(translateAuthError({ code: 'auth/network-request-failed' })).toBe(
        'Network error. Please check your internet connection.'
      );
      expect(translateAuthError({ code: 'auth/invalid-credential' })).toBe(
        'Invalid credentials provided.'
      );
      expect(translateAuthError({ code: 'auth/email-already-in-use' })).toBe(
        'An account with this email already exists.'
      );
      expect(translateAuthError({ code: 'auth/invalid-email' })).toBe(
        'Please provide a valid email address.'
      );
      expect(translateAuthError({ code: 'auth/weak-password' })).toBe(
        'Password does not meet security requirements.'
      );
      expect(translateAuthError({ code: 'auth/too-many-requests' })).toBe(
        'Too many attempts. Please try again later.'
      );
    });

    it('falls back to generic error message for unknown or malformed error objects', () => {
      expect(translateAuthError({ code: 'auth/unknown-error' })).toBe(
        'Authentication failed. Please try again.'
      );
      expect(translateAuthError(null)).toBe('Authentication failed. Please try again.');
      expect(translateAuthError(undefined)).toBe('Authentication failed. Please try again.');
      expect(translateAuthError('string error')).toBe('Authentication failed. Please try again.');
    });
  });
});
