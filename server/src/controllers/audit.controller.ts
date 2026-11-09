import type { Request, Response } from 'express';

export async function listAuditRecordsHandler(
  _req: Request,
  res: Response
): Promise<void> {
  res.status(501).json({
    error: 'Audit record query not implemented yet',
  });
}