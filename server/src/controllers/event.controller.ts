import type { Request, Response } from 'express';
import { eventsRepository } from '../db/events.repository.js';
import { toPublicEvent } from '../services/eventVisibility.js';

export async function listPublicEvents(_req: Request, res: Response): Promise<void> {
  try {
    const limit = 20;
    const offset = 0;

    const { rows, total } = await eventsRepository.listPublicEvents({ limit, offset });
    const events = rows.map((r) => toPublicEvent(r));

    res.status(200).json({
      events,
      total,
      limit,
      offset,
    });
  } catch {
    res.status(500).json({ error: 'Internal Server Error' });
  }
}

export async function getPublicEvent(req: Request, res: Response): Promise<void> {
  try {
    const eventId = String(req.params.eventId);
    const record = await eventsRepository.findPublicEventById(eventId);

    if (!record) {
      res.status(404).json({ error: 'Event not found' });
      return;
    }

    res.status(200).json({
      event: toPublicEvent(record),
    });
  } catch {
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
