/**
 * US-017 / #161 invitation model contract (PostgreSQL team_requests subset).
 *
 * Source of truth: migrations 0011 (base + invitee/team pending unique),
 * 0018 (expires_at + per-slot pending unique + issuance), 0019 (model helpers),
 * 0020 (explicit FR-050 quota checks in issue_team_invitation).
 * Pending invitations do not confirm membership or reserve capacity against applications.
 * Quotas (#164 / FR-050): at most one Pending per vacancy slot and one Pending per invitee/team.
 */

import type { TeamRequestStatus } from './types.js';

/** FR-051 / US-017 AC 2 — Pending invitation time-to-live after issuance. */
export const INVITATION_TTL_HOURS = 48;

export const INVITATION_REQUEST_TYPE = 'Invitation' as const;

export const INVITATION_STATUSES = [
  'Pending',
  'Accepted',
  'Declined',
  'Withdrawn',
  'Expired',
  'Canceled',
] as const satisfies readonly TeamRequestStatus[];

export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

/** Statuses that may still become Accepted after revalidation. */
export const INVITATION_ACCEPTABLE_STATUSES: readonly InvitationStatus[] = ['Pending'];

/** Terminal statuses that permanently block acceptance. */
export const INVITATION_TERMINAL_STATUSES: readonly InvitationStatus[] = [
  'Accepted',
  'Declined',
  'Withdrawn',
  'Expired',
  'Canceled',
];

export interface InvitationModelFields {
  id: string;
  teamId: string;
  eventId: string;
  /** Required while status is Pending (slot-specific FR-049). */
  vacancyId: string | null;
  inviteeParticipantId: string;
  status: InvitationStatus;
  /** Required for Invitation rows; acceptance fails at/after this instant. */
  expiresAt: string | null;
  resolvedAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Pure clock check used by services before acceptance (mirrors SQL validity rule).
 * Does not mutate rows — delayed cleanup must not extend validity (FR-051).
 */
export function isInvitationExpiredByClock(
  expiresAt: string | null | undefined,
  now: Date = new Date()
): boolean {
  if (!expiresAt) return true;
  const expiryMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiryMs)) return true;
  return expiryMs <= now.getTime();
}

export function isInvitationPendingAcceptable(
  status: string,
  expiresAt: string | null | undefined,
  now: Date = new Date()
): boolean {
  if (status !== 'Pending') return false;
  return !isInvitationExpiredByClock(expiresAt, now);
}

export function computeInvitationExpiresAt(
  issuedAt: Date = new Date(),
  ttlHours: number = INVITATION_TTL_HOURS
): Date {
  return new Date(issuedAt.getTime() + ttlHours * 60 * 60 * 1000);
}
