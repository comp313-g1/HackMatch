import type { Request, Response, NextFunction } from 'express';
import type { ParticipantPrimaryRole } from '../db/types.js';
import type { PortfolioLinkInput } from '../db/profile.repository.js';
import { PRIVILEGE_ESCALATION_KEYS } from './auth.validator.js';

export const ALLOWED_PRIMARY_ROLES: readonly ParticipantPrimaryRole[] = [
  'Frontend',
  'Backend',
  'Mobile',
  'AI/ML',
  'UI/UX',
  'Pitch',
];

export const MAX_HANDLE_LENGTH = 50;
export const MIN_HANDLE_LENGTH = 2;
export const MAX_INSTITUTION_LENGTH = 150;
export const MAX_SHARED_CONTACT_LENGTH = 150;
export const MAX_SKILL_LENGTH = 50;
export const MAX_SKILLS_COUNT = 25;
export const MAX_PORTFOLIO_LINKS_COUNT = 10;
export const MAX_PORTFOLIO_URL_LENGTH = 2048;
export const MIN_PORTFOLIO_URL_LENGTH = 9; // 'https://' + at least 1 char (> 8 per DB constraint)
export const MAX_PORTFOLIO_LABEL_LENGTH = 100;

const HANDLE_REGEX = /^[A-Za-z0-9_-]{2,50}$/;

export interface ProfileFieldErrors {
  handle?: string;
  primaryRole?: string;
  institution?: string;
  skills?: string;
  portfolioLinks?: string;
  sharedContactHandle?: string;
}

export interface SanitizedProfilePayload {
  handle: string | null;
  primaryRole: ParticipantPrimaryRole | null;
  institution: string | null;
  skills: string[];
  portfolioLinks: PortfolioLinkInput[];
  sharedContactHandle: string | null;
}

/**
 * Validates that a portfolio URL is a well-formed HTTPS URL per US-006 AC 2 / FR-013
 * and 0004_create_profile_tables.sql CHECK (url LIKE 'https://%' AND LENGTH(url) > 8).
 */
