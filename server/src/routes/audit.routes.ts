
import { Router } from 'express';
import { requireAccountsAdmin } from '../middleware/requireAccountsAdmin.js';
import { listAuditRecordsHandler } from '../controllers/audit.controller.js';

export const auditRouter = Router();

auditRouter.use(...requireAccountsAdmin);

auditRouter.get('/', listAuditRecordsHandler);
