import type { Request, Response } from 'express';
import { eventsRepository } from '../db/events.repository.js';
import { toPublicEvent } from '../services/eventVisibility.js';
import { parseEventListQuery } from '../validators/event.validator.js';

export async function listPublicEvents(req: Request, res: Response): Promise<void> {
  try {
    const parseResult = parseEventListQuery(req.query as Record<string, unknown>);

    if (!parseResult.ok) {
      res.status(400).json({
        error: 'Invalid query parameters',
        fields: parseResult.fields,
      });
      return;
    }

    const { filter } = parseResult;
    const { rows, total } = await eventsRepository.listPublicEvents(filter);
    const events = rows.map((r) => toPublicEvent(r));

    res.status(200).json({
      events,
      total,
      limit: filter.limit,
      offset: filter.offset,
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
