import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Supabase Client (Offline & Configuration)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('safely imports and instantiates the client proxy without credentials', async () => {
    const { getSupabaseClient, supabaseClient } = await import('./client.js');

    expect(() => getSupabaseClient()).not.toThrow();
    expect(supabaseClient).toBeDefined();
  });

  it('fails fast with a descriptive error when active operation is attempted without credentials', async () => {
    const { getSupabaseClient, supabaseClient } = await import('./client.js');

    const client = getSupabaseClient();
    expect(() => (client as unknown as { from: (t: string) => unknown }).from('participants')).toThrowError(
      /Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables/
    );

    expect(() => (supabaseClient as unknown as { from: (t: string) => unknown }).from('participants')).toThrowError(
      /Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables/
    );
  });

  it('returns a functioning Supabase client when credentials are provided', async () => {
    process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-role-key-xyz';

    const { getSupabaseClient } = await import('./client.js');

    const client = getSupabaseClient();
    expect(client).toBeDefined();
    // Accessing .from should not throw configuration error
    expect(() => client.from('participants')).not.toThrow();
  });
});
