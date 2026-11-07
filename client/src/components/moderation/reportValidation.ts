import {
  MAX_REPORT_EXPLANATION_LENGTH,
  MAX_REPORT_FLAGGED_URL_LENGTH,
  REPORT_CATEGORIES,
  REPORT_TARGET_TYPES,
  type ReportCategory,
  type ReportTargetType,
  type SubmitReportPayload,
} from './reportTypes';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ValidateReportInput {
  targetType?: string | null;
  targetId?: string | null;
  category?: string | null;
  explanation?: string | null;
  flaggedUrl?: string | null;
}

export interface ValidateReportResult {
  valid: boolean;
  fieldErrors: Record<string, string>;
  normalized?: SubmitReportPayload;
}

export function isValidReportCategory(
  value: string | null | undefined
): value is ReportCategory {
  if (typeof value !== 'string') return false;
  return (REPORT_CATEGORIES as readonly string[]).includes(value.trim());
}

export function isValidReportTargetType(
  value: string | null | undefined
): value is ReportTargetType {
  if (typeof value !== 'string') return false;
  return (REPORT_TARGET_TYPES as readonly string[]).includes(value.trim());
}

export function normalizeReportExplanation(
  value: string | null | undefined
): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function isReportExplanationTooLong(
  value: string | null | undefined
): boolean {
  const normalized = normalizeReportExplanation(value);
  return (
    normalized !== null && [...normalized].length > MAX_REPORT_EXPLANATION_LENGTH
  );
}

export function normalizeReportFlaggedUrl(
  value: string | null | undefined
): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
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

export function validateReportSubmissionInput(
  input: ValidateReportInput
): ValidateReportResult {
  const fieldErrors: Record<string, string> = {};

  let targetType: ReportTargetType | null = null;
  if (!isValidReportTargetType(input.targetType)) {
    fieldErrors.targetType =
      'Please select a valid report target (team, profile, event, or url).';
  } else {
    targetType = input.targetType!.trim() as ReportTargetType;
  }

  const rawTargetId =
    typeof input.targetId === 'string' ? input.targetId.trim() : '';
  if (!UUID_REGEX.test(rawTargetId)) {
    fieldErrors.targetId = 'A valid target identifier is required.';
  }

  let category: ReportCategory | null = null;
  if (!isValidReportCategory(input.category)) {
    fieldErrors.category =
      'Please select a valid category (Harassment, Spam, Phishing Link, or Fake Account).';
  } else {
    category = input.category!.trim() as ReportCategory;
  }

  let explanation: string | null = null;
  if (input.explanation !== undefined && input.explanation !== null) {
    if (typeof input.explanation !== 'string') {
      fieldErrors.explanation = 'Explanation must be a string when provided.';
    } else if (isReportExplanationTooLong(input.explanation)) {
      fieldErrors.explanation = `Explanation must not exceed ${MAX_REPORT_EXPLANATION_LENGTH} characters.`;
    } else {
      explanation = normalizeReportExplanation(input.explanation);
    }
  }

  const flaggedUrl = normalizeReportFlaggedUrl(input.flaggedUrl);
  if (targetType === 'url' && !flaggedUrl) {
    fieldErrors.flaggedUrl =
      'A valid https:// URL is required when reporting a suspicious link.';
  } else if (flaggedUrl !== null && !isValidHttpsReportUrl(flaggedUrl)) {
    fieldErrors.flaggedUrl = `Flagged URL must be a valid https:// URL up to ${MAX_REPORT_FLAGGED_URL_LENGTH} characters.`;
  }

  if (Object.keys(fieldErrors).length > 0 || !targetType || !category) {
    return {
      valid: false,
      fieldErrors,
    };
  }

  return {
    valid: true,
    fieldErrors: {},
    normalized: {
      targetType,
      targetId: rawTargetId,
      category,
      explanation,
      flaggedUrl,
    },
  };
}