export function isValidHttpsPortfolioUrl(rawUrl: string): boolean {
  if (typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  if (
    trimmed.length < MIN_PORTFOLIO_URL_LENGTH ||
    trimmed.length > MAX_PORTFOLIO_URL_LENGTH
  ) {
    return false;
  }
  if (!trimmed.toLowerCase().startsWith('https://')) {
    return false;
  }
  if (/\s/.test(trimmed)) {
    return false;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return false;
    if (parsed.username !== '' || parsed.password !== '') return false;

    const host = parsed.hostname;
    if (!host || !host.includes('.') || host.startsWith('.') || host.endsWith('.')) {
      return false;
    }
    const labels = host.split('.');
    if (labels.some((label) => label.length === 0)) {
      return false;
    }
    const tld = labels[labels.length - 1]!;
    if (tld.length < 2 || /^\d+$/.test(tld)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Pure validation helper for US-006 profile update payloads.
 * Returns field-specific errors without discarding valid fields on the caller side.
 */
export function validateProfileUpdateInput(body: unknown): {
  errors: ProfileFieldErrors;
  sanitized?: SanitizedProfilePayload;
} {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      errors: {
        primaryRole: 'Invalid profile payload.',
      },
    };
  }

  const record = body as Record<string, unknown>;
  const errors: ProfileFieldErrors = {};

  // 1. Handle validation (optional, 2-50 chars alphanumeric, underscore, hyphen)
  let handle: string | null = null;
  if (record.handle !== undefined && record.handle !== null && record.handle !== '') {
    if (typeof record.handle !== 'string') {
      errors.handle = 'Handle must be a text value.';
    } else {
      const trimmedHandle = record.handle.trim();
      if (trimmedHandle.length > 0) {
        if (!HANDLE_REGEX.test(trimmedHandle)) {
          errors.handle =
            'Handle must be 2 to 50 characters and contain only letters, numbers, underscores, or hyphens.';
        } else {
          handle = trimmedHandle;
        }
      }
    }
  }

  // 2. Primary role validation (Frontend, Backend, Mobile, AI/ML, UI/UX, Pitch)
  let primaryRole: ParticipantPrimaryRole | null = null;
  if (
    record.primaryRole !== undefined &&
    record.primaryRole !== null &&
    record.primaryRole !== ''
  ) {
    if (
      typeof record.primaryRole !== 'string' ||
      !ALLOWED_PRIMARY_ROLES.includes(record.primaryRole.trim() as ParticipantPrimaryRole)
    ) {
      errors.primaryRole = `Primary role must be one of: ${ALLOWED_PRIMARY_ROLES.join(', ')}.`;
    } else {
      primaryRole = record.primaryRole.trim() as ParticipantPrimaryRole;
    }
  }

  // 3. Academic institution validation (optional, max 150 chars)
  let institution: string | null = null;
  if (
    record.institution !== undefined &&
    record.institution !== null &&
    record.institution !== ''
  ) {
    if (typeof record.institution !== 'string') {
      errors.institution = 'Academic institution must be a text value.';
    } else {
      const trimmedInstitution = record.institution.trim();
      if (trimmedInstitution.length > MAX_INSTITUTION_LENGTH) {
        errors.institution = `Academic institution must not exceed ${MAX_INSTITUTION_LENGTH} characters.`;
      } else if (trimmedInstitution.length > 0) {
        institution = trimmedInstitution;
      }
    }
  }

  // 4. Skills validation (array of non-empty strings, max 50 chars each, deduplicated case-insensitively)
  const skills: string[] = [];
  if (record.skills !== undefined && record.skills !== null) {
    if (!Array.isArray(record.skills)) {
      errors.skills = 'Skills must be provided as a list of skill tags.';
    } else if (record.skills.length > MAX_SKILLS_COUNT) {
      errors.skills = `You can specify at most ${MAX_SKILLS_COUNT} skill tags.`;
    } else {
      const seenSkills = new Set<string>();
      for (const item of record.skills) {
        if (typeof item !== 'string' || item.trim().length === 0) {
          errors.skills = 'Each skill tag must be a non-empty string.';
          break;
        }
        const trimmedSkill = item.trim();
        if (trimmedSkill.length > MAX_SKILL_LENGTH) {
          errors.skills = `Each skill tag must not exceed ${MAX_SKILL_LENGTH} characters.`;
          break;
        }
        const lower = trimmedSkill.toLowerCase();
        if (!seenSkills.has(lower)) {
          seenSkills.add(lower);
          skills.push(trimmedSkill);
        }
      }
    }
  }

  // 5. Portfolio links validation (HTTPS URLs only, optional label <= 100 chars)
  const portfolioLinks: PortfolioLinkInput[] = [];
  if (record.portfolioLinks !== undefined && record.portfolioLinks !== null) {
    if (!Array.isArray(record.portfolioLinks)) {
      errors.portfolioLinks = 'Portfolio links must be provided as a list.';
    } else if (record.portfolioLinks.length > MAX_PORTFOLIO_LINKS_COUNT) {
      errors.portfolioLinks = `You can provide at most ${MAX_PORTFOLIO_LINKS_COUNT} portfolio links.`;
    } else {
      for (const item of record.portfolioLinks) {
        if (typeof item === 'string') {
          const trimmedUrl = item.trim();
          if (trimmedUrl.length === 0) continue;
          if (!isValidHttpsPortfolioUrl(trimmedUrl)) {
            errors.portfolioLinks =
              'All portfolio links must be valid HTTPS URLs (e.g., https://github.com/username).';
            break;
          }
          portfolioLinks.push({ url: trimmedUrl, label: null });
        } else if (item && typeof item === 'object' && !Array.isArray(item)) {
          const linkObj = item as Record<string, unknown>;
          const rawUrl = typeof linkObj.url === 'string' ? linkObj.url.trim() : '';
          if (!isValidHttpsPortfolioUrl(rawUrl)) {
            errors.portfolioLinks =
              'All portfolio links must be valid HTTPS URLs (e.g., https://github.com/username).';
            break;
          }
          let label: string | null = null;
          if (linkObj.label !== undefined && linkObj.label !== null && linkObj.label !== '') {
            if (
              typeof linkObj.label !== 'string' ||
              linkObj.label.trim().length > MAX_PORTFOLIO_LABEL_LENGTH
            ) {
              errors.portfolioLinks = `Portfolio link label must not exceed ${MAX_PORTFOLIO_LABEL_LENGTH} characters.`;
              break;
            }
            label = linkObj.label.trim();
          }
          portfolioLinks.push({ url: rawUrl, label });
        } else {
          errors.portfolioLinks =
            'All portfolio links must be valid HTTPS URLs (e.g., https://github.com/username).';
          break;
        }
      }
    }
  }

  // 6. Shared contact handle validation (optional, max 150 chars)
  let sharedContactHandle: string | null = null;
  if (
    record.sharedContactHandle !== undefined &&
    record.sharedContactHandle !== null &&
    record.sharedContactHandle !== ''
  ) {
    if (typeof record.sharedContactHandle !== 'string') {
      errors.sharedContactHandle = 'Shared contact handle must be a text value.';
    } else {
      const trimmedContact = record.sharedContactHandle.trim();
      if (trimmedContact.length > MAX_SHARED_CONTACT_LENGTH) {
        errors.sharedContactHandle = `Shared contact handle must not exceed ${MAX_SHARED_CONTACT_LENGTH} characters.`;
      } else if (trimmedContact.length > 0) {
        sharedContactHandle = trimmedContact;
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  return {
    errors: {},
    sanitized: {
      handle,
      primaryRole,
      institution,
      skills,
      portfolioLinks,
      sharedContactHandle,
    },
  };
}

/**
 * Express middleware validating profile update requests (US-006 / #65 / FR-013).
 * Rejects privilege escalation keys with 403 and invalid profile fields with 400.
 */
export function validateProfileUpdatePayload(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      errors: {
        primaryRole: 'Invalid profile payload.',
      },
    });
    return;
  }

  const record = body as Record<string, unknown>;

  if (record.role !== undefined && record.role !== null) {
    if (String(record.role).trim().toUpperCase() !== 'PART') {
      res.status(403).json({
        error: 'Profile updates cannot modify account role or privileges.',
        code: 'FORBIDDEN_ROLE_CHANGE',
      });
      return;
    }
  }

  for (const key of PRIVILEGE_ESCALATION_KEYS) {
    if (record[key] !== undefined && record[key] !== null) {
      res.status(403).json({
        error: 'Profile updates cannot modify account role or privileges.',
        code: 'FORBIDDEN_ROLE_CHANGE',
      });
      return;
    }
  }

  const { errors } = validateProfileUpdateInput(body);
  if (Object.keys(errors).length > 0) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      errors,
    });
    return;
  }

  next();
}
