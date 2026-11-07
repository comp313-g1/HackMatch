/**
 * US-025 / #234 rolling-hour rate limiter for participant moderation reports (AC 3 / FR-074).
 * Enforces at most 5 reports per account per rolling 60-minute window (3,600,000 ms).
 * Rejections return HTTP 429 RATE_LIMITED with explicit retry timing and advice.
 */

import {
  MAX_REPORTS_PER_ROLLING_HOUR,
  ROLLING_HOUR_WINDOW_MS,
} from '../db/moderationReportModel.js';
import { moderationReportsRepository } from '../db/moderationReports.repository.js';

export const REPORT_RATE_LIMIT_MAX = MAX_REPORTS_PER_ROLLING_HOUR; // 5
export const REPORT_RATE_LIMIT_WINDOW_MS = ROLLING_HOUR_WINDOW_MS; // 3_600_000
export const REPORT_RATE_LIMIT_WINDOW_SECONDS = Math.floor(
  ROLLING_HOUR_WINDOW_MS / 1000
); // 3600

export interface ReportRateLimitEvaluation {
  allowed: boolean;
  limit: number;
  used: number;
  remaining: number;
  windowSeconds: number;
  retryAfterSeconds: number;
  resetAt: string | null;
  retryMessage: string | null;
}

export class ReportRateLimitError extends Error {
  readonly status = 429;
  readonly code = 'RATE_LIMITED' as const;
  readonly retryAfterSeconds: number;
  readonly rateLimit: ReportRateLimitEvaluation;

  constructor(evaluation: ReportRateLimitEvaluation) {
    const message =
      evaluation.retryMessage ??
      `Rate limit exceeded: You may submit at most ${evaluation.limit} reports per rolling hour.`;
    super(message);
    this.name = 'ReportRateLimitError';
    this.retryAfterSeconds = evaluation.retryAfterSeconds;
    this.rateLimit = evaluation;
  }
}

/**
 * Evaluates whether a participant account has available report quota in the rolling hour.
 * Supports clock injection via options.now for deterministic testing without Supertest hangs.
 */
export async function evaluateReportRateLimit(
  reporterId: string,
  options?: { now?: () => Date }
): Promise<ReportRateLimitEvaluation> {
  const nowDate = options?.now ? options.now() : new Date();
  const nowMs = nowDate.getTime();
  const windowStartMs = nowMs - REPORT_RATE_LIMIT_WINDOW_MS;
  const windowStartDate = new Date(windowStartMs);

  const recentReports =
    await moderationReportsRepository.findReportsByReporterSince(
      reporterId,
      windowStartDate
    );

  // Filter reports strictly within (now - 60 min, now]
  const validReports = recentReports.filter((r) => {
    const reportMs = new Date(r.created_at).getTime();
    return reportMs > windowStartMs && reportMs <= nowMs;
  });

  const used = validReports.length;

  if (used >= REPORT_RATE_LIMIT_MAX) {
    const oldestMs = Math.min(
      ...validReports.map((r) => new Date(r.created_at).getTime())
    );
    const opensAtMs = oldestMs + REPORT_RATE_LIMIT_WINDOW_MS;
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((opensAtMs - nowMs) / 1000)
    );
    const retryMinutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
    const resetAt = new Date(opensAtMs).toISOString();
    const retryMessage = `Rate limit exceeded: You may submit at most ${REPORT_RATE_LIMIT_MAX} reports per rolling hour. Please wait ${retryMinutes} minute(s) (${retryAfterSeconds} seconds) before submitting another report.`;

    return {
      allowed: false,
      limit: REPORT_RATE_LIMIT_MAX,
      used,
      remaining: 0,
      windowSeconds: REPORT_RATE_LIMIT_WINDOW_SECONDS,
      retryAfterSeconds,
      resetAt,
      retryMessage,
    };
  }

  return {
    allowed: true,
    limit: REPORT_RATE_LIMIT_MAX,
    used,
    remaining: Math.max(0, REPORT_RATE_LIMIT_MAX - used),
    windowSeconds: REPORT_RATE_LIMIT_WINDOW_SECONDS,
    retryAfterSeconds: 0,
    resetAt: null,
    retryMessage: null,
  };
}

/**
 * Asserts that the reporter is within the 5-reports-per-rolling-hour limit.
 * Throws ReportRateLimitError (HTTP 429) if the limit is exceeded.
 */
export async function assertReportRateLimit(
  reporterId: string,
  options?: { now?: () => Date }
): Promise<ReportRateLimitEvaluation> {
  const evaluation = await evaluateReportRateLimit(reporterId, options);
  if (!evaluation.allowed) {
    throw new ReportRateLimitError(evaluation);
  }
  return evaluation;
}
