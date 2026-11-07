import type { RequestHandler } from 'express';
import type { ManifestExportFormat } from '../services/teamManifestExport.js';
import { normalizeChecksum } from '../services/teamManifestChecksum.js';

export interface ManifestQueryErrors {
  format?: string;
  query?: string;
  [unknownKey: string]: string | undefined;
}

export interface ManifestVerifyBodyErrors {
  checksum?: string;
  body?: string;
  [unknownKey: string]: string | undefined;
}

export interface SanitizedManifestExportQuery {
  format: ManifestExportFormat;
}

export interface SanitizedManifestVerifyBody {
  checksum: string;
  normalizedChecksum: string;
}

const ALLOWED_EXPORT_FORMATS = new Set<ManifestExportFormat>(['json', 'html', 'pdf']);

/**
 * Validates GET /api/teams/:teamId/manifest query parameters (US-024 / FR-071).
 */
export function validateManifestExportQuery(rawQuery: unknown): {
  errors: ManifestQueryErrors;
  sanitized?: SanitizedManifestExportQuery;
} {
  const errors: ManifestQueryErrors = {};

  if (typeof rawQuery !== 'object' || rawQuery === null || Array.isArray(rawQuery)) {
    return {
      errors: { query: 'Query parameters must be an object.' },
    };
  }

  const queryObj = rawQuery as Record<string, unknown>;
  const allowedKeys = new Set(['format']);

  for (const key of Object.keys(queryObj)) {
    if (!allowedKeys.has(key)) {
      errors[key] = `Unexpected query parameter '${key}'. Only 'format' is supported.`;
    }
  }

  let sanitizedFormat: ManifestExportFormat = 'json';

  if (queryObj.format !== undefined) {
    if (typeof queryObj.format !== 'string') {
      errors.format = 'Format query parameter must be a string.';
    } else {
      const normalized = queryObj.format.trim().toLowerCase();
      if (!ALLOWED_EXPORT_FORMATS.has(normalized as ManifestExportFormat)) {
        errors.format = "Export format must be one of: 'json', 'html', or 'pdf'.";
      } else {
        sanitizedFormat = normalized as ManifestExportFormat;
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  return {
    errors: {},
    sanitized: {
      format: sanitizedFormat,
    },
  };
}

/**
 * Validates POST /api/teams/:teamId/manifest/verify request body (US-024 / FR-072 / NR-010).
 */
export function validateManifestVerifyBody(rawBody: unknown): {
  errors: ManifestVerifyBodyErrors;
  sanitized?: SanitizedManifestVerifyBody;
} {
  const errors: ManifestVerifyBodyErrors = {};

  if (typeof rawBody !== 'object' || rawBody === null || Array.isArray(rawBody)) {
    return {
      errors: { body: 'Request body must be a JSON object.' },
    };
  }

  const bodyObj = rawBody as Record<string, unknown>;
  const allowedKeys = new Set(['checksum']);

  for (const key of Object.keys(bodyObj)) {
    if (!allowedKeys.has(key)) {
      errors[key] = `Unexpected field '${key}'. Only 'checksum' is permitted.`;
    }
  }

  const rawChecksum = bodyObj.checksum;

  if (rawChecksum === undefined || rawChecksum === null || (typeof rawChecksum === 'string' && rawChecksum.trim().length === 0)) {
    errors.checksum = 'Checksum is required.';
  } else if (typeof rawChecksum !== 'string') {
    errors.checksum = 'Checksum must be a string.';
  } else {
    const normalized = normalizeChecksum(rawChecksum);
    if (!normalized) {
      errors.checksum = 'Checksum must be a valid 64-character SHA-256 hexadecimal string (e.g. sha256:... or 64 hex characters).';
    } else {
      return Object.keys(errors).length > 0
        ? { errors }
        : {
            errors: {},
            sanitized: {
              checksum: rawChecksum.trim(),
              normalizedChecksum: normalized,
            },
          };
    }
  }

  return { errors };
}

/**
 * Express middleware for GET /api/teams/:teamId/manifest query validation.
 */
export const validateManifestExportQueryMiddleware: RequestHandler = (req, res, next) => {
  const result = validateManifestExportQuery(req.query);
  if (Object.keys(result.errors).length > 0 || !result.sanitized) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({
      error: 'Validation failed.',
      code: 'VALIDATION_ERROR',
      errors: result.errors,
    });
    return;
  }

  res.locals.manifestFormat = result.sanitized.format;
  next();
};

/**
 * Express middleware for POST /api/teams/:teamId/manifest/verify body validation.
 */
export const validateManifestVerifyBodyMiddleware: RequestHandler = (req, res, next) => {
  const result = validateManifestVerifyBody(req.body);
  if (Object.keys(result.errors).length > 0 || !result.sanitized) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({
      error: 'Validation failed.',
      code: 'VALIDATION_ERROR',
      errors: result.errors,
    });
    return;
  }

  req.body = result.sanitized;
  next();
};
