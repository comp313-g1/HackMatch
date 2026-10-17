import { Router } from 'express';
import { listPublicEvents, getPublicEvent } from '../controllers/event.controller.js';
import { validateEventIdParam } from '../validators/event.validator.js';

export const eventRouter = Router();

/**
 * Public hackathon discovery endpoints (US-008 / FR-018 / FR-020).
 * Open to Visitors and signed-in Participants alike (no auth middleware required).
 */
eventRouter.get('/', listPublicEvents);
eventRouter.get('/:eventId', validateEventIdParam, getPublicEvent);
