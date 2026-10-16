import type { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Rejects plain-HTTP requests when HTTPS is enforced (US-003 AC 4: tokens are sent over
 * HTTPS only). Behind a load balancer, `trust proxy` must be set so `req.secure`
 * reflects the original X-Forwarded-Proto.
 */
export function createRequireHttps(enforce: boolean): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!enforce || req.secure) {
      next();
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.status(403).json({
      error: 'HTTPS is required. Please use a secure connection.',
      code: 'HTTPS_REQUIRED',
    });
  };
}
