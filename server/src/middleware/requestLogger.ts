import { Request, Response, NextFunction } from 'express';

const SENSITIVE_KEYS = new Set([
  'password',
  'token',
  'otp',
  'otpcode',
  'code',
  'refreshtoken',
  'accesstoken',
  'secret',
  'authorization',
  'cookie',
  'set-cookie',
  'oobcode',
  'actioncode',
  'verificationtoken',
  'idtoken',
  // US-029 / #270: AES-GCM storage fields (snake or camel case).
  'iv',
  'secret_iv',
]);

/**
 * US-029 / #270: exact names alone missed variants such as `newPassword`,
 * `confirmPassword`, `recoveryCodes`, `manualEntryKey`, and `secret_ciphertext`.
 * Any key containing one of these fragments is redacted.
 */
const SENSITIVE_KEY_FRAGMENTS = [
  'password',
  'passcode',
  'secret',
  'token',
  'otp',
  'code',
  'cookie',
  'authorization',
  'credential',
  'ciphertext',
  'authtag',
  'auth_tag',
  'verifier',
  'entrykey',
  'privatekey',
  'apikey',
  'key_version',
  'keyversion',
];

const REDACTED = '[REDACTED]';

function isSensitiveKey(key: string): boolean {
  const lowerKey = key.toLowerCase();
  return (
    SENSITIVE_KEYS.has(lowerKey) ||
    SENSITIVE_KEY_FRAGMENTS.some((fragment) => lowerKey.includes(fragment))
  );
}

/** Authenticator setup URIs embed the TOTP secret whatever field carries them. */
function isSensitiveValue(value: unknown): boolean {
  return typeof value === 'string' && /^\s*otpauth:/i.test(value);
}

export function sanitizePayload(data: unknown): unknown {
  if (data === null || data === undefined) return data;
  if (isSensitiveValue(data)) return REDACTED;
  if (typeof data !== 'object') return data;

  if (Array.isArray(data)) {
    return data.map((item) => sanitizePayload(item));
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (isSensitiveKey(key) || isSensitiveValue(value)) {
      sanitized[key] = REDACTED;
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizePayload(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/** Logged path without its query string; the query is logged separately, sanitized. */
export function pathWithoutQuery(url: string): string {
  const index = url.indexOf('?');
  return index === -1 ? url : url.slice(0, index);
}

/**
 * US-029 / #270: safe summary of an error for server logs. Body-parser errors
 * carry the raw request text in `err.body` (which can contain passwords, OTPs,
 * or TOTP codes), so only non-content metadata is kept for them. Other errors
 * keep their stack for operations but drop arbitrary attached properties.
 */
export function describeErrorForLog(err: unknown): Record<string, unknown> {
  if (!err || typeof err !== 'object') return { error: String(err) };
  const error = err as Error & { type?: unknown; status?: unknown; statusCode?: unknown };
  const status = typeof error.status === 'number' ? error.status : error.statusCode;
  if (typeof error.type === 'string' && error.type.startsWith('entity.')) {
    return { name: error.name, type: error.type, status, message: 'Request body could not be parsed.' };
  }
  return { name: error.name, message: error.message, status, stack: error.stack };
}

export function requestLoggerMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - startTime;
    const logEntry = {
      timestamp: new Date().toISOString(),
      requestId: req.id || 'unknown',
      method: req.method,
      path: pathWithoutQuery(req.originalUrl || req.url),
      statusCode: res.statusCode,
      durationMs,
      // Sanitized query/body if present
      query: sanitizePayload(req.query),
      body: sanitizePayload(req.body),
    };

    // Output structured JSON in non-test environments
    if (process.env.NODE_ENV !== 'test') {
      console.log(JSON.stringify(logEntry));
    }
  });

  next();
}
