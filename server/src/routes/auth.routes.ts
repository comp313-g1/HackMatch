import { Router } from 'express';
import { validateRegisterPayload } from '../validators/auth.validator.js';
import { register } from '../controllers/auth.controller.js';

export const authRouter = Router();

/**
 * Public registration endpoint for participant accounts (US-001 / FR-001).
 * Validates full name, email format, password complexity, and role boundaries,
 * then provisions Firebase Auth user and PostgreSQL participant record.
 */
authRouter.post('/register', validateRegisterPayload, register);
