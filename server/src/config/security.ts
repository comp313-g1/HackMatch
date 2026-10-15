/** Firebase Admin only accepts session cookie lifetimes between 5 minutes and 2 weeks. */
export const MIN_SESSION_MAX_AGE_SECONDS = 5 * 60;
export const MAX_SESSION_MAX_AGE_SECONDS = 14 * 24 * 60 * 60;
/** US-003 AC 4: fixed 7-day renewal limit. */
export const DEFAULT_SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
/** Matches the 10-minute US-004 OTP lifetime so users can finish MFA before exchanging the token. */
export const RECENT_SIGN_IN_SECONDS = 10 * 60;

export interface SecurityConfig {
  enforceHttps: boolean;
  trustProxy: number | false;
  sessionCookie: {
    name: string;
    csrfName: string;
    maxAgeSeconds: number;
    secure: boolean;
  };
  recentSignInSeconds: number;
}

type Env = Record<string, string | undefined>;

function parseBoolean(name: string, raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = raw.trim().toLowerCase();
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  throw new Error(`[CONFIG] ${name} must be "true" or "false", got "${raw}".`);
}

export function parseSessionMaxAge(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_SESSION_MAX_AGE_SECONDS;
  if (!/^\d+$/.test(raw.trim())) {
    throw new Error(`[CONFIG] SESSION_COOKIE_MAX_AGE_SECONDS must be a whole number of seconds, got "${raw}".`);
  }
  const seconds = Number(raw.trim());
  if (seconds < MIN_SESSION_MAX_AGE_SECONDS || seconds > MAX_SESSION_MAX_AGE_SECONDS) {
    throw new Error(
      `[CONFIG] SESSION_COOKIE_MAX_AGE_SECONDS must be between ${MIN_SESSION_MAX_AGE_SECONDS} and ${MAX_SESSION_MAX_AGE_SECONDS}, got ${seconds}.`
    );
  }
  return seconds;
}

function parseTrustProxy(raw: string | undefined): number | false {
  if (raw === undefined || raw.trim() === '' || raw.trim() === '0' || raw.trim().toLowerCase() === 'false') {
    return false;
  }
  if (!/^\d+$/.test(raw.trim())) {
    throw new Error(`[CONFIG] TRUST_PROXY must be the number of proxy hops (e.g. 1), got "${raw}".`);
  }
  return Number(raw.trim());
}

/**
 * Builds HTTPS and cookie settings (US-003 AC 4). Production always uses HTTPS and
 * Secure cookies; turning either off in production is a startup error.
 */
export function loadSecurityConfig(env: Env = process.env): SecurityConfig {
  const isProduction = (env.NODE_ENV || 'development') === 'production';
  const isDevelopment = (env.NODE_ENV || 'development') === 'development';

  const enforceHttps = parseBoolean('ENFORCE_HTTPS', env.ENFORCE_HTTPS, isProduction);
  const secure = parseBoolean('COOKIE_SECURE', env.COOKIE_SECURE, !isDevelopment);

  if (isProduction && !enforceHttps) {
    throw new Error('[CONFIG] ENFORCE_HTTPS cannot be false in production.');
  }
  if (isProduction && !secure) {
    throw new Error('[CONFIG] COOKIE_SECURE cannot be false in production.');
  }

  return {
    enforceHttps,
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    sessionCookie: {
      name: 'hm_session',
      csrfName: 'hm_csrf',
      maxAgeSeconds: parseSessionMaxAge(env.SESSION_COOKIE_MAX_AGE_SECONDS),
      secure,
    },
    recentSignInSeconds: RECENT_SIGN_IN_SECONDS,
  };
}

export const securityConfig: SecurityConfig = loadSecurityConfig();
