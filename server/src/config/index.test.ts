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
    delete process.env.TOTP_ENCRYPTION_KEY_BASE64;

    const { validateEnv } = await import('./index.js');
    expect(() => validateEnv()).toThrowError(/\[CRITICAL\] Missing required production environment variables/);
  });

  it('includes the protected TOTP key in the production requirements', async () => {
    process.env.NODE_ENV = 'production';
    process.env.SESSION_SECRET = 'test-session-secret';
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    process.env.FIREBASE_PROJECT_ID = 'firebase-project';
    process.env.FIREBASE_CLIENT_EMAIL = 'firebase@example.test';
    process.env.FIREBASE_PRIVATE_KEY = 'private-key';
    delete process.env.TOTP_ENCRYPTION_KEY_BASE64;

    const { validateEnv } = await import('./index.js');
    expect(() => validateEnv()).toThrow(/TOTP_ENCRYPTION_KEY_BASE64/);
  });

  it('keeps rich-chat attachments off unless the server flag is exactly true', async () => {
    for (const value of [undefined, '', 'false', 'TRUE', '1']) {
      vi.resetModules();
      if (value === undefined) delete process.env.RICH_CHAT_ATTACHMENTS_ENABLED;
      else process.env.RICH_CHAT_ATTACHMENTS_ENABLED = value;
      expect((await import('./index.js')).config.richChat.attachmentsEnabled, String(value)).toBe(false);
    }
    vi.resetModules();
    process.env.RICH_CHAT_ATTACHMENTS_ENABLED = 'true';
    expect((await import('./index.js')).config.richChat.attachmentsEnabled).toBe(true);
  });
});
