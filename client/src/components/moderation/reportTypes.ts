/**
 * US-025 / #232 participant reporting modal types for profiles, team listings,
 * Verified event listings, and suspicious external URLs (FR-073 / FR-074).
 */

export type ReportTargetType = 'team' | 'profile' | 'event' | 'url';

export type ReportCategory =
  | 'Harassment'
  | 'Spam'
  | 'Phishing Link'
  | 'Fake Account';

export const REPORT_CATEGORIES: readonly ReportCategory[] = [
  'Harassment',
  'Spam',
  'Phishing Link',
  'Fake Account',
] as const;

export const REPORT_TARGET_TYPES: readonly ReportTargetType[] = [
  'team',
  'profile',
  'event',
  'url',
] as const;

export const MAX_REPORT_EXPLANATION_LENGTH = 1000;
export const MAX_REPORT_FLAGGED_URL_LENGTH = 2048;

export interface ReportTargetSummary {
  targetType: ReportTargetType;
  targetId: string;
  targetName: string;
  flaggedUrl?: string | null;
}

export interface SubmitReportPayload {
  targetType: ReportTargetType;
  targetId: string;
  category: ReportCategory;
  explanation: string | null;
  flaggedUrl: string | null;
}

export interface ReportRateLimitMeta {
  limit: number;
  remaining: number;
  windowSeconds: number;
}

export interface ReportReceiptDto {
  reportId: string;
  caseId: string;
  targetType: ReportTargetType;
  targetId: string;
  category: ReportCategory;
  status: 'Received';
  submittedAt: string;
  confirmationMessage: string;
  rateLimit: ReportRateLimitMeta;
}

export interface ReportApiErrorResponse {
  code: string;
  message: string;
  fieldErrors?: Record<string, string>;
  retryAfterSeconds?: number;
}
