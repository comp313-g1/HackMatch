import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Firebase Admin Auth (Offline & Configuration)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.FIREBASE_CLIENT_EMAIL;
    delete process.env.FIREBASE_PRIVATE_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('safely imports and instantiates the auth client proxy without credentials', async () => {
    const { getFirebaseAdminAuth, firebaseAuth, auth } = await import('./firebase.js');

    expect(() => getFirebaseAdminAuth()).not.toThrow();
    expect(firebaseAuth).toBeDefined();
    expect(auth).toBeDefined();
  }, 15000);

  it('fails fast with a descriptive error when active property or operation is accessed without credentials', async () => {
    const { getFirebaseAdminAuth, firebaseAuth, auth } = await import('./firebase.js');

    const client = getFirebaseAdminAuth();
    expect(() => (client as unknown as { listUsers: () => unknown }).listUsers()).toThrowError(
      /Missing FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, or FIREBASE_PRIVATE_KEY environment variables/
    );

    expect(() => (firebaseAuth as unknown as { listUsers: () => unknown }).listUsers()).toThrowError(
      /Missing FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, or FIREBASE_PRIVATE_KEY environment variables/
    );

    expect(() => (auth as unknown as { verifyIdToken: (t: string) => unknown }).verifyIdToken('token')).toThrowError(
      /Missing FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, or FIREBASE_PRIVATE_KEY environment variables/
    );
  });

  it('resets cached instances via _resetFirebaseInstances', async () => {
    const { _resetFirebaseInstances } = await import('./firebase.js');
    expect(() => _resetFirebaseInstances()).not.toThrow();
  });
});
