import dotenv from 'dotenv';

dotenv.config();

export interface ServerConfig {
  port: number;
  nodeEnv: string;
  clientUrl: string;
  sessionSecret: string;
  supabase: {
    url?: string;
    anonKey?: string;
    serviceRoleKey?: string;
  };
  firebase: {
    projectId?: string;
    clientEmail?: string;
    privateKey?: string;
  };
}

export const config: ServerConfig = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  sessionSecret: process.env.SESSION_SECRET || 'dev_fallback_secret_for_tests_only',
  supabase: {
    url: process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  },
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY,
  },
};

/**
 * Validates critical environment variables.
 * Intentionally executed ONLY in server.ts at runtime, NOT on module import.
 * This ensures tests and CI run cleanly without requiring .env files.
 */
export function validateEnv(): void {
  if (config.nodeEnv === 'production') {
    const requiredInProd = ['SESSION_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
    const missing = requiredInProd.filter((key) => !process.env[key]);
    if (missing.length > 0) {
      throw new Error(`[CRITICAL] Missing required production environment variables: ${missing.join(', ')}`);
    }
  }
}
