/**
 * US-018 / #170 application model contract (PostgreSQL team_requests subset).
 *
 * Source of truth: migrations 0011 (base Application request_type + shared status),
 * 0023 (message, Pending slot CHECK, duplicate/3-pending indexes, submit RPC),
 * 0024 (withdraw_team_application — FR-055).
 *
 * UI "Pending Review" maps to status = 'Pending' with request_type = 'Application'.
 * Applications leave expires_at NULL (invitation-only TTL).
 * Pending applications do not confirm membership or reserve capacity against invitations.
 *
 * Quotas (FR-054): at most 3 Pending Applications per PART per event.
 * Duplicates (FR-053): at most one Pending Application per (team, applicant).
 * Withdraw (FR-055): applicant-only Pending → Withdrawn; releases quota; alerts both parties.
 */

/** cancel_reason written by withdraw_team_application (FR-055). */
export const APPLICATION_WITHDRAW_CANCEL_REASON = 'APPLICANT_WITHDRAWN' as const;

import type { TeamRequestStatus } from './types.js';

export const APPLICATION_REQUEST_TYPE = 'Application' as const;

/** FR-054 / US-018 AC 3 — concurrent Pending Review apps per PART per event. */
export const MAX_PENDING_APPLICATIONS_PER_EVENT = 3;

/** FR-053 / R-02 — optional applicant message length. */
export const APPLICATION_MESSAGE_MAX_LENGTH = 250;

export const APPLICATION_STATUSES = [
  'Pending',
  'Accepted',
  'Declined',
  'Withdrawn',
  'Expired',
  'Canceled',
] as const satisfies readonly TeamRequestStatus[];

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/** Statuses that still count toward the FR-054 pending quota. */
export const APPLICATION_PENDING_QUOTA_STATUSES: readonly ApplicationStatus[] = ['Pending'];

/** Applicant may withdraw before a decision commits (FR-055). */
export const APPLICATION_WITHDRAWABLE_STATUSES: readonly ApplicationStatus[] = ['Pending'];

/** Terminal statuses that permanently free pending quota. */
export const APPLICATION_TERMINAL_STATUSES: readonly ApplicationStatus[] = [
  'Accepted',
  'Declined',
  'Withdrawn',
  'Expired',
  'Canceled',
];

export interface ApplicationModelFields {
  id: string;
  teamId: string;
  eventId: string;
  /** Required while status is Pending (slot-specific FR-053). */
  vacancyId: string | null;
  applicantParticipantId: string;
  status: ApplicationStatus;
  /** Optional pitch; null when omitted. Max 250 characters when set. */
  message: string | null;
  /** Always null for Application rows (invitation-only TTL). */
  expiresAt: string | null;
  resolvedAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
}

/** True when status still consumes one of the 3 Pending Review slots for the event. */
export function countsTowardPendingApplicationQuota(status: string): boolean {
  return (APPLICATION_PENDING_QUOTA_STATUSES as readonly string[]).includes(status);
}

/** True when the applicant may still withdraw (FR-055). */
export function isApplicationWithdrawable(status: string): boolean {
  return (APPLICATION_WITHDRAWABLE_STATUSES as readonly string[]).includes(status);
}

/**
 * Normalize optional message for storage / validation.
 * Empty / whitespace-only → null; otherwise trimmed. Does not truncate.
 */
export function normalizeApplicationMessage(
  message: string | null | undefined
): string | null {
  if (message == null) return null;
  const trimmed = message.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** True when a normalized message exceeds the FR-053 / R-02 limit. */
export function isApplicationMessageTooLong(message: string | null | undefined): boolean {
  const normalized = normalizeApplicationMessage(message);
  if (normalized == null) return false;
  return normalized.length > APPLICATION_MESSAGE_MAX_LENGTH;
}
