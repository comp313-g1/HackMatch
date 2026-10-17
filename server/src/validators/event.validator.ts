import type { Request, Response, NextFunction } from 'express';
import type { EventListFilter, TimeState } from '../db/events.repository.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const EVENT_FORMATS = ['In-Person', 'Virtual', 'Hybrid'] as const;
export type EventFormat = (typeof EVENT_FORMATS)[number];

const VALID_TIME_STATES = ['upcoming', 'ongoing', 'concluded'] as const;

/**
 * Validates that :eventId route param is a valid UUIDv4/UUID.
 * Rejects with 400 Bad Request if malformed, preventing injection or wasted DB queries.
 */
export function validateEventIdParam(req: Request, res: Response, next: NextFunction): void {
  const { eventId } = req.params;

  if (!eventId || typeof eventId !== 'string' || !UUID_REGEX.test(eventId.trim())) {
    res.status(400).json({ error: 'Invalid event id' });
    return;
  }

  next();
}

export type ParseEventListQueryResult =
  | { ok: true; filter: Omit<EventListFilter, 'now'> }
  | { ok: false; fields: Record<string, string> };

/**
 * Parses and strictly validates query parameters for public event listings:
 * - q: keyword, trimmed, collapsed internal whitespace, max 100 chars
 * - format: trimmed, strictly one of ['In-Person', 'Virtual', 'Hybrid'] (case-insensitive), canonicalized
 * - timeState: trimmed, strictly one of ['upcoming', 'ongoing', 'concluded'] (case-insensitive)
 * - limit: integer 1-50 (default: 20)
 * - offset: integer >= 0 (default: 0)
 * Rejects arrays (?q=a&q=b) and invalid inputs with field-specific errors.
 */
export function parseEventListQuery(query: Record<string, unknown>): ParseEventListQueryResult {
  const fields: Record<string, string> = {};

  // Limit parsing
  let limit = 20;
  if (query.limit !== undefined) {
    if (typeof query.limit !== 'string' || !/^\d+$/.test(query.limit.trim())) {
      fields.limit = 'Limit must be an integer between 1 and 50';
    } else {
      const parsedLimit = parseInt(query.limit.trim(), 10);
      if (parsedLimit < 1 || parsedLimit > 50) {
        fields.limit = 'Limit must be an integer between 1 and 50';
      } else {
        limit = parsedLimit;
      }
    }
  }

  // Offset parsing
  let offset = 0;
  if (query.offset !== undefined) {
    if (typeof query.offset !== 'string' || !/^\d+$/.test(query.offset.trim())) {
      fields.offset = 'Offset must be a non-negative integer';
    } else {
      const parsedOffset = parseInt(query.offset.trim(), 10);
      if (parsedOffset < 0) {
        fields.offset = 'Offset must be a non-negative integer';
      } else {
        offset = parsedOffset;
      }
    }
  }

  // Keyword parsing
  let keyword: string | undefined;
  if (query.q !== undefined) {
    if (typeof query.q !== 'string') {
      fields.q = 'Keyword must be a single string';
    } else {
      const trimmed = query.q.trim().replace(/\s+/g, ' ');
      if (trimmed.length > 0) {
        keyword = trimmed.slice(0, 100);
      }
    }
  }

  // Format parsing (strict canonical whitelist, case-insensitive)
  let format: string | undefined;
  if (query.format !== undefined) {
    if (typeof query.format !== 'string') {
      fields.format = 'Format must be one of: In-Person, Virtual, Hybrid';
    } else {
      const trimmed = query.format.trim().toLowerCase();
      if (trimmed.length > 0) {
        const canonical = EVENT_FORMATS.find((f) => f.toLowerCase() === trimmed);
        if (!canonical) {
          fields.format = 'Format must be one of: In-Person, Virtual, Hybrid';
        } else {
          format = canonical;
        }
      }
    }
  }

  // TimeState parsing (strict whitelist, case-insensitive)
  let timeState: TimeState | undefined;
  if (query.timeState !== undefined) {
    if (typeof query.timeState !== 'string') {
      fields.timeState = 'Time state must be one of: upcoming, ongoing, concluded';
    } else {
      const trimmed = query.timeState.trim().toLowerCase() as TimeState;
      if (trimmed.length > 0) {
        if (!VALID_TIME_STATES.includes(trimmed)) {
          fields.timeState = 'Time state must be one of: upcoming, ongoing, concluded';
        } else {
          timeState = trimmed;
        }
      }
    }
  }

  if (Object.keys(fields).length > 0) {
    return { ok: false, fields };
  }

  return {
    ok: true,
    filter: {
      limit,
      offset,
      ...(keyword !== undefined ? { keyword } : {}),
      ...(format !== undefined ? { format } : {}),
      ...(timeState !== undefined ? { timeState } : {}),
    },
  };
}
