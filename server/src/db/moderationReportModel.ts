/**
 * US-025 / #231 moderation-report PostgreSQL model contract and target reference rules.
 *
 * Source of truth: migration 0048_create_moderation_reports.sql (FR-073 / FR-074).
 */

import crypto from 'node:crypto';
import type {
  ModerationReportCategory,
  ModerationReportRecord,
  ModerationReportTargetType,
} from './types.js';

export const REPORT_CATEGORIES: readonly ModerationReportCategory[] = [
  'Harassment',
  'Spam',
  'Phishing Link',
  'Fake Account',
] as const;

export const REPORT_TARGET_TYPES: readonly ModerationReportTargetType[] = [
  'team',
  'profile',
  'event',
  'url',
] as const;

export const MAX_REPORT_EXPLANATION_LENGTH = 1000;
export const MAX_REPORT_FLAGGED_URL_LENGTH = 2048;
export const MAX_REPORTS_PER_ROLLING_HOUR = 5;
export const ROLLING_HOUR_WINDOW_MS = 60 * 60 * 1000;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface CreateModerationReportRowInput {
  id?: string;
  reporterId: string;
  targetType: ModerationReportTargetType;
  targetId: string;
  category: ModerationReportCategory;
  explanation?: string | null;
  flaggedUrl?: string | null;
  caseId?: string | null;
  createdAt?: string | Date;
}

export function isValidReportUuid(value: string | null | undefined): boolean {
  if (typeof value !== 'string') return false;
  return UUID_PATTERN.test(value.trim());
}

export function isValidReportCategory(
  value: string | null | undefined
): value is ModerationReportCategory {
  if (typeof value !== 'string') return false;
  return (REPORT_CATEGORIES as readonly string[]).includes(value.trim());
}

export function isValidReportTargetType(
  value: string | null | undefined
): value is ModerationReportTargetType {
  if (typeof value !== 'string') return false;
  return (REPORT_TARGET_TYPES as readonly string[]).includes(value.trim());
}

/**
 * Normalizes optional explanation:
 * - null / undefined / whitespace-only -> null
 * - otherwise trimmed string
 */
export function normalizeReportExplanation(
  explanation: string | null | undefined
): string | null {
  if (explanation == null) return null;
  const trimmed = explanation.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function isReportExplanationTooLong(
  explanation: string | null | undefined
): boolean {
  const normalized = normalizeReportExplanation(explanation);
  return (
    normalized !== null && [...normalized].length > MAX_REPORT_EXPLANATION_LENGTH
  );
}

export function normalizeReportFlaggedUrl(
  flaggedUrl: string | null | undefined
): string | null {
  if (flaggedUrl == null) return null;
  const trimmed = flaggedUrl.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function isValidHttpsReportUrl(url: string | null | undefined): boolean {
  const normalized = normalizeReportFlaggedUrl(url);
  if (
    !normalized ||
    !normalized.startsWith('https://') ||
    normalized.length <= 8 ||
    normalized.length > MAX_REPORT_FLAGGED_URL_LENGTH
  ) {
    return false;
  }

  try {
    const parsed = new URL(normalized);
    return (
      parsed.protocol === 'https:' &&
      parsed.hostname.length > 0 &&
      parsed.hostname.includes('.')
    );
  } catch {
    return false;
  }
}

/**
 * Builds and validates a canonical `ModerationReportRecord` matching PostgreSQL constraints.
 */
export function buildModerationReportRecord(
  input: CreateModerationReportRowInput
): ModerationReportRecord {
  if (!isValidReportUuid(input.reporterId)) {
    throw new Error('reporterId must be a valid UUID.');
  }

  if (!isValidReportTargetType(input.targetType)) {
    throw new Error('targetType must be team, profile, event, or url.');
  }

  if (!isValidReportUuid(input.targetId)) {
    throw new Error('targetId must be a valid UUID.');
  }

  const trimmedReporterId = input.reporterId.trim();
  const trimmedTargetId = input.targetId.trim();

  if (input.targetType === 'profile' && trimmedReporterId === trimmedTargetId) {
    throw new Error('SELF_REPORT_FORBIDDEN: Participants cannot report their own profile.');
  }

  if (!isValidReportCategory(input.category)) {
    throw new Error(
      'category must be Harassment, Spam, Phishing Link, or Fake Account.'
    );
  }

  const explanation = normalizeReportExplanation(input.explanation);
  if (
    explanation !== null &&
    [...explanation].length > MAX_REPORT_EXPLANATION_LENGTH
  ) {
    throw new Error(
      `explanation must be at most ${MAX_REPORT_EXPLANATION_LENGTH} characters.`
    );
  }

  const flaggedUrl = normalizeReportFlaggedUrl(input.flaggedUrl);
  if (input.targetType === 'url' && !flaggedUrl) {
    throw new Error('flaggedUrl is required when targetType is url.');
  }

  if (flaggedUrl !== null && !isValidHttpsReportUrl(flaggedUrl)) {
    throw new Error(
      `flaggedUrl must be a valid https:// URL at most ${MAX_REPORT_FLAGGED_URL_LENGTH} characters.`
    );
  }

  if (input.caseId != null && !isValidReportUuid(input.caseId)) {
    throw new Error('caseId must be a valid UUID when provided.');
  }

  const createdAtIso =
    input.createdAt instanceof Date
      ? input.createdAt.toISOString()
      : typeof input.createdAt === 'string' && input.createdAt.trim().length > 0
        ? new Date(input.createdAt).toISOString()
        : new Date().toISOString();

  return Object.freeze({
    id: input.id?.trim() || crypto.randomUUID(),
    reporter_id: trimmedReporterId,
    target_type: input.targetType.trim() as ModerationReportTargetType,
    target_id: trimmedTargetId,
    category: input.category.trim() as ModerationReportCategory,
    explanation,
    flagged_url: flaggedUrl,
    case_id: input.caseId ? input.caseId.trim() : null,
    created_at: createdAtIso,
  });
}
