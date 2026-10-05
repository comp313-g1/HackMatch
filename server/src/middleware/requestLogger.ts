import { Request, Response, NextFunction } from 'express';

const SENSITIVE_KEYS = new Set([
  'password',
  'token',
  'otp',
  'refreshtoken',
  'accesstoken',
  'secret',
  'authorization',
  'cookie',
  'set-cookie',
]);

export function sanitizePayload(data: unknown): unknown {
  if (data === null || data === undefined) return data;
  if (typeof data !== 'object') return data;

  if (Array.isArray(data)) {
    return data.map((item) => sanitizePayload(item));
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.has(lowerKey)) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizePayload(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export function requestLoggerMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - startTime;
    const logEntry = {
      timestamp: new Date().toISOString(),
      requestId: req.id || 'unknown',
      method: req.method,
      path: req.originalUrl || req.url,
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
