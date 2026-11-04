/**
 * US-023: Validators for private team workspace payloads (links, notes).
 *
 * Implements validation rules for external tool links (FR-069, US-023 AC 3)
 * and markdown notes (FR-070, US-023 AC 4).
 */

import type { Request, Response, NextFunction } from 'express';
import {
  WORKSPACE_LINK_LABEL_MAX_LENGTH,
  WORKSPACE_LINK_URL_MAX_LENGTH,
  WORKSPACE_MAX_LINKS,
} from '../db/teamWorkspaceModel.js';
import { isValidHttpsPortfolioUrl } from './profile.validator.js';
import type { UpsertWorkspaceLinkInput } from '../db/types.js';

export interface WorkspaceLinksValidationSuccess {
  ok: true;
  links: UpsertWorkspaceLinkInput[];
}

export interface WorkspaceLinksValidationFailure {
  ok: false;
  errors: Record<string, string>;
}

export type WorkspaceLinksValidationResult =
  | WorkspaceLinksValidationSuccess
  | WorkspaceLinksValidationFailure;

const FORBIDDEN_LINK_KEYS = new Set([
  'teamid',
  'team_id',
  'updatedby',
  'updated_by',
  'role',
  'teamrole',
  'team_role',
  'createdat',
  'created_at',
  'updatedat',
  'updated_at',
]);

const ALLOWED_LINK_KEYS = new Set([
  'id',
  'label',
  'url',
  'display_order',
  'displayorder',
]);

/**
 * Validates external tool links replacement body:
 * - Requires object with only "links" property.
 * - Array length 0..10.
 * - For each item: non-empty label (1..80 chars), secure https URL (9..2048 chars, valid host, no credentials), no forbidden keys.
 * - Rejects duplicate URLs within the submission.
 */
export function validateWorkspaceLinksInput(
  body: unknown
): WorkspaceLinksValidationResult {
  const errors: Record<string, string> = {};

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      ok: false,
      errors: { body: 'Request body must be a valid JSON object.' },
    };
  }

  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);

  for (const key of keys) {
    if (key !== 'links') {
      errors.body = `Unknown property "${key}". Only "links" is allowed.`;
      return { ok: false, errors };
    }
  }

  if (!Array.isArray(record.links)) {
    return {
      ok: false,
      errors: { links: 'Property "links" must be an array.' },
    };
  }

  const linksArray = record.links as unknown[];

  if (linksArray.length > WORKSPACE_MAX_LINKS) {
    return {
      ok: false,
      errors: {
        links: `At most ${WORKSPACE_MAX_LINKS} external tool links can be saved.`,
      },
    };
  }

  const validatedLinks: UpsertWorkspaceLinkInput[] = [];
  const seenUrls = new Set<string>();

  for (let i = 0; i < linksArray.length; i++) {
    const item = linksArray[i];
    const prefix = `links[${i}]`;

    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors[prefix] = 'Link item must be an object.';
      continue;
    }

    const itemRecord = item as Record<string, unknown>;
    const itemKeys = Object.keys(itemRecord);

    let itemHasForbiddenKey = false;
    for (const key of itemKeys) {
      const lowerKey = key.toLowerCase();
      if (FORBIDDEN_LINK_KEYS.has(lowerKey)) {
        errors[prefix] = `Property "${key}" is not permitted.`;
        itemHasForbiddenKey = true;
        break;
      }
      if (!ALLOWED_LINK_KEYS.has(lowerKey)) {
        errors[prefix] = `Unknown property "${key}".`;
        itemHasForbiddenKey = true;
        break;
      }
    }

    if (itemHasForbiddenKey) {
      continue;
    }

    // Validate label
    let normalizedLabel = '';
    if (typeof itemRecord.label !== 'string') {
      errors[`${prefix}.label`] = 'Link label must be a string.';
    } else {
      normalizedLabel = itemRecord.label.trim().replace(/\s+/g, ' ');
      if (normalizedLabel.length === 0) {
        errors[`${prefix}.label`] = 'Link label cannot be empty.';
      } else if (normalizedLabel.length > WORKSPACE_LINK_LABEL_MAX_LENGTH) {
        errors[`${prefix}.label`] = `Link label cannot exceed ${WORKSPACE_LINK_LABEL_MAX_LENGTH} characters.`;
      }
    }

    // Validate URL
    let trimmedUrl = '';
    if (typeof itemRecord.url !== 'string') {
      errors[`${prefix}.url`] = 'Link URL must be a string.';
    } else {
      trimmedUrl = itemRecord.url.trim();
      if (trimmedUrl.length === 0) {
        errors[`${prefix}.url`] = 'Link URL cannot be empty.';
      } else if (trimmedUrl.length > WORKSPACE_LINK_URL_MAX_LENGTH) {
        errors[`${prefix}.url`] = `Link URL cannot exceed ${WORKSPACE_LINK_URL_MAX_LENGTH} characters.`;
      } else if (!isValidHttpsPortfolioUrl(trimmedUrl)) {
        errors[`${prefix}.url`] =
          'URL must be a valid HTTPS link (e.g. https://github.com/team/repo).';
      } else {
        const canonicalUrl = trimmedUrl.toLowerCase();
        if (seenUrls.has(canonicalUrl)) {
          errors[`${prefix}.url`] =
            'Duplicate link URL is not permitted within the same team workspace.';
        } else {
          seenUrls.add(canonicalUrl);
        }
      }
    }

    // Display order (optional integer)
    let displayOrder = i;
    const rawOrder = itemRecord.display_order ?? itemRecord.displayOrder;
    if (rawOrder !== undefined) {
      if (
        typeof rawOrder === 'number' &&
        Number.isInteger(rawOrder) &&
        rawOrder >= 0 &&
        rawOrder < WORKSPACE_MAX_LINKS
      ) {
        displayOrder = rawOrder;
      } else {
        errors[`${prefix}.display_order`] = `display_order must be an integer between 0 and ${WORKSPACE_MAX_LINKS - 1}.`;
      }
    }

    if (
      !errors[`${prefix}.label`] &&
      !errors[`${prefix}.url`] &&
      !errors[`${prefix}.display_order`]
    ) {
      validatedLinks.push({
        label: normalizedLabel,
        url: trimmedUrl,
        display_order: displayOrder,
      });
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, links: validatedLinks };
}

/**
 * Express middleware to validate external workspace links.
 * Halts with 400 VALIDATION_ERROR before database write occurs, preserving existing data (NR-010).
 */
export function validateWorkspaceLinksBody(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const result = validateWorkspaceLinksInput(req.body);

  if (!result.ok) {
    res.status(400).json({
      error: 'Validation failed. Existing workspace links were not modified.',
      code: 'VALIDATION_ERROR',
      errors: result.errors,
    });
    return;
  }

  (req as Request & { validatedWorkspaceLinks?: UpsertWorkspaceLinkInput[] }).validatedWorkspaceLinks =
    result.links;
  next();
}
