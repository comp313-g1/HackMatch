import type { Request, Response, NextFunction } from 'express';
import { config } from '../config/index.js';
import { securityConfig } from '../config/security.js';
import { tokensMatch } from '../utils/sessionCookies.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Request-forgery protection for cookie-authenticated routes (US-003 AC 4).
 * Unsafe methods must come from the client origin (when the browser sends Origin) and
 * echo the hm_csrf cookie in the X-CSRF-Token header (double-submit token).
 */
export function requireCsrf(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  res.setHeader('Cache-Control', 'no-store');

  const origin = req.headers.origin;
  if (origin !== undefined && origin !== config.clientUrl) {
    res.status(403).json({ error: 'Request origin is not allowed.', code: 'ORIGIN_NOT_ALLOWED' });
    return;
  }

  const cookies = (req.cookies ?? {}) as Record<string, unknown>;
  const cookieToken = cookies[securityConfig.sessionCookie.csrfName];
  const headerToken = req.headers['x-csrf-token'];

  if (
    typeof cookieToken !== 'string' ||
    cookieToken === '' ||
    typeof headerToken !== 'string' ||
    !tokensMatch(cookieToken, headerToken)
  ) {
    res.status(403).json({
      error: 'Security check failed. Please refresh the page and try again.',
      code: 'CSRF_TOKEN_INVALID',
    });
    return;
  }

  next();
}
