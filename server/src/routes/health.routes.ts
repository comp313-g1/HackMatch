import { Router, Request, Response } from 'express';

export const healthRouter = Router();

/**
 * Public liveness probe per NR-022.
 * Exposes no internal topology, version numbers, or sensitive credentials.
 */
healthRouter.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});
