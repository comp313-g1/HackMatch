import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearModerationReportsStore,
  moderationReportsRepository,
} from '../db/moderationReports.repository.js';
import {
  REPORT_RATE_LIMIT_MAX,
  ReportRateLimitError,
  assertReportRateLimit,
  evaluateReportRateLimit,
} from './reportRateLimiter.js';

describe('reportRateLimiter (US-025 / #234 / FR-074)', () => {
  const reporterId = '11111111-1111-4111-8111-111111111111';
  const baseTime = new Date('2026-11-06T12:00:00.000Z');

  beforeEach(() => {
    clearModerationReportsStore();
  });

  it('allows submissions when reporter has no prior reports in the rolling hour', async () => {
    const evaluation = await evaluateReportRateLimit(reporterId, {
      now: () => baseTime,
    });

    expect(evaluation.allowed).toBe(true);
    expect(evaluation.limit).toBe(5);
    expect(evaluation.used).toBe(0);
    expect(evaluation.remaining).toBe(5);
    expect(evaluation.retryAfterSeconds).toBe(0);
    expect(evaluation.retryMessage).toBeNull();
  });

  it('accurately decrements remaining count as reports are persisted', async () => {
    for (let i = 1; i <= 4; i++) {
      await moderationReportsRepository.createReport({
        reporter_id: reporterId,
        target_type: 'team',
        target_id: `22222222-2222-4222-8222-22222222222${i}`,
        category: 'Spam',
        created_at: new Date(baseTime.getTime() + i * 60_000),
      });

      const evalAtStep = await evaluateReportRateLimit(reporterId, {
        now: () => new Date(baseTime.getTime() + i * 60_000 + 1000),
      });
      expect(evalAtStep.allowed).toBe(true);
      expect(evalAtStep.used).toBe(i);
      expect(evalAtStep.remaining).toBe(REPORT_RATE_LIMIT_MAX - i);
    }
  });

  it('rejects the 6th report within a 60-minute window with 429 and retry timing', async () => {
    // Submit 5 reports at minute 10, 15, 20, 25, 30
    for (let i = 1; i <= 5; i++) {
      await moderationReportsRepository.createReport({
        reporter_id: reporterId,
        target_type: 'team',
        target_id: `22222222-2222-4222-8222-22222222222${i}`,
        category: 'Harassment',
        created_at: new Date(baseTime.getTime() + (5 + i * 5) * 60_000),
      });
    }

    const testNow = new Date(baseTime.getTime() + 35 * 60_000); // 35 minutes in
    const evaluation = await evaluateReportRateLimit(reporterId, {
      now: () => testNow,
    });

    expect(evaluation.allowed).toBe(false);
    expect(evaluation.used).toBe(5);
    expect(evaluation.remaining).toBe(0);

    // Oldest report was at minute 10 (baseTime + 10m).
    // It opens at minute 70 (baseTime + 70m).
    // Current time is minute 35 (baseTime + 35m).
    // Remaining time = 35 minutes = 2100 seconds.
    expect(evaluation.retryAfterSeconds).toBe(2100);
    expect(evaluation.retryMessage).toContain('Rate limit exceeded');
    expect(evaluation.retryMessage).toContain('35 minute(s)');
    expect(evaluation.retryMessage).toContain('2100 seconds');

    await expect(
      assertReportRateLimit(reporterId, { now: () => testNow })
    ).rejects.toThrow(ReportRateLimitError);

    try {
      await assertReportRateLimit(reporterId, { now: () => testNow });
    } catch (err) {
      expect(err).toBeInstanceOf(ReportRateLimitError);
      const rateErr = err as ReportRateLimitError;
      expect(rateErr.status).toBe(429);
      expect(rateErr.code).toBe('RATE_LIMITED');
      expect(rateErr.retryAfterSeconds).toBe(2100);
      expect(rateErr.rateLimit.allowed).toBe(false);
    }
  });

  it('releases quota once the oldest report ages past 60 minutes', async () => {
    // 5 reports submitted at 12:05, 12:10, 12:15, 12:20, 12:25
    for (let i = 1; i <= 5; i++) {
      await moderationReportsRepository.createReport({
        reporter_id: reporterId,
        target_type: 'profile',
        target_id: `33333333-3333-4333-8333-33333333333${i}`,
        category: 'Spam',
        created_at: new Date(baseTime.getTime() + i * 5 * 60_000),
      });
    }

    // At 13:04 (before 12:05 rolls out): blocked
    const blockedNow = new Date(baseTime.getTime() + 64 * 60_000);
    const blockedEval = await evaluateReportRateLimit(reporterId, {
      now: () => blockedNow,
    });
    expect(blockedEval.allowed).toBe(false);
    expect(blockedEval.remaining).toBe(0);

    // At 13:06 (12:05 has rolled out): allowed with 1 remaining slot
    const allowedNow = new Date(baseTime.getTime() + 66 * 60_000);
    const allowedEval = await evaluateReportRateLimit(reporterId, {
      now: () => allowedNow,
    });
    expect(allowedEval.allowed).toBe(true);
    expect(allowedEval.used).toBe(4);
    expect(allowedEval.remaining).toBe(1);
  });
});
