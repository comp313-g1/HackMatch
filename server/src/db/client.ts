import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config/index.js';

let clientInstance: SupabaseClient | null = null;

/**
 * Returns the Supabase client instance.
 * If credentials are missing, returns an offline-safe proxy that raises a descriptive
 * error ONLY when an active database operation or property is accessed.
 */
export function getSupabaseClient(): SupabaseClient {
  const url = config.supabase.url || process.env.SUPABASE_URL;
  const key = config.supabase.serviceRoleKey || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    return new Proxy({} as SupabaseClient, {
      get(_target, prop) {
        throw new Error(
          `[Supabase Client Error] Cannot access property '${String(prop)}': Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.`
        );
      },
    });
  }

  if (!clientInstance) {
    clientInstance = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  return clientInstance;
}

/**
 * Singleton proxy to allow direct consumption without throwing on module import.
 */
export const supabaseClient: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getSupabaseClient();
    const value = (client as unknown as Record<string | symbol, unknown>)[prop];
    if (typeof value === 'function') {
      return value.bind(client);
    }
    return value;
  },
});
