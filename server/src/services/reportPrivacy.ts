/**
 * US-025 / #236 moderation report privacy rules (AC 2 / FR-073).
 * Ensures that other participants cannot read reports or inspect reporter identity,
 * internal case status, or aggregate case counts.
 */

import type {
  ModerationReportCategory,
  ModerationReportTargetType,
} from '../db/types.js';
import type { ReportSubmissionReceipt } from './moderationReports.js';

export interface ParticipantReportReceiptDto {
  reportId: string;
  caseId: string;
  targetType: ModerationReportTargetType;
  targetId: string;
  category: ModerationReportCategory;
  status: 'Received';
  submittedAt: string;
  confirmationMessage: string;
  rateLimit: {
    limit: number;
    remaining: number;
    windowSeconds: number;
  };
}

export class ReportPrivacyError extends Error {
  readonly status = 403;
  readonly code = 'REPORT_READ_FORBIDDEN' as const;

  constructor(
    message = 'Moderation reports are confidential and cannot be read by participants.'
  ) {
    super(message);
    this.name = 'ReportPrivacyError';
  }
}

/**
 * Normalizes the submission receipt for participant consumption, stripping any internal fields.
 */
export function toParticipantReportReceiptDto(
  receipt: ReportSubmissionReceipt
): ParticipantReportReceiptDto {
  return {
    reportId: receipt.reportId,
    caseId: receipt.caseId,
    targetType: receipt.targetType,
    targetId: receipt.targetId,
    category: receipt.category,
    status: 'Received',
    submittedAt: receipt.submittedAt,
    confirmationMessage: receipt.confirmationMessage,
    rateLimit: {
      limit: receipt.rateLimit.limit,
      remaining: receipt.rateLimit.remaining,
      windowSeconds: receipt.rateLimit.windowSeconds,
    },
  };
}

export function assertReportReadAuthorized(viewerRole?: string): void {
  if (viewerRole !== 'ADMIN') {
    throw new ReportPrivacyError();
  }
}
