import { Router, Request, Response } from 'express';
import { requireVerifiedParticipant } from '../middleware/requireVerifiedParticipant.js';

export const actionsRouter = Router();

/**
 * Protected action routes enforcing US-001 AC 4, US-001-T5, and FR-002:
 * "Unverified accounts cannot declare availability, create teams, apply, or accept invitations."
 *
 * These route handlers act as protected entry points across the 4 pre-hackathon
 * recruitment scopes, delegating authorization to `requireVerifiedParticipant`.
 */

// 1. Team creation (US-012 / AC 4)
actionsRouter.post(
  '/teams',
  requireVerifiedParticipant,
  (_req: Request, res: Response) => {
    res.status(201).json({ message: 'Team created successfully' });
  }
);

// 2. Availability declaration (US-011 / AC 4)
actionsRouter.post(
  '/availability',
  requireVerifiedParticipant,
  (_req: Request, res: Response) => {
    res.status(200).json({ message: 'Availability declared' });
  }
);

// 3. Application submission (US-018 / AC 4)
actionsRouter.post(
  '/applications',
  requireVerifiedParticipant,
  (_req: Request, res: Response) => {
    res.status(201).json({ message: 'Application submitted' });
  }
);

// 4. Invitation acceptance (US-017 / US-019 / AC 4)
actionsRouter.post(
  '/invitations/:id/accept',
  requireVerifiedParticipant,
  (_req: Request, res: Response) => {
    res.status(200).json({ message: 'Invitation accepted' });
  }
);
