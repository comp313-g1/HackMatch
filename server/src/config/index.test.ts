import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Server Configuration & validateEnv', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('does not throw in development or test environment when variables are missing', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.SUPABASE_URL;

    const { validateEnv } = await import('./index.js');
    expect(() => validateEnv()).not.toThrow();
  });

  it('throws descriptive critical error in production when required variables are missing', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.SESSION_SECRET;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.FIREBASE_CLIENT_EMAIL;
    delete process.env.FIREBASE_PRIVATE_KEY;

    const { validateEnv } = await import('./index.js');
    expect(() => validateEnv()).toThrowError(/\[CRITICAL\] Missing required production environment variables/);
  });
});
