import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incomingId = req.headers['x-request-id'];
  const id = typeof incomingId === 'string' && incomingId.trim() ? incomingId : crypto.randomUUID();
  req.id = id;
  res.setHeader('X-Request-Id', id);
  next();
}
